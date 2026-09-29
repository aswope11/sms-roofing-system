// Step 2 API: schedule, payroll, ledger, AR, invoicing, supply invoices, payments.
// SAVE IS NEVER BLOCKED. ANYWHERE IN THIS APP. EVER. (his words, locked 9/20/26)
// He is a one-man shop and gets information as it comes in, not all at once. Whatever he has filled
// in, the app saves. What is missing rides back on the saved row as `missing` and the screen writes
// it down. The only things still turned away are requests with no record behind them at all (no id,
// an empty list, a thing that isn't on the book) and his own laws — a bid is not work, a JC never
// goes to QuickBooks, a man's day splits to 100%, two houses cannot share one name.
// Every guard here comes from lib/money.js, the same rules the tests check.
import { getDatabase } from "@netlify/database";
import { getStore } from "@netlify/blobs";
import type { Config } from "@netlify/functions";
import * as M from "../../lib/money.js";
import * as TALK from "../../lib/bidtalk.js";
import { addressKey, chunkCount, CHUNK_BYTES } from "../../lib/rules.js";
import zlib from "node:zlib";

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
const refuse = (why: string[] | string, status = 400) =>
  json({ error: Array.isArray(why) ? "Can't do that yet — missing: " + why.join("; ") : why }, status);

// Dates come back as plain YYYY-MM-DD strings everywhere.
function norm(v: any): any {
  if (v instanceof Date) {
    if (v.getHours() === 0 && v.getMinutes() === 0 && v.getSeconds() === 0 && v.getMilliseconds() === 0)
      return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`;
    return v.toISOString();
  }
  if (Array.isArray(v)) return v.map(norm);
  if (v && typeof v === "object") { const o: any = {}; for (const k in v) o[k] = norm(v[k]); return o; }
  return v;
}
const today = () => new Date(Date.now() - 5 * 3600 * 1000).toISOString().slice(0, 10); // Central time

const JOB_COLS = (sql: any) => sql`
  SELECT j.*, p.address, p.city, p.tenant, p.gc, p.customer_id, p.contract_amount, p.bill_name, p.bill_addr, p.ship_addr, c.name AS customer_name, pj.title AS parent_title, pj.tag AS parent_tag
  FROM jobs j JOIN properties p ON p.id = j.property_id JOIN customers c ON c.id = p.customer_id LEFT JOIN jobs pj ON pj.id = j.parent_job_id`;

// ================= QUICKBOOKS =================
// Tokens live in Blobs store "qbo" (saved by /api/qbo/callback). The access key lasts 1 hour; swap it with the refresh key when it's close.
const QB_API = "https://quickbooks.api.intuit.com/v3/company";
async function qbToken() {
  const store = getStore({ name: "qbo", consistency: "strong" });
  const t: any = await store.get("tokens", { type: "json" });
  if (!t) throw new Error("QuickBooks isn't connected — open /api/qbo/connect once.");
  if (Date.now() < Number(t.expires_at) - 120000) return t;
  const basic = Buffer.from(`${Netlify.env.get("QBO_CLIENT_ID")}:${Netlify.env.get("QBO_CLIENT_SECRET")}`).toString("base64");
  const res = await fetch("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json", authorization: `Basic ${basic}` },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: t.refresh_token }),
  });
  const tok: any = await res.json();
  if (!res.ok) throw new Error("QuickBooks connection expired — open /api/qbo/connect once to reconnect.");
  const next = { ...t, access_token: tok.access_token, refresh_token: tok.refresh_token || t.refresh_token, obtained_at: Date.now(), expires_at: Date.now() + (tok.expires_in || 3600) * 1000 };
  await store.setJSON("tokens", next);
  return next;
}
async function qb(method: string, path: string, payload?: any) {
  const t = await qbToken();
  const sep = path.includes("?") ? "&" : "?";
  const res = await fetch(`${QB_API}/${t.realm_id}/${path}${sep}minorversion=75`, {
    method, headers: { authorization: `Bearer ${t.access_token}`, accept: "application/json", ...(payload ? { "content-type": "application/json" } : {}) },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error("QuickBooks said: " + (data?.Fault?.Error?.[0]?.Detail || data?.Fault?.Error?.[0]?.Message || res.status));
  return data;
}
const qbQuery = (q: string) => qb("GET", `query?query=${encodeURIComponent(q)}`).then((d: any) => d.QueryResponse || {});
const qEsc = (s: string) => String(s || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
// QuickBooks customer = the property. Find it by address; none → create it named "address - city - tenant"; more than one → stop and name them.
async function qbCustomerFor(job: any) {
  const addr = String(job.address || "").trim();
  const found = (await qbQuery(`SELECT Id, DisplayName FROM Customer WHERE DisplayName LIKE '${qEsc(addr)}%' AND Active = true`)).Customer || [];
  if (found.length === 1) return found[0];
  if (found.length > 1) {
    // several customers at one address (e.g. Building 1-4): pick the one named for this job's building — the CO's parent job, or the job itself
    let pool = found;
    const city = String(job.city || "").trim().toLowerCase();
    const byCity = city ? pool.filter((c: any) => c.DisplayName.toLowerCase().includes(city)) : [];
    if (byCity.length === 1) return byCity[0];
    if (byCity.length) pool = byCity;
    for (const name of [job.parent_title, job.title]) {
      const n = String(name || "").trim().toLowerCase();
      if (!n) continue;
      const hit = pool.filter((c: any) => { const d = c.DisplayName.toLowerCase(); return d.endsWith(" - " + n) || d.includes(" - " + n + " -") || d.includes(" " + n); });
      const exact = hit.filter((c: any) => c.DisplayName.toLowerCase().endsWith(" - " + n));
      if (exact.length === 1) return exact[0];
      if (hit.length === 1) return hit[0];
    }
    throw new Error(`QuickBooks has ${found.length} customers at ${addr}: ${found.map((c: any) => c.DisplayName).join(" / ")} — fix the names in QuickBooks, then Send to QuickBooks.`);
  }
  const name = [addr, job.city, job.tenant].map((x: any) => String(x || "").trim()).filter(Boolean).join(" - ");
  // A new property never lands loose: it goes UNDER its company (Four Corners, Wortham…) — his AR rolls up by company.
  const parent = ((await qbQuery(`SELECT Id FROM Customer WHERE DisplayName = '${qEsc(String(job.customer_name || "").trim())}' AND Active = true`)).Customer || [])[0];
  return (await qb("POST", "customer", { DisplayName: name, ...(parent ? { ParentRef: { value: parent.Id }, Job: true, BillWithParent: false } : {}) })).Customer;
}
async function qbNextNumber() {
  const rows = (await qbQuery("SELECT DocNumber FROM Invoice ORDERBY MetaData.CreateTime DESC MAXRESULTS 100")).Invoice || [];
  const nums = rows.map((r: any) => Number(r.DocNumber)).filter((n: number) => Number.isFinite(n) && n > 0);
  return String((nums.length ? Math.max(...nums) : 0) + 1);
}
// Write one real invoice from the app into QuickBooks, then read it back from QuickBooks in a separate request.
// Four Corners rule (9/23): the invoice says the owning LLC + its address top left, and the tenant + tenant address on the right.
// Only when the property has a Bill-to name filled in; otherwise the invoice goes out the way it always has.
function billTo(job: any) {
  const name = String(job.bill_name || "").trim();
  if (!name) return {};
  const lines = (arr: string[]) => Object.fromEntries(arr.filter(Boolean).slice(0, 5).map((l, i) => [`Line${i + 1}`, l]));
  const billLines = [name, ...String(job.bill_addr || "").split(/\n/).map(s => s.trim())];
  const shipAddr = String(job.ship_addr || "").trim() || [job.address, job.city].filter(Boolean).join(", ");
  const shipLines = [String(job.tenant || "").trim(), ...shipAddr.split(/\n/).map(s => s.trim())];
  return { BillAddr: lines(billLines), ShipAddr: lines(shipLines) };
}
async function pushInvoiceToQB(sql: any, invoiceId: number, job: any) {
  const [inv] = norm(await sql`SELECT * FROM invoices WHERE id = ${invoiceId}`);
  if (!inv) throw new Error("That invoice doesn't exist.");
  if (inv.kind !== "real") throw new Error("Only a real invoice goes to QuickBooks from here.");
  if (inv.qb_id) throw new Error(`Already in QuickBooks as #${inv.number}.`);
  if (!(Number(inv.amount) > 0)) throw new Error("Can't do that yet — missing: the dollar amount");
  // Four Corners check (9/28, his words: "make sure we don't send out bullshit"): a Four Corners invoice never goes to
  // QuickBooks without the owning entity (LLC) and its address on the property. Check it against the property list
  // pinned on the Four Corners page (Keeson, 7/23/26), fill Edit property → Invoice bill-to, then send again.
  if (/four\s*corners/i.test(String(job.customer_name || "")) && !(String(job.bill_name || "").trim() && String(job.bill_addr || "").trim()))
    throw new Error("Four Corners invoice stopped — this property has no bill-to entity (LLC) and address. Look it up in the property list pinned on the Four Corners page, fill Edit property → Invoice bill-to, then send again.");
  try {
    const cust = await qbCustomerFor(job);
    const DocNumber = await qbNextNumber();
    const made = (await qb("POST", "invoice", {
      CustomerRef: { value: cust.Id }, DocNumber, TxnDate: inv.inv_date, DueDate: inv.inv_date, PrivateNote: inv.memo, ...billTo(job),
      Line: [{ DetailType: "SalesItemLineDetail", Amount: Number(inv.amount), Description: inv.scope,
        SalesItemLineDetail: { ItemRef: { value: "1" }, Qty: 1, UnitPrice: Number(inv.amount) } }],
    })).Invoice;
    const back = (await qb("GET", `invoice/${made.Id}`)).Invoice;
    if (!back || Number(back.TotalAmt) !== Number(inv.amount) || back.DocNumber !== DocNumber) throw new Error("QuickBooks read-back doesn't match — check invoice #" + DocNumber + " in QuickBooks.");
    await sql`UPDATE invoices SET qb_id = ${made.Id}, number = ${DocNumber}, qb_error = '' WHERE id = ${invoiceId}`;
    return { number: DocNumber, customer: cust.DisplayName };
  } catch (e: any) {
    await sql`UPDATE invoices SET qb_error = ${String(e?.message || e)} WHERE id = ${invoiceId}`;
    throw e;
  }
}
// Mark it sent → the QuickBooks invoice gets the same real date the app gives it.
async function qbSetDate(qbId: string, date: string) {
  const cur = (await qb("GET", `invoice/${qbId}`)).Invoice;
  await qb("POST", "invoice", { Id: qbId, SyncToken: cur.SyncToken, sparse: true, TxnDate: date, DueDate: date });
}

// Step 2 placeholder into QuickBooks: dated 2 weeks after the day worked, due the same day, memo = type + day, one "Services Rendered - Roof" line.
const mdyy = (iso: string) => { const [y, mo, d] = String(iso).slice(0, 10).split("-"); return `${Number(mo)}/${Number(d)}/${y.slice(2)}`; };
async function pushPlaceholderToQB(sql: any, o: any, amount: number) {
  if (!(amount > 0)) throw new Error("Can't do that yet — missing: a price — a $0 placeholder puts nothing in AR");
  const [seated] = norm(await sql`SELECT id FROM invoices WHERE kind = 'placeholder' AND job_id = ${o.job.id} AND work_date = ${o.work_date}`);
  if (seated) throw new Error("That day already has a placeholder.");
  const cust = await qbCustomerFor(o.job);
  const DocNumber = await qbNextNumber();
  const inv_date = M.addDays(o.work_date, 14);
  const memo = M.placeholderMemo(o.job, o.work_date);
  const desc = [`Date: ${mdyy(o.work_date)}`, ...o.labor.map((l: any) => l.how + (l.amount != null ? ` = ${M.money(l.amount)}` : "")),
    ...(o.material_cost ? [`Material ${M.money(o.material_cost)}${o.job.tag === "JC" ? "" : " × 1.2"} = ${M.money(M.billMaterial(o.material_cost, o.job.tag))}`] : [])].join("\n\n");
  const made = (await qb("POST", "invoice", {
    CustomerRef: { value: cust.Id }, DocNumber, TxnDate: inv_date, DueDate: inv_date, PrivateNote: memo,
    Line: [{ DetailType: "SalesItemLineDetail", Amount: amount, Description: desc, SalesItemLineDetail: { ItemRef: { value: "1" }, Qty: 1, UnitPrice: amount } }],
  })).Invoice;
  const back = (await qb("GET", `invoice/${made.Id}`)).Invoice;
  if (!back || Number(back.TotalAmt) !== amount || back.DocNumber !== DocNumber) throw new Error("QuickBooks read-back doesn't match — check placeholder #" + DocNumber + " in QuickBooks.");
  const [r] = norm(await sql`INSERT INTO invoices (job_id, kind, name, number, amount, inv_date, work_date, memo, qb_id)
    VALUES (${o.job.id}, 'placeholder', '', ${DocNumber}, ${amount}, ${inv_date}, ${o.work_date}, ${memo}, ${made.Id}) RETURNING *`);
  return { number: DocNumber, customer: cust.DisplayName, amount, invoice: r };
}
// Real invoice written → the QuickBooks placeholder it replaces goes to $0 and is renamed Job Cost N, memo kept.
async function qbZeroPlaceholder(qbId: string, name: string) {
  const cur = (await qb("GET", `invoice/${qbId}`)).Invoice;
  const line = (cur.Line || []).find((l: any) => l.DetailType === "SalesItemLineDetail") || {};
  await qb("POST", "invoice", { Id: qbId, SyncToken: cur.SyncToken, sparse: true, CustomerRef: cur.CustomerRef,
    Line: [{ DetailType: "SalesItemLineDetail", Amount: 0, Description: `${name}\n\n${line.Description || ""}`, SalesItemLineDetail: { ItemRef: { value: "1" }, Qty: 1, UnitPrice: 0 } }] });
}
async function qbRestorePlaceholder(qbId: string, amount: number) {
  const cur = (await qb("GET", `invoice/${qbId}`)).Invoice;
  const line = (cur.Line || []).find((l: any) => l.DetailType === "SalesItemLineDetail") || {};
  const desc = String(line.Description || "").replace(/^Job Cost \d+\n\n/, "");
  await qb("POST", "invoice", { Id: qbId, SyncToken: cur.SyncToken, sparse: true, CustomerRef: cur.CustomerRef,
    Line: [{ DetailType: "SalesItemLineDetail", Amount: amount, Description: desc, SalesItemLineDetail: { ItemRef: { value: "1" }, Qty: 1, UnitPrice: amount } }] });
}
const qbGone = (e: any) => /not found|Object Not Found|was deleted|6240|610/i.test(String(e?.message || e));
async function qbDeleteInvoice(qbId: string) {
  let cur: any;
  try { cur = (await qb("GET", `invoice/${qbId}`)).Invoice; } catch (e) { if (qbGone(e)) return "already gone"; throw e; }
  if (!cur) return "already gone";
  await qb("POST", "invoice?operation=delete", { Id: qbId, SyncToken: cur.SyncToken });
}

// ================= THE APP'S OWN GMAIL — READ AND FILE ONLY =================
// It never sends, never replies. Scope is gmail.readonly. What it can't place, it asks about.
async function gmailToken() {
  const store = getStore({ name: "gmail", consistency: "strong" });
  const t: any = await store.get("tokens", { type: "json" });
  if (!t) throw new Error("Gmail isn't connected — open /api/gmail/connect once.");
  if (Date.now() < Number(t.expires_at) - 120000) return t;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: Netlify.env.get("GMAIL_CLIENT_ID") || "", client_secret: Netlify.env.get("GMAIL_CLIENT_SECRET") || "", refresh_token: t.refresh_token, grant_type: "refresh_token" }),
  });
  const tok: any = await res.json();
  if (!res.ok) throw new Error("Gmail connection expired — open /api/gmail/connect once to reconnect.");
  const next = { ...t, access_token: tok.access_token, obtained_at: Date.now(), expires_at: Date.now() + (tok.expires_in || 3600) * 1000 };
  await store.setJSON("tokens", next);
  return next;
}
async function gmail(path: string) {
  const t = await gmailToken();
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, { headers: { authorization: `Bearer ${t.access_token}` } });
  const data: any = await res.json();
  if (!res.ok) throw new Error("Gmail said: " + (data?.error?.message || res.status));
  return data;
}
const headerOf = (msg: any, name: string) => (msg.payload?.headers || []).find((h: any) => h.name.toLowerCase() === name.toLowerCase())?.value || "";
// Every attachment in the message, however deep Gmail nested it.
function attachmentsOf(part: any, out: any[] = []) {
  if (!part) return out;
  if (part.filename && part.body?.attachmentId) out.push({ name: part.filename, id: part.body.attachmentId, size: part.body.size || 0, type: part.mimeType || "application/octet-stream" });
  for (const p of part.parts || []) attachmentsOf(p, out);
  return out;
}
// Which drawer a file belongs in, by what it is called.
function drawerFor(name: string, type: string) {
  const n = name.toLowerCase();
  if (/^image\//.test(type) || /\.(jpe?g|png|heic|gif)$/.test(n)) return "Photos";
  if (/contract|agreement|subcontract|aia/.test(n)) return "Contract";
  if (/plan|drawing|sheet|spec|detail|\.dwg/.test(n)) return "Plans";
  if (/invoice|\binv[-_ ]?\d/.test(n)) return "Documents";
  if (/bid|proposal|quote|estimate/.test(n)) return "Bid";
  if (/takeoff|take-off/.test(n)) return "Takeoff";
  return "Documents";
}
const BID_WORDS = /invitation to bid|invite to bid|bid invitation|itb\b|request for proposal|\brfp\b|bidding|please bid|bid request|quote request|request for quote|\brfq\b/i;
// File one attachment into a job's drawer, in pieces, the same way the drop box does.
async function fileAttachment(sql: any, jobId: number, msgId: string, att: any) {
  const data = await gmail(`messages/${msgId}/attachments/${att.id}`);
  const bytes = Buffer.from(String(data.data || "").replace(/-/g, "+").replace(/_/g, "/"), "base64");
  const chunks = chunkCount(bytes.length);
  const key = `job-${jobId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const store = getStore({ name: "job-files", consistency: "strong" });
  for (let n = 0; n < chunks; n++) await store.set(`${key}/${n}`, bytes.subarray(n * CHUNK_BYTES, (n + 1) * CHUNK_BYTES));
  const [f] = norm(await sql`INSERT INTO files (job_id, drawer, name, content_type, size_bytes, chunks, blob_key, complete)
    VALUES (${jobId}, ${drawerFor(att.name, att.type)}, ${att.name}, ${att.type}, ${bytes.length}, ${chunks}, ${key}, TRUE) RETURNING *`);
  return f;
}

// ================= THE FIVE LABELS — THE ONLY MAIL THE APP READS ON ITS OWN (9/21/26) =================
// "Turn off the whole-inbox Gmail read. The app now reads ONLY these five Gmail labels.
//  Nothing else in my inbox is ever read. The label tells you what it is — don't guess."
// He puts SMS/BID, SMS/R, SMS/CO, SMS/JC or SMS/UC on an email. Every 15 minutes the app looks in
// those five labels and nowhere else. An empty label costs nothing: Claude is only called when there
// is an email sitting in one. Each email: its address is matched to a property on file, a ticket with
// the label's tag is made on that property, the email and every attachment go in that job file, and
// the label comes off so it is never read twice. No match on file → it asks him about that one email.
// his labels carry a "!" in front so they sort to the top of Gmail (9/21/26)
const MAIL_LABELS: Record<string, string> = { "!SMS/BID": "BID", "!SMS/R": "R", "!SMS/CO": "CO", "!SMS/JC": "JC", "!SMS/UC": "UC" };
async function gmailPost(path: string, payload: any) {
  const t = await gmailToken();
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
    method: "POST", headers: { authorization: `Bearer ${t.access_token}`, "content-type": "application/json" }, body: JSON.stringify(payload) });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error("Gmail said: " + (data?.error?.message || res.status));
  return data;
}
// the five label ids by name — made in his Gmail if one isn't there yet, so he can start using it
async function sureLabels() {
  const have: any[] = (await gmail("labels")).labels || [];
  const ids: Record<string, string> = {};
  for (const name of Object.keys(MAIL_LABELS)) {
    let l = have.find(x => String(x.name).toLowerCase() === name.toLowerCase());
    if (!l) { try { l = await gmailPost("labels", { name, labelListVisibility: "labelShow", messageListVisibility: "show" }); } catch (e) { l = null; } }
    if (l?.id) ids[name] = l.id;
  }
  return ids;
}
// the words of the email, plain — text part first, the HTML part stripped if that is all there is
function bodyText(part: any): string {
  const dec = (d: string) => Buffer.from(String(d || "").replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
  const walk = (p: any, type: string): string => {
    if (!p) return "";
    if (p.mimeType === type && p.body?.data) return dec(p.body.data);
    for (const c of p.parts || []) { const t = walk(c, type); if (t) return t; }
    return "";
  };
  const plain = walk(part, "text/plain");
  if (plain) return plain;
  return walk(part, "text/html").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
}
// the email itself goes in the job file too, whole, as an .eml that opens in Mail
async function fileEmail(sql: any, jobId: number, msgId: string, subject: string, when: string) {
  const raw = await gmail(`messages/${msgId}?format=raw`);
  const bytes = Buffer.from(String(raw.raw || "").replace(/-/g, "+").replace(/_/g, "/"), "base64");
  const chunks = chunkCount(bytes.length);
  const key = `job-${jobId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const store = getStore({ name: "job-files", consistency: "strong" });
  for (let n = 0; n < chunks; n++) await store.set(`${key}/${n}`, bytes.subarray(n * CHUNK_BYTES, (n + 1) * CHUNK_BYTES));
  const name = `${when.slice(0, 10)} - ${(subject || "email").replace(/[\\/:*?"<>|]+/g, " ").slice(0, 90).trim()}.eml`;
  await sql`INSERT INTO files (job_id, drawer, name, content_type, size_bytes, chunks, blob_key, complete)
    VALUES (${jobId}, 'Emails', ${name}, 'message/rfc822', ${bytes.length}, ${chunks}, ${key}, TRUE)`;
}
// the property the email is about, by its street address — number AND street words, or nothing
function addrHit(props: any[], text: string) {
  const t = text.toLowerCase();
  return props.find((p: any) => {
    const key = addressKey(p.address), num = key.split(" ")[0];
    return key.length > 4 && /^\d/.test(num) && new RegExp(`\\b${num}\\b`).test(t) && key.split(" ").slice(1, 3).every((w: string) => t.includes(w));
  }) || null;
}
// Claude reads the one email — only ever called when an email is actually sitting in a label.
// It picks a property ONLY from the ones already on file, and the app then checks the street
// number is really in the email before it trusts the pick. It writes the ticket name and a short note.
async function claudeRead(mail: { from: string; subject: string; text: string; files: string[] }, props: any[], custs: any[] = []) {
  const key = Netlify.env.get("ANTHROPIC_API_KEY");
  if (!key) return null;
  const base = (Netlify.env.get("ANTHROPIC_BASE_URL") || "https://api.anthropic.com").replace(/\/$/, "");
  const list = props.map((p: any) => `${p.id} | ${p.address}, ${p.city} | ${p.customer_name}`).join("\n");
  const prompt = `A roofing contractor filed this email under a label. Read it and answer in JSON only.

PROPERTIES ON FILE (id | address | customer):
${list}

CUSTOMERS ON FILE (id | name | email):
${custs.map((c: any) => `${c.id} | ${c.name} | ${c.email || ""}`).join("\n")}

EMAIL
From: ${mail.from}
Subject: ${mail.subject}
Attachments: ${mail.files.join(", ") || "none"}
${mail.text.slice(0, 9000)}

Answer with exactly this JSON and nothing else:
{"property_id": <the id from the list whose street address this email is about, or null if none matches — never guess>,
 "customer_id": <the id from CUSTOMERS ON FILE that sent this work or is paying for it — the company in the From line or the company the sender works for (same email domain, same company name) — or null if none of them — never guess>,
 "address_in_email": "<the JOB SITE street address as written in the email, or empty — never the sender's office, a signature block or an architect's address>",
 "job_name": "<the project or building name, e.g. DATCU Little Elm or Liberty Retail Center, or empty>",
 "city": "<the job site city, or empty>",
 "customer_in_email": "<the company the work is for, or empty>",
 "title": "<what the work is, 60 characters max, plain words, no address>",
 "summary": "<one or two sentences: what they are asking for>",
 "bid_due": "<YYYY-MM-DD if a bid due date is stated, else null>"}`;
  const res = await fetch(`${base}/v1/messages`, { method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: "claude-haiku-4-5", max_tokens: 500, messages: [{ role: "user", content: prompt }] }) });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error("Claude said: " + (data?.error?.message || res.status));
  const txt = (data.content || []).map((c: any) => c.text || "").join("");
  try { return JSON.parse(txt.slice(txt.indexOf("{"), txt.lastIndexOf("}") + 1)); } catch (e) { return null; }
}
// WHO IT IS FOR — worked out from who sent it (9/21/26: "They should be able to figure that out").
// The sender's company email domain is matched to a customer: a customer's own email, or mail from that
// same domain already filed on that customer's jobs. Then the company name. Exactly one hit, or nothing.
const FREE_MAIL = /^(gmail|googlemail|yahoo|outlook|hotmail|icloud|aol|live|msn|me|smsroofingdfw)\./i;
async function customerFor(sql: any, from: string, claudeId: any, saidName: string) {
  const custs = norm(await sql`SELECT id, name, email FROM customers`);
  const dom = (String(from).match(/@([A-Za-z0-9.-]+)/) || [])[1]?.toLowerCase() || "";
  if (dom && !FREE_MAIL.test(dom)) {
    const byEmail = custs.filter((c: any) => String(c.email || "").toLowerCase().endsWith("@" + dom));
    if (byEmail.length === 1) return byEmail[0];
    const past = norm(await sql`SELECT DISTINCT p.customer_id FROM mail_items mi JOIN jobs j ON j.id = mi.job_id JOIN properties p ON p.id = j.property_id
      WHERE mi.state = 'filed' AND LOWER(mi.from_addr) LIKE ${"%@" + dom + "%"} AND p.customer_id IS NOT NULL`);
    if (past.length === 1) return custs.find((c: any) => c.id === past[0].customer_id) || null;
  }
  if (claudeId) { const c = custs.find((x: any) => x.id === Number(claudeId)); if (c) return c; }
  const word = (n: string) => String(n || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(w => w.length > 3 && !["roofing", "construction", "builders", "company", "group", "brothers", "bros"].includes(w));
  const said = word(saidName);
  const byName = said.length ? custs.filter((c: any) => word(c.name).some(w => said.includes(w))) : [];
  return byName.length === 1 ? byName[0] : null;
}
// take the label off — the thing that makes sure it is never read twice
async function unlabel(msgId: string, labelId: string) {
  try { await gmailPost(`messages/${msgId}/modify`, { removeLabelIds: [labelId] }); return true; } catch (e) { return false; }
}

// ================= SUPPLY INVOICES OUT OF HIS EMAIL =================
// Every supply-house bill since 1/1/2026: vendor, number, date, total, the lines it can read, the PDF attached.
// It never guesses whose job it is — what it can't place, he places.
const PDF_RE = /\.pdf$/i;
function pdfText(buf: Buffer) {
  // The words out of a PDF, in reading order. Enough to read a supply invoice; not a renderer.
  const raw = buf.toString("latin1");
  const out: string[] = [];
  for (const m of raw.matchAll(/stream\r?\n([\s\S]*?)endstream/g)) {
    let chunk = m[1];
    try { chunk = zlib.inflateSync(Buffer.from(chunk, "latin1")).toString("latin1"); } catch { /* not compressed, or not ours to read */ }
    for (const t of chunk.matchAll(/\((?:\\.|[^()\\])*\)/g)) out.push(t[0].slice(1, -1).replace(/\\([()\\])/g, "$1"));
  }
  return out.join(" ").replace(/\s+/g, " ");
}
const num = (s: string) => Number(String(s).replace(/[$,]/g, ""));
function readInvoiceText(text: string) {
  const number = (text.match(/invoice\s*(?:no\.?|number|#)\s*:?\s*([A-Z0-9][A-Z0-9\-\/]{3,})/i) || [])[1] || "";
  const dm = text.match(/invoice\s*date\s*:?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i) || text.match(/(\d{1,2}\/\d{1,2}\/\d{2,4})/);
  let inv_date = "";
  if (dm) {
    const [mo, d, y] = dm[1].split(/[\/\-]/).map(Number);
    const yy = y < 100 ? 2000 + y : y;
    inv_date = `${yy}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  const totals = [...text.matchAll(/(?:invoice\s+total|total\s+due|amount\s+due|balance\s+due|total)\s*:?\s*\$?\s*([\d,]+\.\d{2})/gi)].map(x => num(x[1]));
  const amount = totals.length ? totals[totals.length - 1] : 0;
  const due = text.match(/due\s*date\s*:?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i);
  let due_date: string | null = null;
  if (due) { const [mo, d, y] = due[1].split(/[\/\-]/).map(Number); const yy = y < 100 ? 2000 + y : y; due_date = `${yy}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`; }
  const po = (text.match(/\b(?:p\.?o\.?|purchase order|job)\s*(?:no\.?|number|#)?\s*:?\s*([A-Z0-9][A-Z0-9\- ]{2,20})/i) || [])[1] || "";
  // lines: qty · unit · what it is · price · total, in the order supply houses print them
  const lines: any[] = [];
  const LINE = /(\d+(?:\.\d+)?)\s+(EA|EACH|BD|BDL|BX|CS|GA|LF|PC|PCS|RL|SQ|SH|TU|BAG|BKT|PL)\s+([A-Za-z0-9][^$]{4,60}?)\s+\$?([\d,]+\.\d{2})\s+\$?([\d,]+\.\d{2})/gi;
  for (const m of text.matchAll(LINE)) {
    lines.push({ sku: "", description: m[3].trim(), qty: num(m[1]), unit: m[2].toUpperCase(), unit_price: num(m[4]), line_total: num(m[5]) });
    if (lines.length >= 60) break;
  }
  return { number, inv_date, due_date, amount, po, lines };
}

export default async (req: Request) => {
  const db = getDatabase();
  const sql = db.sql;
  const url = new URL(req.url);
  const [kind, idRaw, action] = url.pathname.replace(/^\/w\/?/, "").split("/").filter(Boolean);
  const id = idRaw && /^\d+$/.test(idRaw) ? Number(idRaw) : null;
  const m = req.method;
  const body = async () => { try { return await req.json(); } catch { return {}; } };

  const loadJob = async (jid: number) => (await sql`${JOB_COLS(sql)} WHERE j.id = ${jid}`)[0];
  const shareRowsFor = async (dates: string[]) => {
    if (!dates.length) return { stops: [], crewDays: [] };
    const stops = await sql`SELECT * FROM stops WHERE work_date = ANY(${dates}::date[])`;
    const crewDays = await sql`SELECT * FROM crew_days WHERE work_date = ANY(${dates}::date[])`;
    return norm({ stops, crewDays });
  };
  // What each ticket has cost so far: labor shares + supply lines applied to it.
  const costFor = async (ids: number[]) => {
    const out: Record<number, number> = {};
    if (!ids.length) return out;
    const dates = norm(await sql`SELECT DISTINCT work_date FROM stops WHERE job_id = ANY(${ids}::int[])`).map((r: any) => r.work_date);
    const { stops, crewDays } = await shareRowsFor(dates);
    const crew = norm(await sql`SELECT * FROM crew`);
    for (const x of M.stopShares({ stops, crew, crewDays })) if (ids.includes(x.job_id)) out[x.job_id] = M.round2((out[x.job_id] || 0) + x.cost);
    for (const l of norm(await sql`SELECT job_id, SUM(line_total) AS t FROM supply_lines WHERE job_id = ANY(${ids}::int[]) GROUP BY job_id`)) out[l.job_id] = M.round2((out[l.job_id] || 0) + Number(l.t));
    return out;
  };

  const owedList = async () => {
      const greens = norm(await sql`SELECT work_date FROM green_days WHERE green`).map((g: any) => g.work_date);
      const { stops, crewDays } = await shareRowsFor(greens);
      const crew = norm(await sql`SELECT * FROM crew`);
      const shares = M.stopShares({ stops, crew, crewDays });
      const jobIds = [...new Set(shares.map((s: any) => s.job_id))];
      const owedJobs = jobIds.length ? norm(await sql`${JOB_COLS(sql)} WHERE j.id = ANY(${jobIds}::int[])`) : [];
      const seats = jobIds.length ? norm(await sql`SELECT job_id, work_date FROM invoices WHERE kind = 'placeholder' AND job_id = ANY(${jobIds}::int[])`) : [];
      const covers = jobIds.length ? norm(await sql`SELECT job_id, covers_through FROM invoices WHERE kind = 'real' AND covers_through IS NOT NULL AND job_id = ANY(${jobIds}::int[])`) : [];
      const mat = jobIds.length ? norm(await sql`SELECT l.job_id, l.line_total, s.inv_date FROM supply_lines l JOIN supply_invoices s ON s.id = l.invoice_id
        WHERE l.job_id = ANY(${jobIds}::int[]) AND s.inv_date = ANY(${greens}::date[])`) : [];
      const owed: any[] = [];
      for (const j of owedJobs) {
        if (!M.canPlaceholder(j.tag) || j.no_charge || j.tabled_at) continue;
        const days = [...new Set(shares.filter((s: any) => s.job_id === j.id).map((s: any) => s.work_date))].sort();
        for (const d of days) {
          if (seats.some((x: any) => x.job_id === j.id && x.work_date === d)) continue;
          if (covers.some((x: any) => x.job_id === j.id && x.covers_through >= d)) continue;   // a real invoice already covers that day
          const lines = shares.filter((s: any) => s.job_id === j.id && s.work_date === d);
          const labor = lines.map((s: any) => ({ ...M.billLabor(s), man: s.shows_as }));
          const matCost = mat.filter((x: any) => x.job_id === j.id && x.inv_date === d).reduce((a: number, x: any) => a + Number(x.line_total), 0);
          const priced = labor.every((l: any) => l.amount != null);
          const suggested = priced ? M.round2(labor.reduce((a: number, l: any) => a + l.amount, 0) + M.billMaterial(matCost, j.tag)) : null;
          owed.push({ job: j, work_date: d, labor, material_cost: M.round2(matCost), suggested });
        }
      }
      return { owed, greens, shares, jobIds, owedJobs };
  };

  try {
    // ================= CREW =================
    if (kind === "crew") {
      if (m === "GET") return json(norm(await sql`SELECT * FROM crew ORDER BY sort_order NULLS LAST, id`));
      const b = await body();
      // NOTHING REFUSES TO SAVE. A man goes on the crew before his rate is settled; the rate reads $0
      // and the screen says so until he knows it.
      const kindV = b.boss_id ? "sub" : (b.kind === "sub" ? "sub" : "employee");
      const rate = Number(b.day_rate);
      const vals = [String(b.name || "").trim(), kindV, rate >= 0 ? rate : 0, (b.pay_to || "").trim(), b.boss_id ? Number(b.boss_id) : null, b.active !== false];
      if (m === "POST") {
        const [{ n }] = await sql`SELECT COUNT(*)::int AS n FROM crew WHERE boss_id IS NULL`;
        const color = vals[4] ? "" : M.CREW_COLORS[n % M.CREW_COLORS.length];
        return json(norm((await sql`INSERT INTO crew (name, kind, day_rate, pay_to, boss_id, active, sort_order, color)
          VALUES (${vals[0]}, ${vals[1]}, ${vals[2]}, ${vals[3]}, ${vals[4]}, ${vals[5]}, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM crew), ${color}) RETURNING *`)[0]), 201);
      }
      if (m === "PUT" && id) {
        if (vals[4] === id) return refuse("A man can't work under himself.");
        return json(norm((await sql`UPDATE crew SET name=${vals[0]}, kind=${vals[1]}, day_rate=${vals[2]}, pay_to=${vals[3]},
          boss_id=${vals[4]}, active=${vals[5]} WHERE id=${id} RETURNING *`)[0]));
      }
    }

    // ================= CREW COLOR =================
    if (kind === "crew-color" && id && m === "PUT") {
      const b = await body();
      const color = String(b.color || "");
      if (color && !/^#[0-9a-fA-F]{6}$/.test(color)) return refuse("That isn't a color.");
      const [r] = await sql`UPDATE crew SET color = ${color} WHERE id = ${id} RETURNING *`;
      return json(norm(r));
    }

    // ================= SUBS (rebuilt from the old board's Subs page) =================
    if (kind === "subs") {
      if (m === "GET" && !id) {
        // every man who runs a sub crew has a sub page, named by his pay-to — same as the old board's Tenorio Roofing record
        const heads = norm(await sql`SELECT * FROM crew WHERE kind = 'sub' AND boss_id IS NULL AND id NOT IN (SELECT crew_id FROM subs WHERE crew_id IS NOT NULL)`);
        for (const h of heads) await sql`INSERT INTO subs (name, trade, crew_id) VALUES (${h.pay_to || h.name}, ${"crew labor — paid per job per day"}, ${h.id})`;
        const subs = norm(await sql`SELECT s.*,
            (SELECT COUNT(*)::int FROM supply_invoices i WHERE LOWER(i.house) = LOWER(s.name)) AS inv_count,
            (SELECT COALESCE(SUM(i.amount),0) FROM supply_invoices i WHERE LOWER(i.house) = LOWER(s.name)) AS inv_total,
            (SELECT COALESCE(SUM(pl.amount),0) FROM payment_lines pl JOIN payments p ON p.id = pl.payment_id JOIN supply_invoices i ON i.id = pl.invoice_id
               WHERE p.voided_at IS NULL AND LOWER(i.house) = LOWER(s.name)) AS paid_total
          FROM subs s
          -- a man put UNDER a sub after his own page was made (Chili under Jovani, 9/25) is paid on his boss's page — his own page stays off the list, or his days show twice
          WHERE NOT EXISTS (SELECT 1 FROM crew c WHERE c.id = s.crew_id AND c.boss_id IS NOT NULL)
          ORDER BY LOWER(s.name)`);
        return json(subs);
      }
      if (m === "GET" && id) {
        const [s] = norm(await sql`SELECT * FROM subs WHERE id = ${id}`);
        if (!s) return refuse("That sub doesn't exist.", 404);
        s.files = norm(await sql`SELECT id, name, size_bytes FROM files WHERE sub_id = ${id} AND complete ORDER BY created_at`);
        s.invoices = norm(await sql`SELECT i.*, (SELECT COALESCE(SUM(pl.amount),0) FROM payment_lines pl JOIN payments p ON p.id = pl.payment_id
            WHERE p.voided_at IS NULL AND pl.invoice_id = i.id) AS paid_sum
          FROM supply_invoices i WHERE LOWER(i.house) = LOWER(${s.name}) ORDER BY i.inv_date`);
        return json(s);
      }
      if (m === "POST" && !id) {
        const b = await body();
        const [r] = await sql`INSERT INTO subs (name, contact) VALUES (${String(b.name || "").trim()}, ${String(b.contact || "").trim()}) RETURNING *`;
        return json(norm(r), 201);
      }
      if (m === "PUT" && id && action === "field") {
        const b = await body();
        const allowed = ["contact", "phone", "email", "addr", "trade", "about", "name"];
        if (!allowed.includes(b.field)) return refuse("Unknown field.");
        const v = String(b.value ?? "");
        const q: Record<string, any> = {
          contact: () => sql`UPDATE subs SET contact = ${v} WHERE id = ${id} RETURNING *`,
          phone: () => sql`UPDATE subs SET phone = ${v} WHERE id = ${id} RETURNING *`,
          email: () => sql`UPDATE subs SET email = ${v} WHERE id = ${id} RETURNING *`,
          addr: () => sql`UPDATE subs SET addr = ${v} WHERE id = ${id} RETURNING *`,
          trade: () => sql`UPDATE subs SET trade = ${v} WHERE id = ${id} RETURNING *`,
          about: () => sql`UPDATE subs SET about = ${v} WHERE id = ${id} RETURNING *`,
          name: () => sql`UPDATE subs SET name = ${v.trim()} WHERE id = ${id} RETURNING *`,
        };
        const [r] = await q[b.field]();
        return json(norm(r));
      }
    }

    // ================= SUB PAY LEDGER (the old Tenorio Roofing page) =================
    if (kind === "pay-ledger" && m === "GET") {
      const boss = Number(url.searchParams.get("boss"));
      const crew = norm(await sql`SELECT * FROM crew WHERE id = ${boss} OR boss_id = ${boss} ORDER BY sort_order NULLS LAST, id`);
      const ids = crew.map((c: any) => c.id);
      const stops = ids.length ? norm(await sql`SELECT * FROM stops WHERE crew_id = ANY(${ids}::int[])`) : [];
      const crewDays = ids.length ? norm(await sql`SELECT * FROM crew_days WHERE crew_id = ANY(${ids}::int[])`) : [];
      const jobIds = [...new Set(stops.map((s: any) => s.job_id))];
      const jobs = jobIds.length ? norm(await sql`${JOB_COLS(sql)} WHERE j.id = ANY(${jobIds}::int[])`) : [];
      const head = crew.find((c: any) => c.id === boss);
      const payTo = head ? (head.pay_to || head.name) : "";
      const paid = norm(await sql`SELECT * FROM sub_paid WHERE pay_to = ${payTo} AND paid`);
      const actuals = norm(await sql`SELECT work_date, job_id, actual FROM sub_paid WHERE pay_to = ${payTo} AND actual IS NOT NULL`);
      return json({ crew, stops, crewDays, jobs, paid, actuals, pay_to: payTo, today: today() });
    }
    if (kind === "sub-actual" && m === "PUT") {
      // what he actually sent for one job one day — sub page only; blank puts the line back to the men's days
      const b = await body();
      if (!b.work_date || !b.job_id) return refuse("An actual-paid number is one job, one day — that one came in with no line behind it.", 400);
      const actual = b.actual === null || b.actual === "" ? null : Number(b.actual);
      if (actual !== null && !(actual >= 0)) return refuse("Actual paid has to be a number, 0 or more.");
      const [r] = await sql`INSERT INTO sub_paid (pay_to, work_date, job_id, paid, actual, changed_at) VALUES (${String(b.pay_to || "")}, ${b.work_date}, ${Number(b.job_id)}, false, ${actual}, NOW())
        ON CONFLICT (pay_to, work_date, job_id) DO UPDATE SET actual = EXCLUDED.actual, changed_at = NOW() RETURNING *`;
      return json(norm(r));
    }
    if (kind === "sub-paid" && m === "PUT") {
      const b = await body();
      // a paid mark IS one man, one day, one ticket — those three are the row itself, not fields on it
      if (!b.work_date || !b.job_id) return refuse("A paid mark is one man, one day, one ticket — that one came in with no cell behind it.", 400);
      const [r] = await sql`INSERT INTO sub_paid (pay_to, work_date, job_id, paid, changed_at) VALUES (${String(b.pay_to || "")}, ${b.work_date}, ${Number(b.job_id)}, ${!!b.paid}, NOW())
        ON CONFLICT (pay_to, work_date, job_id) DO UPDATE SET paid = EXCLUDED.paid, changed_at = NOW() RETURNING *`;
      return json(norm(r));
    }

    // ================= SHOP (9/28/26) =================
    // The Shop job file = customer "SMS Shop" → property "Shop". Its labor is read off the job cost sheet;
    // this only finds that job and keeps the WHY for each day. Shop is paid, never billed (it's a JC — green never bills a JC).
    if (kind === "shop") {
      const [shop] = norm(await sql`SELECT j.id FROM jobs j JOIN properties p ON p.id = j.property_id JOIN customers c ON c.id = p.customer_id
        WHERE c.name = 'SMS Shop' AND p.address = 'Shop' ORDER BY j.id LIMIT 1`);
      if (m === "GET" && !idRaw) {
        const whys = norm(await sql`SELECT work_date, shows_as, why FROM shop_why ORDER BY work_date, shows_as`);
        return json({ job_id: shop ? shop.id : null, whys });
      }
      if (m === "PUT" && idRaw === "why") {
        const b = await body();
        const date = String(b.work_date || ""), who = String(b.shows_as || "").trim(), why = String(b.why || "").trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !who) return refuse("Which day and who — both are needed to save the why.", 400);
        const [row] = norm(await sql`INSERT INTO shop_why (work_date, shows_as, why, changed_at) VALUES (${date}, ${who}, ${why}, NOW())
          ON CONFLICT (work_date, shows_as) DO UPDATE SET why = EXCLUDED.why, changed_at = NOW() RETURNING work_date, shows_as, why`);
        return json(row);
      }
    }

    // ================= CREW ORDER (he drags men up and down) =================
    if (kind === "crew-order" && m === "PUT") {
      const b = await body();
      const ids = (b.ids || []).map(Number).filter((n: number) => n > 0);
      if (!ids.length) return refuse("Nothing to put in order — the list came in empty.", 400);
      for (let i = 0; i < ids.length; i++) await sql`UPDATE crew SET sort_order = ${i + 1} WHERE id = ${ids[i]}`;
      return json({ ids });
    }

    // ================= SCHEDULE ORDER (▲ ▼ on the rows under the grid) =================
    if (kind === "sched-order" && m === "PUT") {
      const b = await body();
      const ids = (b.ids || []).map(Number).filter((n: number) => n > 0);
      if (!ids.length) return refuse("Nothing to put in order — the list came in empty.", 400);
      for (let i = 0; i < ids.length; i++) await sql`UPDATE jobs SET sched_rank = ${i + 1} WHERE id = ${ids[i]}`;
      return json({ ids });
    }

    // ================= WEEK (schedule + payroll read the same rows) =================
    if (kind === "week" && m === "GET") {
      const start = M.payWeekStart(url.searchParams.get("start") || today());
      const dates = M.weekDates(start);
      const crew = norm(await sql`SELECT * FROM crew ORDER BY sort_order NULLS LAST, id`);
      const { stops, crewDays } = await shareRowsFor(dates);
      const green = norm(await sql`SELECT * FROM green_days WHERE work_date = ANY(${dates}::date[])`);
      const jobs = norm(await sql`${JOB_COLS(sql)} WHERE j.tag <> 'BID' AND (j.done_at IS NULL OR j.id = ANY(${stops.map((s: any) => s.job_id)}::int[]))
        ORDER BY (j.tag = 'R') DESC, j.created_at`);
      const scopes = norm(await sql`SELECT job_id, name FROM job_scopes WHERE job_id = ANY(${jobs.map((j: any) => j.id)}::int[]) ORDER BY id`);
      const wInvs = jobs.length ? norm(await sql`SELECT * FROM invoices WHERE job_id = ANY(${jobs.map((j: any) => j.id)}::int[]) AND kind IN ('real','draw') AND paid_at IS NULL`) : [];
      const agedJobs = jobs.map((j: any) => ({ ...j, aging: M.drawAging(j, wInvs, today()) }));
      return json({ start, dates, today: today(), crew, stops, crewDays, green, jobs: agedJobs, scopes });
    }

    // ================= STOPS =================
    if (kind === "stops") {
      if (m === "POST") {
        const b = await body();
        const job = await loadJob(Number(b.job_id));
        if (!job) return refuse("That ticket doesn't exist.", 404);
        if (!M.isWork(job.tag)) return refuse("A bid is not work — it can't go on a day. It gets a ticket when it's awarded.");
        if (!b.work_date || !b.crew_id) return refuse("A stop is a man on a day — that one came in with no cell behind it.", 400);
        const [row] = await sql`INSERT INTO stops (work_date, crew_id, job_id) VALUES (${b.work_date}, ${Number(b.crew_id)}, ${job.id})
          ON CONFLICT (work_date, crew_id, job_id) DO UPDATE SET work_date = EXCLUDED.work_date RETURNING *`;
        return json(norm(row), 201);
      }
      if (m === "DELETE" && id) {
        await sql`DELETE FROM stops WHERE id = ${id}`;
        const [left] = await sql`SELECT id FROM stops WHERE id = ${id}`;
        return left ? refuse("The stop is still there.", 500) : json({ removed: id });
      }
    }

    // ================= LOG A MAN'S DAY (the + popup) =================
    // One save: which job (or a new change order on that property), full/half day, what he did, and how his day splits.
    if (kind === "log" && m === "POST") {
      const b = await body();
      const crewId = Number(b.crew_id), date = b.work_date;
      if (!crewId || !date) return refuse("A day is a man on a date — that one came in with no cell behind it.", 400);
      const base = await loadJob(Number(b.job_id));
      if (!base) return refuse("That ticket doesn't exist.", 404);
      const coTitle = String(b.co_title || "").trim();
      if (!b.co && !M.isWork(base.tag)) return refuse("A bid is not work — it can't go on a day. It gets a ticket when it's awarded.");
      const days = Number(b.days);
      if (!(days > 0 && days <= 3)) return refuse("Pick full day or half day.");
      const client = await db.pool.connect();
      try {
        await client.query("BEGIN");
        let jobId = base.id;
        if (b.co) {
          // the CO sits UNDER the job it was made on; made on a CO → under that CO's parent
          const parentId = base.tag === "CO" && base.parent_job_id ? base.parent_job_id : base.id;
          const r = await client.query(`INSERT INTO jobs (property_id, tag, title, notes, parent_job_id) VALUES ($1, 'CO', $2, $3, $4) RETURNING id`,
            [base.property_id, coTitle, `Change order made from the schedule — ${base.tag} ${base.title}`, parentId]);
          jobId = r.rows[0].id;
        }
        // scopes: pills tapped on this job; new ones join this job's list
        const scopes = [...new Set((b.scopes || []).map((x: any) => String(x).trim()).filter(Boolean))] as string[];
        for (const name of scopes) await client.query(`INSERT INTO job_scopes (job_id, name) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [jobId, name]);
        const dayScope = scopes.join(" · ");
        const ss = b.scope_split && typeof b.scope_split === "object" ? b.scope_split : {};
        const scopeSplit = scopes.length ? Object.fromEntries(scopes.map(n => [n, ss[n] === "" || ss[n] == null ? null : Number(ss[n])])) : null;
        if (scopeSplit) { const bad = M.whyCantSplit(Object.values(scopeSplit)); if (bad.length) { await client.query("ROLLBACK"); return refuse(bad.map(x => "scopes: " + x)); } }
        // every man lit up gets his own stop and his own day (old board logAlso)
        const men = [...new Set([crewId, ...(b.also_crew || []).map(Number).filter((n: number) => n > 0)])];
        for (const man of men) {
          await client.query(`INSERT INTO stops (work_date, crew_id, job_id, day_scope, scope_split) VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (work_date, crew_id, job_id) DO UPDATE SET day_scope = EXCLUDED.day_scope, scope_split = EXCLUDED.scope_split`, [date, man, jobId, dayScope, scopeSplit ? JSON.stringify(scopeSplit) : null]);
          await client.query(`INSERT INTO crew_days (work_date, crew_id, days) VALUES ($1, $2, $3)
            ON CONFLICT (work_date, crew_id) DO UPDATE SET days = EXCLUDED.days`, [date, man, days]);
        }
        const mine = (await client.query(`SELECT id, job_id FROM stops WHERE work_date = $1 AND crew_id = $2`, [date, crewId])).rows;
        const split = b.split || {};
        const pctFor = (jid: number) => { const v = jid === jobId ? split.this : split[jid]; return v === "" || v == null ? null : Number(v); };
        const miss = M.whyCantSplit(mine.map((r: any) => pctFor(r.job_id)));
        if (miss.length) { await client.query("ROLLBACK"); return refuse(miss); }
        for (const r of mine) await client.query(`UPDATE stops SET pct = $1 WHERE id = $2`, [pctFor(r.job_id), r.id]);
        for (const man of men.filter(x => x !== crewId)) {
          const rows = (await client.query(`SELECT s.pct, s.job_id, c.name FROM stops s JOIN crew c ON c.id = s.crew_id WHERE s.work_date = $1 AND s.crew_id = $2`, [date, man])).rows;
          const set = rows.filter((r: any) => r.pct != null).reduce((a: number, r: any) => a + Number(r.pct), 0);
          if (rows.length > 1 && set >= 100) { await client.query("ROLLBACK"); return refuse(`${rows[0].name}'s day is already split 100% on his other jobs — open his cell and redo his split.`); }
        }
        await client.query("COMMIT");
        return json({ job_id: jobId, co: !!b.co }, 201);
      } catch (e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); }
    }

    if (kind === "crew-days" && m === "PUT") {
      const b = await body();
      const days = Number(b.days);
      if (!(days >= 0 && days <= 3)) return refuse("Days has to be between 0 and 3.");
      if ("pay" in b) {   // that day's actual pay (a quote came in); null = back to days × day rate
        const pay = b.pay === null || b.pay === "" ? null : Number(b.pay);
        if (pay !== null && !(pay >= 0)) return refuse("Pay has to be a number, 0 or more.");
        const [row] = await sql`INSERT INTO crew_days (work_date, crew_id, days, pay) VALUES (${b.work_date}, ${Number(b.crew_id)}, ${days}, ${pay})
          ON CONFLICT (work_date, crew_id) DO UPDATE SET pay = EXCLUDED.pay RETURNING *`;
        return json(norm(row));
      }
      const [row] = await sql`INSERT INTO crew_days (work_date, crew_id, days) VALUES (${b.work_date}, ${Number(b.crew_id)}, ${days})
        ON CONFLICT (work_date, crew_id) DO UPDATE SET days = EXCLUDED.days RETURNING *`;
      return json(norm(row));
    }

    if (kind === "green" && m === "PUT") {
      const b = await body();
      const [row] = await sql`INSERT INTO green_days (work_date, green, changed_at) VALUES (${b.work_date}, ${!!b.green}, NOW())
        ON CONFLICT (work_date) DO UPDATE SET green = EXCLUDED.green, changed_at = NOW() RETURNING *`;
      // Step 2: day goes green → a priced placeholder in QuickBooks for every R / CO / UC ticket that day. Taken back → those placeholders are deleted.
      const qbDone: string[] = [], qbErrors: string[] = [];
      if (b.green) {
        // a placeholder he deleted in QuickBooks by hand is gone — clear the app's copy so the day can go in again
        for (const p of norm(await sql`SELECT * FROM invoices WHERE kind = 'placeholder' AND work_date = ${b.work_date} AND amount > 0 AND qb_id <> ''`)) {
          try { await qb("GET", `invoice/${p.qb_id}`); } catch (e: any) { if (qbGone(e)) await sql`DELETE FROM invoices WHERE id = ${p.id}`; }
        }
        const { owed } = await owedList();
        for (const o of owed.filter((x: any) => x.work_date === b.work_date)) {
          const label = `${M.ticketName(o.job)}`;
          if (o.suggested == null) { qbErrors.push(`${label}: not priced (5+ stops) — use Send to QuickBooks on Invoicing`); continue; }
          try { const r = await pushPlaceholderToQB(sql, o, o.suggested); qbDone.push(`#${r.number} ${label} ${M.money(r.amount)}`); }
          catch (e: any) { qbErrors.push(`${label}: ${String(e?.message || e)}`); }
        }
      } else {
        const gone = norm(await sql`SELECT * FROM invoices WHERE kind = 'placeholder' AND work_date = ${b.work_date} AND amount > 0`);
        for (const p of gone) {
          try { const how = p.qb_id ? await qbDeleteInvoice(p.qb_id) : ""; await sql`DELETE FROM invoices WHERE id = ${p.id}`; qbDone.push(`deleted #${p.number}${how ? " (" + how + " in QuickBooks)" : ""}`); }
          catch (e: any) { qbErrors.push(`#${p.number}: ${String(e?.message || e)}`); }
        }
      }
      return json({ ...norm(row), qb_done: qbDone, qb_errors: qbErrors });
    }

    // ================= ONE TICKET: its ledger and its life =================
    // ================= JOB COST SHEET (Greenhill layout) =================
    // One read with everything added up on the server; the pages only draw it.
    if (kind === "jobcost" && id) {
      const job = norm(await loadJob(id));
      if (!job) return refuse("That ticket doesn't exist.", 404);
      if (m === "GET") {
        const propJobs = norm(await sql`${JOB_COLS(sql)} WHERE p.id = ${job.property_id} ORDER BY j.id`);
        const coJobs = job.tag === "CO" ? [] : propJobs.filter((x: any) => x.tag === "CO");
        const ids = [id, ...coJobs.map((x: any) => x.id)];
        const dates = norm(await sql`SELECT DISTINCT work_date FROM stops WHERE job_id = ANY(${ids}::int[])`).map((r: any) => r.work_date);
        const { stops, crewDays } = await shareRowsFor(dates);
        const crew = norm(await sql`SELECT * FROM crew`);
        const splitOf = Object.fromEntries(stops.map((x: any) => [x.id, x.scope_split]));
        // a sub's "Actual paid" (typed on his Subs page) replaces his crew's days on the job page — job cost only, never the bill
        const subActuals = norm(await sql`SELECT pay_to, work_date, job_id, actual FROM sub_paid WHERE actual IS NOT NULL AND job_id = ANY(${ids}::int[])`);
        const allShares = M.applySubActuals(M.stopShares({ stops, crew, crewDays }).filter((x: any) => ids.includes(x.job_id)), subActuals)
          .sort((a: any, b: any) => a.work_date.localeCompare(b.work_date) || a.shows_as.localeCompare(b.shows_as) || a.man.localeCompare(b.man));
        const labor = allShares.filter((x: any) => x.job_id === id)
          .map((x: any) => ({ ...x, scopes: M.splitByScope(x.cost, splitOf[x.stop_id]) }));
        const material = norm(await sql`SELECT l.*, s.house, s.number AS invoice_number, s.inv_date, s.po, s.id AS supply_id, mc.category
          FROM supply_lines l JOIN supply_invoices s ON s.id = l.invoice_id
          LEFT JOIN material_category mc ON mc.job_id = l.job_id AND mc.invoice_id = s.id
          WHERE l.job_id = ANY(${ids}::int[]) ORDER BY s.inv_date, s.id, l.id`);
        const invoices = norm(await sql`SELECT * FROM invoices WHERE job_id = ANY(${ids}::int[]) ORDER BY COALESCE(inv_date, created_at::date), id`);
        const scopes = norm(await sql`SELECT id, name, budget FROM job_scopes WHERE job_id = ${id} ORDER BY id`);
        const categories = norm(await sql`SELECT id, name, budget FROM cost_categories WHERE job_id = ${id} ORDER BY id`);
        const propInvs = norm(await sql`SELECT i.* FROM invoices i JOIN jobs j ON j.id = i.job_id WHERE j.property_id = ${job.property_id}`);
        const contract = M.contractFor(job, propJobs, propInvs);
        const mine = (list: any[], jid: number) => list.filter((x: any) => x.job_id === jid);
        const cos = coJobs.map((c: any) => {
          const lab = M.round2(mine(allShares, c.id).reduce((a: number, x: any) => a + x.cost, 0));
          const mat = M.round2(mine(material, c.id).reduce((a: number, x: any) => a + Number(x.line_total), 0));
          const billed = M.round2(mine(invoices, c.id).filter(M.isBill).reduce((a: number, x: any) => a + Number(x.amount), 0));
          return { id: c.id, tag: c.tag, title: c.title, address: c.address, city: c.city, co_amount: c.co_amount, labor: lab, material: mat, cost: M.round2(lab + mat), billed };
        });
        return json({ job, contract, today: today(), scopes, categories, cos,
          labor, material: mine(material, id), invoices: mine(invoices, id), places: M.whereIs(job, mine(invoices, id)) });
      }
      const b = await body();
      const money = (v: any) => v === "" || v == null ? null : Number(v);
      if (m === "PUT" && (action === "scope" || action === "category")) {
        const name = String(b.name || "").trim();   // an unnamed scope saves and waits for its name
        const budget = money(b.budget);
        if (budget != null && !(budget >= 0)) return refuse("Budget has to be a dollar amount.");
        const row = action === "scope"
          ? (await sql`INSERT INTO job_scopes (job_id, name, budget) VALUES (${id}, ${name}, ${budget}) ON CONFLICT (job_id, name) DO UPDATE SET budget = EXCLUDED.budget RETURNING *`)[0]
          : (await sql`INSERT INTO cost_categories (job_id, name, budget) VALUES (${id}, ${name}, ${budget}) ON CONFLICT (job_id, name) DO UPDATE SET budget = EXCLUDED.budget RETURNING *`)[0];
        return json(norm(row));
      }
      if (m === "PUT" && action === "material-category") {
        const cat = String(b.category || "").trim();   // blank category saves — it files itself later
        if (!b.invoice_id) return refuse("Which invoice? That one isn't on the book.", 404);
        const [row] = await sql`INSERT INTO material_category (job_id, invoice_id, category) VALUES (${id}, ${Number(b.invoice_id)}, ${cat})
          ON CONFLICT (job_id, invoice_id) DO UPDATE SET category = EXCLUDED.category RETURNING *`;
        if (cat) await sql`INSERT INTO cost_categories (job_id, name) VALUES (${id}, ${cat}) ON CONFLICT DO NOTHING`;
        return json(norm(row));
      }
      if (m === "PUT" && action === "contract") {
        if (job.tag !== "UC") return refuse("Only a UC carries its own contract — a JC's contract lives on the property.");
        const amt = money(b.amount);
        if (amt != null && !(amt >= 0)) return refuse("The contract has to be a dollar amount.");
        const [row] = await sql`UPDATE jobs SET job_contract = ${amt} WHERE id = ${id} RETURNING id, job_contract`;
        return json(norm(row));
      }
      if (m === "PUT" && action === "co-amount") {
        const amt = money(b.amount);
        if (amt != null && !(amt >= 0)) return refuse("The change order amount has to be a dollar amount.");
        const [row] = await sql`UPDATE jobs SET co_amount = ${amt} WHERE id = ${Number(b.co_id)} AND tag = 'CO' RETURNING id, co_amount`;
        return row ? json(norm(row)) : refuse("That change order doesn't exist.", 404);
      }
      return refuse("Unknown job cost action.", 404);
    }

    if (kind === "job" && id) {
      const job = norm(await loadJob(id));
      if (!job) return refuse("That ticket doesn't exist.", 404);

      if (m === "GET") {
        const invoices = norm(await sql`SELECT * FROM invoices WHERE job_id = ${id} ORDER BY COALESCE(inv_date, created_at::date), id`);
        const bidSystems = job.tag === "BID" ? norm(await sql`SELECT * FROM bid_systems WHERE job_id = ${id} ORDER BY id`) : [];
        const bidOptions = job.tag === "BID" ? norm(await sql`SELECT * FROM bid_options WHERE job_id = ${id} ORDER BY id`) : [];
        const myDates = norm(await sql`SELECT DISTINCT work_date FROM stops WHERE job_id = ${id}`).map((r: any) => r.work_date);
        const { stops, crewDays } = await shareRowsFor(myDates);
        const crew = norm(await sql`SELECT * FROM crew`);
        const shares = M.stopShares({ stops, crew, crewDays }).filter((s: any) => s.job_id === id)
          .sort((a: any, b: any) => a.work_date.localeCompare(b.work_date));
        const material = norm(await sql`SELECT l.*, s.house, s.number AS invoice_number, s.inv_date, s.amount AS invoice_amount, s.id AS supply_id
          FROM supply_lines l JOIN supply_invoices s ON s.id = l.invoice_id WHERE l.job_id = ${id} ORDER BY s.inv_date, s.id, l.id`);
        const propJobs = norm(await sql`SELECT id, tag FROM jobs WHERE property_id = ${job.property_id}`);
        const propInvs = norm(await sql`SELECT i.* FROM invoices i JOIN jobs j ON j.id = i.job_id WHERE j.property_id = ${job.property_id}`);
        const contract = M.contractFor(job, propJobs, propInvs);
        return json({ job, invoices, shares, material, contract, bidSystems, bidOptions, places: M.whereIs(job, invoices),
          lastWorkDate: M.workDate(id, stops), today: today() });
      }

      const b = await body();
      if (m === "PUT" && action === "plan") {
        const [r] = await sql`UPDATE jobs SET scheduled_date = ${b.scheduled_date || null} WHERE id = ${id} RETURNING *`;
        return json(norm(r));
      }
      if (m === "PUT" && action === "stage") {
        if (!["ready", "hold", "trades", "contract"].includes(b.stage)) return refuse("Unknown stage.");
        const [r] = await sql`UPDATE jobs SET stage = ${b.stage} WHERE id = ${id} RETURNING *`;
        return json(norm(r));
      }
      if (m === "PUT" && action === "bill-price") {
        // His price for the real invoice. Blank = use the placeholder's price.
        const v = b.price === "" || b.price == null ? null : M.round2(Number(b.price));
        if (v != null && !(v > 0)) return refuse("The invoice price has to be a dollar amount above $0 — or blank to use the placeholder.");
        const [r] = await sql`UPDATE jobs SET bill_price = ${v} WHERE id = ${id} RETURNING *`;
        return json(norm(r));
      }
      if (m === "PUT" && action === "scope") {
        // Writing words in the scope field never ticks the scope box.
        const [r] = await sql`UPDATE jobs SET scope = ${String(b.scope || "")} WHERE id = ${id} RETURNING *`;
        return json(norm(r));
      }
      if (m === "PUT" && action === "check") {
        // His tick. The only place either box is ever set.
        if (b.which === "scope") {
          const scope_ok = !!b.value;
          const [r] = await sql`UPDATE jobs SET scope_ok = ${scope_ok}, scope_ok_at = ${scope_ok ? new Date().toISOString() : null} WHERE id = ${id} RETURNING *`;
          return json(norm(r));
        }
        if (b.which === "pics") {
          const [r] = await sql`UPDATE jobs SET pics_ok = ${!!b.value}, pics_ok_at = ${b.value ? new Date().toISOString() : null} WHERE id = ${id} RETURNING *`;
          return json(norm(r));
        }
        return refuse("Unknown check.");
      }
      if (m === "POST" && action === "done") {
        if (!M.isWork(job.tag)) return refuse("A bid is not work — it can't be done.");
        const [r] = await sql`UPDATE jobs SET done_at = ${today()} WHERE id = ${id} RETURNING *`;
        return json(norm(r));
      }
      if (m === "POST" && action === "reopen") {
        // Reopen = back to the schedule, off Invoicing. Any real invoice not sent yet is undone here AND in QuickBooks,
        // and the placeholders it zeroed get their price back. A sent or paid invoice is never touched — he fixes that one by hand.
        const invs = norm(await sql`SELECT * FROM invoices WHERE job_id = ${id}`);
        const sent = invs.filter((i: any) => M.isBill(i) && (i.sent_at || i.paid_at));
        const undo = invs.filter((i: any) => i.kind === "real" && !i.sent_at && !i.paid_at);
        const qbDone: string[] = [], qbErrors: string[] = [];
        for (const inv of undo) {
          try {
            if (inv.qb_id) await qbDeleteInvoice(inv.qb_id);
            for (const p of invs.filter((x: any) => x.zeroed_by === inv.id)) {
              if (p.qb_id) await qbRestorePlaceholder(p.qb_id, Number(p.zeroed_from));
              await sql`UPDATE invoices SET amount = ${p.zeroed_from}, name = '', zeroed_from = NULL, zeroed_by = NULL WHERE id = ${p.id}`;
            }
            await sql`DELETE FROM invoices WHERE id = ${inv.id}`;
            qbDone.push(`invoice ${inv.number ? "#" + inv.number + " " : ""}${M.money(inv.amount)} undone`);
          } catch (e: any) { qbErrors.push(`invoice #${inv.number}: ${String(e?.message || e)} — ticket NOT reopened`); }
        }
        if (qbErrors.length) return json({ error: "QuickBooks: " + qbErrors.join(" · ") }, 502);
        const [r] = await sql`UPDATE jobs SET done_at = NULL, tabled_at = NULL, tabled_why = '' WHERE id = ${id} RETURNING *`;
        return json({ ...norm(r), qb_done: qbDone, sent_left: sent.map((i: any) => `#${i.number} ${M.money(i.amount)}`) });
      }
      if (m === "POST" && action === "table") {
        // it tables with no reason written — the screen says the reason is still missing
        const why = String(b.why || "").trim();
        const [r] = await sql`UPDATE jobs SET tabled_at = ${today()}, tabled_why = ${why} WHERE id = ${id} RETURNING *`;
        return json({ ...norm(r), missing: why ? [] : ["the reason — so it still makes sense in three months"] });
      }
      if (m === "POST" && action === "untable") {
        const [r] = await sql`UPDATE jobs SET tabled_at = NULL, tabled_why = '' WHERE id = ${id} RETURNING *`;
        return json(norm(r));
      }
      if (m === "POST" && action === "no-charge") {
        const [r] = await sql`UPDATE jobs SET no_charge = ${!!b.value} WHERE id = ${id} RETURNING *`;
        return json(norm(r));
      }
    }

    // ================= CUSTOMER INVOICES =================
    if (kind === "invoices") {
      if (m === "POST" && !id) {
        const b = await body();
        const job = norm(await loadJob(Number(b.job_id)));
        if (!job) return refuse("That ticket doesn't exist.", 404);
        if (!M.isWork(job.tag)) return refuse("An estimate is not work — no invoice goes on a bid.");
        if (!["placeholder", "real", "draw"].includes(b.kind)) return refuse("Unknown invoice kind.");
        if (b.kind === "placeholder" && !M.canPlaceholder(job.tag)) return refuse("A JC never goes to QuickBooks — its draw schedule bills it. No placeholder on a JC.");
        // NO DOLLAR AMOUNT IS NOT A REASON TO REFUSE. It saves at $0 and says the price is missing.
        const miss = b.kind === "placeholder" ? M.missingOnPlaceholder(b) : (Number(b.amount) > 0 ? [] : ["the dollar amount"]);
        const [r] = await sql`INSERT INTO invoices (job_id, kind, name, number, amount, inv_date, work_date)
          VALUES (${job.id}, ${b.kind}, ${String(b.name || "").trim()}, ${String(b.number || "").trim()}, ${Number(b.amount) || 0}, ${b.inv_date || null}, ${b.work_date || null})
          RETURNING *`;
        return json({ ...norm(r), missing: miss }, 201);
      }
      const [inv] = id ? norm(await sql`SELECT * FROM invoices WHERE id = ${id}`) : [];
      if (!inv) return refuse("That invoice doesn't exist.", 404);
      const b = await body();
      if (m === "PUT" && !action) {
        if (inv.paid_at && Number(b.amount) !== Number(inv.amount)) return refuse("It's marked paid — un-mark paid before changing the amount.");
        const miss = inv.kind !== "placeholder" && !(Number(b.amount) > 0) ? ["the dollar amount"] : [];
        const [r] = await sql`UPDATE invoices SET number = ${String(b.number || "").trim()}, amount = ${Number(b.amount) || 0},
          inv_date = ${b.inv_date || null}, name = ${String(b.name ?? inv.name)} WHERE id = ${id} RETURNING *`;
        return json({ ...norm(r), missing: miss });
      }
      if (m === "POST" && action === "zero") {
        if (inv.kind !== "placeholder") return refuse("Only a placeholder gets zeroed.");
        const siblings = norm(await sql`SELECT name FROM invoices WHERE job_id = ${inv.job_id} AND kind = 'placeholder'`);
        const name = M.nextJobCostName(siblings);
        const [r] = await sql`UPDATE invoices SET amount = 0, name = ${name} WHERE id = ${id} RETURNING *`;
        return json(norm(r));
      }
      if (m === "POST" && action === "sent") {
        if (!M.isBill(inv)) return refuse("A placeholder is a seat, not a bill — it never gets sent.");
        if (!b.value && inv.paid_at) return refuse("It's marked paid — un-mark paid first.");
        // Step 5 rule: the real invoice stays future-dated until Mark it sent — then the date and the AR clock become real.
        const [r] = b.value
          ? await sql`UPDATE invoices SET sent_at = ${today()}, inv_date = CASE WHEN inv_date IS NULL OR inv_date > ${today()}::date THEN ${today()}::date ELSE inv_date END WHERE id = ${id} RETURNING *`
          : await sql`UPDATE invoices SET sent_at = NULL WHERE id = ${id} RETURNING *`;
        if (b.value && inv.qb_id) { try { await qbSetDate(inv.qb_id, norm(r).inv_date); } catch (e: any) { return json({ ...norm(r), qb_error: "Marked sent, but QuickBooks date didn't change: " + String(e?.message || e) }); } }
        return json(norm(r));
      }
      if (m === "POST" && action === "qb") {
        const job = norm(await loadJob(inv.job_id));
        const out = await pushInvoiceToQB(sql, id, job);
        return json(out);
      }
      if (m === "POST" && action === "paid") {
        // money came in — it is marked paid even if the number or the amount is still to be filled in
        const miss = b.value ? M.missingToMarkPaid(inv) : [];
        const [r] = await sql`UPDATE invoices SET paid_at = ${b.value ? today() : null} WHERE id = ${id} RETURNING *`;
        return json({ ...norm(r), missing: miss });
      }
    }

    // ================= PROPERTY CONTRACT =================
    if (kind === "contract" && id && m === "PUT") {
      const b = await body();
      const amt = b.amount === "" || b.amount == null ? null : Number(b.amount);
      if (amt != null && !(amt >= 0)) return refuse("Contract amount has to be a number.");
      const [r] = await sql`UPDATE properties SET contract_amount = ${amt} WHERE id = ${id} RETURNING *`;
      return json(norm(r));
    }

    // ================= INVOICING PAGE =================
    if (kind === "invoicing" && m === "GET") {
      // Step 5 rule: an unsent real invoice written from Ready to bill stays future-dated (tomorrow) so it never hits AR early.
      await sql`UPDATE invoices SET inv_date = ${M.addDays(today(), 1)}::date WHERE kind = 'real' AND sent_at IS NULL AND covers_through IS NOT NULL AND inv_date <= ${today()}::date`;
      const done = norm(await sql`${JOB_COLS(sql)} WHERE j.tag <> 'BID' AND j.done_at IS NOT NULL ORDER BY j.done_at`);
      const ids = done.map((j: any) => j.id);
      const invs = ids.length ? norm(await sql`SELECT * FROM invoices WHERE job_id = ANY(${ids}::int[])`) : [];
      const tickets = done.map((j: any) => ({ ...j, invoices: invs.filter((i: any) => i.job_id === j.id) }))
        .filter((j: any) => M.inInvoicing(j, j.invoices) || (j.tabled_at && !j.no_charge));
      // Placeholders owed: every stop on a GREEN day on an R / CO / UC ticket with no priced seat for that day. JC never.
      const { owed, greens, shares, jobIds, owedJobs } = await owedList();
      // Ready to bill — fills itself (green day + scope written + checked), dollars from the rules
      const allMat = jobIds.length ? norm(await sql`SELECT l.job_id, l.line_total, s.inv_date FROM supply_lines l JOIN supply_invoices s ON s.id = l.invoice_id WHERE l.job_id = ANY(${jobIds}::int[])`) : [];
      const readyInvs = jobIds.length ? norm(await sql`SELECT * FROM invoices WHERE job_id = ANY(${jobIds}::int[])`) : [];
      const ready = owedJobs.map((j: any) => { const mine = readyInvs.filter((i: any) => i.job_id === j.id); const r = M.readyToBill(j, shares, allMat, mine); return r ? { ...r, job: j, invoice: M.writeRealInvoice(j, r, mine, today(), j.bill_price) } : null; }).filter(Boolean);
      // Billed a trip at a time — still working: open tickets with a bill that isn't paid (old board drawTickets)
      const openJobs = norm(await sql`${JOB_COLS(sql)} WHERE j.tag <> 'BID' AND (j.done_at IS NULL OR j.tag IN ('JC','UC')) AND j.tabled_at IS NULL AND EXISTS
        (SELECT 1 FROM invoices i WHERE i.job_id = j.id AND i.kind IN ('real','draw') AND i.paid_at IS NULL)`);
      const oIds = openJobs.map((j: any) => j.id);
      const oInvs = oIds.length ? norm(await sql`SELECT * FROM invoices WHERE job_id = ANY(${oIds}::int[])`) : [];
      const props = [...new Set(openJobs.map((j: any) => j.property_id))];
      const pJobs = props.length ? norm(await sql`SELECT id, tag, property_id FROM jobs WHERE property_id = ANY(${props}::int[])`) : [];
      const pInvs = props.length ? norm(await sql`SELECT i.*, j.property_id FROM invoices i JOIN jobs j ON j.id = i.job_id WHERE j.property_id = ANY(${props}::int[])`) : [];
      const draws = openJobs.map((j: any) => ({ ...j, invoices: oInvs.filter((i: any) => i.job_id === j.id), aging: M.drawAging(j, oInvs, today()),
        contract: M.contractFor(j, pJobs.filter((x: any) => x.property_id === j.property_id), pInvs.filter((x: any) => x.property_id === j.property_id)) }));
      const lastDay = norm(await sql`SELECT job_id, MAX(work_date) AS d FROM stops GROUP BY job_id`);
      const cost = await costFor([...tickets.map((t: any) => t.id), ...oIds]);
      const withCost = (t: any) => ({ ...t, cost: cost[t.id] || 0, last_work_date: (lastDay.find((x: any) => x.job_id === t.id) || {}).d || null });
      const tabledOpen = norm(await sql`${JOB_COLS(sql)} WHERE j.tag <> 'BID' AND j.done_at IS NULL AND j.tabled_at IS NOT NULL ORDER BY j.tabled_at`);
      const tIds = tabledOpen.map((j: any) => j.id);
      const tInvs = tIds.length ? norm(await sql`SELECT * FROM invoices WHERE job_id = ANY(${tIds}::int[])`) : [];
      const allTickets = [...tickets, ...tabledOpen.map((j: any) => ({ ...j, invoices: tInvs.filter((i: any) => i.job_id === j.id) }))];
      return json({ tickets: allTickets.map(withCost), draws: draws.map(withCost), owed, ready, today: today() });
    }

    // ================= PLACEHOLDER → QUICKBOOKS (button on Placeholders owed) =================
    if (kind === "placeholder-qb" && m === "POST") {
      const b = await body();
      const { owed } = await owedList();
      const o = owed.find((x: any) => x.job.id === Number(b.job_id) && x.work_date === b.work_date);
      if (!o) return refuse("That day isn't owed a placeholder — it's not green, already seated, or covered by a real invoice.");
      const amount = b.amount === "" || b.amount == null ? o.suggested : Number(b.amount);
      return json(await pushPlaceholderToQB(sql, o, M.round2(Number(amount))), 201);
    }

    // ================= WRITE THE INVOICE FROM "READY TO BILL" (his button, never automatic) =================
    if (kind === "bill" && id && m === "POST") {
      const b = await body();
      const job = norm(await loadJob(id));
      if (!job) return refuse("That ticket doesn't exist.", 404);
      const greens = norm(await sql`SELECT work_date FROM green_days WHERE green`).map((g: any) => g.work_date);
      const { stops, crewDays } = await shareRowsFor(greens);
      const crew = norm(await sql`SELECT * FROM crew`);
      const shares = M.stopShares({ stops, crew, crewDays });
      const mat = norm(await sql`SELECT l.job_id, l.line_total, s.inv_date FROM supply_lines l JOIN supply_invoices s ON s.id = l.invoice_id WHERE l.job_id = ${id}`);
      const invs = norm(await sql`SELECT * FROM invoices WHERE job_id = ${id}`);
      const r = M.readyToBill(job, shares, mat, invs);
      if (!r) return refuse("That ticket isn't ready to bill — it needs a green day not billed yet, and the scope written and checked.");
      const w = M.writeRealInvoice(job, r, invs, today(), b.amount === "" || b.amount == null ? job.bill_price : b.amount);
      // IT WRITES EITHER WAY. No price yet and no scope typed yet are notes on the invoice, not a wall.
      const billMiss = [...(w.amount > 0 ? [] : ["the dollar amount"]), ...(w.scope.trim() ? [] : ["the scope of work — it goes on the invoice word for word"])];
      const client = await db.pool.connect();
      let ins_id = 0;
      try {
        await client.query("BEGIN");
        const ins = await client.query(`INSERT INTO invoices (job_id, kind, name, number, amount, inv_date, covers_through, memo, scope) VALUES ($1, 'real', $2, '', $3, $4, $5, $6, $7) RETURNING id`,
          [id, w.name, Number(w.amount) || 0, w.inv_date, w.covers_through, w.memo, w.scope]);
        // the second the real invoice is written: placeholders it replaces → $0, renamed Job Cost N, memo kept word for word
        for (const z of w.zero) await client.query(`UPDATE invoices SET zeroed_from = amount, zeroed_by = $4, amount = 0, name = $1, memo = $2 WHERE id = $3`, [z.name, z.memo, z.id, ins.rows[0].id]);
        ins_id = ins.rows[0].id;
        await client.query(`UPDATE jobs SET bill_price = NULL WHERE id = $1`, [id]);   // his price was for this invoice only
        await client.query("COMMIT");
      } catch (e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); }
      const newId = ins_id;
      const zeroErr: string[] = [];
      for (const z of w.zero) { const p = invs.find((i: any) => i.id === z.id); if (p?.qb_id) { try { await qbZeroPlaceholder(p.qb_id, z.name); } catch (e: any) { zeroErr.push(`placeholder #${p.number} not zeroed in QuickBooks: ${String(e?.message || e)}`); } } }
      // straight into QuickBooks; if QuickBooks refuses, the invoice stays in the app with the reason and a Send to QuickBooks button
      let qbOut: any = null, qbErr = "";
      try { qbOut = await pushInvoiceToQB(sql, newId, job); } catch (e: any) { qbErr = String(e?.message || e); }
      if (zeroErr.length) qbErr = [qbErr, ...zeroErr].filter(Boolean).join(" · ");
      return json({ invoice_id: newId, amount: w.amount, through: w.covers_through, inv_date: w.inv_date, memo: w.memo, zeroed: w.zero.length, qb: qbOut, qb_error: qbErr, missing: billMiss }, 201);
    }

    // ================= SUPPLY INVOICES FROM HIS EMAIL =================
    if (kind === "supply-mail") {
      const q0 = 'after:2026/01/01 has:attachment filename:pdf (invoice OR "credit memo" OR statement)';
      // who is sending him invoices — he says which of these are supply houses
      if (m === "GET" && idRaw === "senders") {
        const list = await gmail("messages?maxResults=120&q=" + encodeURIComponent(q0));
        const counts: Record<string, number> = {};
        for (const m0 of (list.messages || []).slice(0, 60)) {
          const msg = await gmail(`messages/${m0.id}?format=metadata&metadataHeaders=From`);
          const from = headerOf(msg, "From");
          const addr = (from.match(/<([^>]+)>/) || [, from])[1].toLowerCase();
          counts[addr] = (counts[addr] || 0) + 1;
        }
        return json({ senders: Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([addr, n]) => ({ addr, n })) });
      }
      // pull them in: one supply invoice per PDF, the paper attached, the lines it can read
      if (m === "POST" && idRaw === "import") {
        const b = await body();
        const senders: string[] = (b.senders || []).map((s: string) => String(s).toLowerCase());
        if (!senders.length) return refuse("No senders were ticked, so there is nothing to read.", 400);
        const houseOf: Record<string, string> = b.houses || {};
        const q = q0 + " (" + senders.map(s => `from:${s}`).join(" OR ") + ")";
        const list = await gmail("messages?maxResults=" + (Number(b.max) || 20) + "&q=" + encodeURIComponent(q));
        const made: any[] = [], skipped: any[] = [];
        for (const m0 of (list.messages || [])) {
          const [seen] = norm(await sql`SELECT id FROM mail_items WHERE message_id = ${m0.id}`);
          if (seen) continue;
          const msg = await gmail(`messages/${m0.id}?format=full`);
          const from = headerOf(msg, "From");
          const addr = (from.match(/<([^>]+)>/) || [, from])[1].toLowerCase();
          const house = houseOf[addr] || from.replace(/<.*/, "").replace(/"/g, "").trim() || addr;
          const when = new Date(Number(msg.internalDate || Date.now())).toISOString().slice(0, 10);
          const atts = attachmentsOf(msg.payload).filter((a: any) => PDF_RE.test(a.name));
          if (!atts.length) {
            skipped.push({ subject: headerOf(msg, "Subject"), why: "no PDF on it" });
            // write it down so it is never looked at twice — otherwise it sits at the front of every batch
            await sql`INSERT INTO mail_items (message_id, from_addr, subject, sent_at, snippet, state, what, attachments)
              VALUES (${m0.id}, ${from}, ${headerOf(msg, "Subject")}, ${new Date(Number(msg.internalDate || Date.now())).toISOString()}, ${(msg.snippet || "").slice(0, 400)}, 'filed', 'Looked at — no PDF on it', 0) ON CONFLICT (message_id) DO NOTHING`;
            continue;
          }
          for (const a of atts) {
            const data = await gmail(`messages/${m0.id}/attachments/${a.id}`);
            const bytes = Buffer.from(String(data.data || "").replace(/-/g, "+").replace(/_/g, "/"), "base64");
            const read = readInvoiceText(pdfText(bytes));
            const number = read.number || a.name.replace(/\.pdf$/i, "");
            const [dupe] = norm(await sql`SELECT id FROM supply_invoices WHERE LOWER(house) = ${house.toLowerCase()} AND number = ${number}`);
            if (dupe) { skipped.push({ house, number, why: "already in" }); continue; }
            const [inv] = norm(await sql`INSERT INTO supply_invoices (house, number, inv_date, due_date, po, amount, notes, needs_reading)
              VALUES (${house}, ${number}, ${read.inv_date || when}, ${read.due_date}, ${read.po}, ${read.amount}, ${"From " + from}, ${read.lines.length === 0 || read.amount === 0}) RETURNING *`);
            for (const l of read.lines) await sql`INSERT INTO supply_lines (invoice_id, sku, description, qty, unit, unit_price, line_total)
              VALUES (${inv.id}, '', ${l.description}, ${l.qty}, ${l.unit}, ${l.unit_price}, ${l.line_total})`;
            // the paper rides with it
            const chunks = chunkCount(bytes.length);
            const key = `supply-${inv.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            const store = getStore({ name: "job-files", consistency: "strong" });
            for (let n = 0; n < chunks; n++) await store.set(`${key}/${n}`, bytes.subarray(n * CHUNK_BYTES, (n + 1) * CHUNK_BYTES));
            await sql`INSERT INTO files (supply_invoice_id, drawer, name, content_type, size_bytes, chunks, blob_key, complete)
              VALUES (${inv.id}, 'Paper', ${a.name}, 'application/pdf', ${bytes.length}, ${chunks}, ${key}, TRUE)`;
            made.push({ id: inv.id, house, number, amount: read.amount, lines: read.lines.length, date: inv.inv_date });
          }
          await sql`INSERT INTO mail_items (message_id, from_addr, subject, sent_at, snippet, state, what, attachments)
            VALUES (${m0.id}, ${from}, ${headerOf(msg, "Subject")}, ${new Date(Number(msg.internalDate || Date.now())).toISOString()}, ${(msg.snippet || "").slice(0, 400)}, 'filed',
              ${"Supply invoice → " + house}, ${atts.length}) ON CONFLICT (message_id) DO NOTHING`;
        }
        return json({ made, skipped, looked_at: (list.messages || []).length });
      }
    }

    // ================= MAIL =================
    if (kind === "mail") {
      if (m === "GET" && !id) {
        const rows = norm(await sql`SELECT mi.*, j.tag, j.title, p.address, p.city, c.name AS customer_name
          FROM mail_items mi LEFT JOIN jobs j ON j.id = mi.job_id LEFT JOIN properties p ON p.id = j.property_id LEFT JOIN customers c ON c.id = p.customer_id
          ORDER BY mi.sent_at DESC NULLS LAST LIMIT 60`);
        return json({ needs_you: rows.filter((r: any) => r.state === "needs_you"), filed: rows.filter((r: any) => r.state === "filed").slice(0, 20) });
      }
      // THE WHOLE-INBOX SWEEP IS OFF (9/21/26). "Nothing else in my inbox is ever read."
      // The only mail the app reads on its own is what sits in the five SMS labels (below).
      if (m === "POST" && idRaw === "scan") {
        return json({ off: true, why: "The whole-inbox read is off. Only the SMS/BID, SMS/R, SMS/CO, SMS/JC and SMS/UC labels are read.", looked_at: 0, filed: 0, needs_you: 0 });
      }

      // THE FIVE LABELS. One email per call, so nothing times out; the 15-minute check calls it until
      // the labels are empty. If every label is empty it returns straight away — Claude is never called.
      if (m === "POST" && idRaw === "labels") {
        // !SMS/SUPPLY (9/22/26): "Add a label for supply houses." An email under this label is a supply-house
        // bill. It goes on the Supply Houses book — never a job file, never a ticket. The PDF rides with it,
        // lines land on no job until he places them, and the label comes off. One email per call, like the rest.
        {
          const sup = ((await gmail("labels")).labels || []).find((l: any) => String(l.name).toLowerCase() === "!sms/supply");
          const sl: any = sup?.id ? await gmail(`messages?labelIds=${encodeURIComponent(sup.id)}&maxResults=25`) : {};
          for (const s0 of (sl.messages || [])) {
            const [seenS] = norm(await sql`SELECT id FROM mail_items WHERE message_id = ${s0.id}`);
            if (seenS) { await unlabel(s0.id, sup.id); continue; }   // already on the book — only the label comes off
            const msg = await gmail(`messages/${s0.id}?format=full`);
            const from = headerOf(msg, "From"), subject = headerOf(msg, "Subject");
            const sentAt = new Date(Number(msg.internalDate || Date.now())).toISOString();
            const fromName = from.replace(/<.*/, "").replace(/"/g, "").trim();
            const addr = ((from.match(/<([^>]+)>/) || [, from])[1] || "").toLowerCase();
            // the house already on the book whose name shows in who sent it — otherwise the sender's own name
            const w1 = (t: string) => String(t || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w: string) => w.length > 2)[0] || "";
            const hay = `${fromName} ${addr} ${subject}`.toLowerCase().replace(/[^a-z0-9 ]/g, " ");
            const hit = norm(await sql`SELECT name FROM supply_houses`).find((h: any) => w1(h.name) && hay.includes(w1(h.name)));
            const house = hit?.name || fromName || addr;
            const pdfs = attachmentsOf(msg.payload).filter((a: any) => PDF_RE.test(a.name));
            const made: any[] = [];
            for (const a of (pdfs.length ? pdfs : [null])) {
              let bytes: Buffer | null = null, read: any;
              if (a) {
                const data = await gmail(`messages/${s0.id}/attachments/${a.id}`);
                bytes = Buffer.from(String(data.data || "").replace(/-/g, "+").replace(/_/g, "/"), "base64");
                read = readInvoiceText(pdfText(bytes));
              } else read = readInvoiceText(bodyText(msg.payload));   // no PDF: read the email itself
              const number = read.number || (a ? a.name.replace(/\.pdf$/i, "") : "");
              if (number) { const [dupe] = norm(await sql`SELECT id FROM supply_invoices WHERE LOWER(house) = ${house.toLowerCase()} AND number = ${number}`); if (dupe) continue; }
              const [inv] = norm(await sql`INSERT INTO supply_invoices (house, number, inv_date, due_date, po, amount, notes, needs_reading)
                VALUES (${house}, ${number}, ${read.inv_date || sentAt.slice(0, 10)}, ${read.due_date}, ${read.po}, ${read.amount}, ${`Came in on the !SMS/SUPPLY label · ${from} · ${subject}`}, ${read.lines.length === 0 || read.amount === 0}) RETURNING *`);
              for (const l of read.lines) await sql`INSERT INTO supply_lines (invoice_id, sku, description, qty, unit, unit_price, line_total)
                VALUES (${inv.id}, '', ${l.description}, ${l.qty}, ${l.unit}, ${l.unit_price}, ${l.line_total})`;
              if (a && bytes) {
                const chunks = chunkCount(bytes.length);
                const key = `supply-${inv.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                const store = getStore({ name: "job-files", consistency: "strong" });
                for (let n = 0; n < chunks; n++) await store.set(`${key}/${n}`, bytes.subarray(n * CHUNK_BYTES, (n + 1) * CHUNK_BYTES));
                await sql`INSERT INTO files (supply_invoice_id, drawer, name, content_type, size_bytes, chunks, blob_key, complete)
                  VALUES (${inv.id}, 'Paper', ${a.name}, 'application/pdf', ${bytes.length}, ${chunks}, ${key}, TRUE)`;
              }
              made.push({ id: inv.id, house, number, amount: read.amount });
            }
            await sql`INSERT INTO mail_items (message_id, from_addr, subject, sent_at, snippet, state, what, attachments)
              VALUES (${s0.id}, ${from}, ${subject}, ${sentAt}, ${(msg.snippet || "").slice(0, 400)}, 'filed', ${"Supply invoice (!SMS/SUPPLY label) → " + house}, ${pdfs.length})
              ON CONFLICT (message_id) DO NOTHING`;
            const off = await unlabel(s0.id, sup.id);
            return json({ counts: { "!SMS/SUPPLY": (sl.messages || []).length }, done: { supply: made, house, subject, label_off: off }, left: 1, reader: "supply" });
          }
        }
        const ids = await sureLabels();
        // an email the old whole-inbox sweep once looked at (and was cleared off the list) is NOT "seen" —
        // only what this label reader itself filed, asked about, or was told "not ours" counts
        const waiting = norm(await sql`SELECT message_id, state FROM mail_items WHERE state IN ('filed','needs_you','waiting')
          OR (state = 'skipped' AND what LIKE 'Not ours (label)%') OR (state = 'skipped' AND what LIKE 'Bounce%')`);
        const seen = new Map(waiting.map((r: any) => [r.message_id, r.state]));
        const inLabels: any[] = [];
        for (const [name, lid] of Object.entries(ids)) {
          const list = await gmail(`messages?labelIds=${encodeURIComponent(lid)}&maxResults=25`);
          for (const m0 of list.messages || []) inLabels.push({ id: m0.id, threadId: m0.threadId, name, lid, tag: MAIL_LABELS[name] });
        }
        const counts = Object.fromEntries(Object.keys(ids).map(n => [n, inLabels.filter(x => x.name === n).length]));
        // ONE THREAD = ONE QUESTION, also for questions asked before this rule: the oldest one stays, the rest ride with it
        {
          const tstore = getStore({ name: "mail-labels", consistency: "strong" });
          const asks = norm(await sql`SELECT id, message_id FROM mail_items WHERE state = 'needs_you' ORDER BY id`);
          const byThread: Record<string, string[]> = {};
          for (const a of asks) { const pd: any = await tstore.get(`pending/${a.message_id}`, { type: "json" }); if (pd?.thread) (byThread[pd.thread] ||= []).push(a.message_id); }
          for (const [th, mids] of Object.entries(byThread)) {
            const tp: any = (await tstore.get(`pending-thread/${th}`, { type: "json" })) || { msg: mids[0], more: [] };
            const keep = tp.msg && mids.includes(tp.msg) ? tp.msg : mids[0];
            const extra = mids.filter(mm => mm !== keep);
            await tstore.setJSON(`pending-thread/${th}`, { msg: keep, more: [...new Set([...(tp.more || []), ...extra])] });
            for (const mm of extra) {
              await tstore.delete(`pending/${mm}`);
              await sql`UPDATE mail_items SET state = 'waiting', what = 'Same thread as the one waiting on you — it files with that one' WHERE message_id = ${mm}`;
            }
          }
        }
        // already done but the label is still on (the connection could not take it off then) — try again, no reading
        for (const x of inLabels.filter(x => seen.get(x.id) === "filed" || seen.get(x.id) === "skipped")) await unlabel(x.id, x.lid);
        // waiting on him — asked once, not asked again, not read again
        const todo = inLabels.filter(x => !seen.has(x.id));
        if (!todo.length) return json({ counts, done: null, left: 0, waiting_on_you: inLabels.filter(x => seen.get(x.id) === "needs_you").length });

        const x = todo[0];
        const msg = await gmail(`messages/${x.id}?format=full`);
        const subject = headerOf(msg, "Subject"), from = headerOf(msg, "From");
        const when = new Date(Number(msg.internalDate || Date.now())).toISOString();
        const atts = attachmentsOf(msg.payload);
        const text = bodyText(msg.payload);
        const threads = getStore({ name: "mail-labels", consistency: "strong" });

        // a reply in a thread that already made a ticket goes in THAT job file — never a second ticket
        const prior: any = await threads.get(`thread/${x.threadId}`, { type: "json" });
        const priorJob = prior?.job_id ? norm(await loadJob(Number(prior.job_id))) : null;
        // A BOUNCE ("Delivery Status Notification") is the mail system talking, not a customer — it is not
        // filed and never becomes a question. The label comes off it.
        if (/mailer-daemon|postmaster/i.test(from)) {
          await sql`INSERT INTO mail_items (message_id, from_addr, subject, sent_at, snippet, job_id, state, what, attachments)
            VALUES (${x.id}, ${from}, ${subject}, ${when}, '', NULL, 'skipped', 'Bounce — not a job email, not filed', 0)
            ON CONFLICT (message_id) DO UPDATE SET state = 'skipped', what = 'Bounce — not a job email, not filed'`;
          await unlabel(x.id, x.lid);
          return json({ counts, done: { subject, state: "skipped", what: "Bounce — not filed" }, left: todo.length - 1, reader: "none" });
        }
        // ONE THREAD = ONE QUESTION. A thread already waiting on him doesn't ask again — this email rides
        // along with that one, and files with it the moment he answers. Nothing is read, Claude is not called.
        const tp: any = priorJob ? null : await threads.get(`pending-thread/${x.threadId}`, { type: "json" });
        if (tp) {
          tp.more = [...new Set([...(tp.more || []), x.id])];
          await threads.setJSON(`pending-thread/${x.threadId}`, tp);
          const [row] = norm(await sql`INSERT INTO mail_items (message_id, from_addr, subject, sent_at, snippet, job_id, state, what, attachments)
            VALUES (${x.id}, ${from}, ${subject}, ${when}, ${(msg.snippet || "").slice(0, 400)}, NULL, 'waiting', 'Same thread as the one waiting on you — it files with that one', ${atts.length}) ON CONFLICT (message_id) DO UPDATE SET job_id = EXCLUDED.job_id, state = EXCLUDED.state, what = EXCLUDED.what, attachments = EXCLUDED.attachments, subject = EXCLUDED.subject, from_addr = EXCLUDED.from_addr RETURNING *`);
          return json({ counts, done: row, left: todo.length - 1, reader: "none" });
        }
        let job: any = priorJob, what = "", reader = "none";
        let read: any = null;
        if (!job) {
          const props = norm(await sql`SELECT p.*, c.name AS customer_name FROM properties p LEFT JOIN customers c ON c.id = p.customer_id`);
          const words = `${subject}\n${text}`;
          const custsAll = norm(await sql`SELECT id, name, email FROM customers`);
          try { read = await claudeRead({ from, subject, text, files: atts.map((a: any) => a.name) }, props, custsAll); reader = read ? "claude" : "no-claude"; }
          catch (e: any) { reader = "claude-failed: " + String(e?.message || e).slice(0, 80); }
          // trust Claude's pick only if that property's street number is really in the email
          let prop = read?.property_id ? props.find((p: any) => p.id === Number(read.property_id)) : null;
          if (prop && !new RegExp(`\\b${addressKey(prop.address).split(" ")[0]}\\b`).test(words.toLowerCase())) prop = null;
          if (!prop && !read) prop = addrHit(props, words);          // no Claude: the plain address match
          // NOT ON FILE YET, BUT WE KNOW WHO IT'S FROM: make the property under that customer and carry on.
          // A new bid is almost always a new address — that is not a reason to ask him anything.
          const cust = prop ? null : await customerFor(sql, from, read?.customer_id, String(read?.customer_in_email || ""));
          if (!prop && cust) {
            const street = String(read?.address_in_email || "").trim(), jn = String(read?.job_name || "").trim();
            const addr = street || jn || subject.replace(/^(re|fwd?|fw)\s*:\s*/gi, "").trim() || "From email";
            const city = String(read?.city || "").trim();
            const same = props.find((p: any) => p.customer_id === cust.id && addressKey(p.address) === addressKey(addr) && String(p.city || "").toLowerCase() === city.toLowerCase());
            prop = same || norm(await sql`INSERT INTO properties (customer_id, address, address_key, city, tenant, gc, notes)
              VALUES (${cust.id}, ${addr}, ${addressKey(addr)}, ${city}, '', '', ${`Made from the ${x.name} email from ${from} on ${when.slice(0, 10)}.`}) RETURNING *`)[0];
          }
          if (prop) {
            const title = String(read?.title || subject || "From email").trim().slice(0, 80);
            const notes = [`Came in on the ${x.name} label · ${from} · ${when.slice(0, 10)}`, `Subject: ${subject}`, read?.summary ? `\n${read.summary}` : ""].join("\n").trim();
            const due = x.tag === "BID" && /^\d{4}-\d{2}-\d{2}$/.test(String(read?.bid_due || "")) ? read.bid_due : null;
            [job] = norm(await sql`INSERT INTO jobs (property_id, tag, title, notes, stage, bid_due)
              VALUES (${prop.id}, ${x.tag}, ${title}, ${notes}, 'ready', ${due}) RETURNING *`);
            job = norm(await loadJob(job.id));
          } else {
            // CAN'T PLACE IT — ask him about this one email. The label stays on until he answers.
            const said = String(read?.address_in_email || "").trim();
            const pending = { tag: x.tag, label: x.name, label_id: x.lid, thread: x.threadId, title: String(read?.title || subject || "").slice(0, 80),
              summary: String(read?.summary || ""), bid_due: read?.bid_due || null, address: said, customer: String(read?.customer_in_email || "") };
            await threads.setJSON(`pending/${x.id}`, pending);
            await threads.setJSON(`pending-thread/${x.threadId}`, { msg: x.id, more: [] });
            const who = (from.replace(/<.*>/, "").replace(/"/g, "").trim() || from);
            const about = String(read?.job_name || "").trim() || said || subject;
            Object.assign(pending, { job_name: String(read?.job_name || ""), city: String(read?.city || ""), street: said });
            await threads.setJSON(`pending/${x.id}`, pending);
            const q = `${x.name} — Who is this for? ${who} sent it, about ${about}. No customer on file matches.`;
            const [row] = norm(await sql`INSERT INTO mail_items (message_id, from_addr, subject, sent_at, snippet, job_id, state, what, attachments)
              VALUES (${x.id}, ${from}, ${subject}, ${when}, ${(msg.snippet || "").slice(0, 400)}, NULL, 'needs_you', ${q}, ${atts.length}) ON CONFLICT (message_id) DO UPDATE SET job_id = EXCLUDED.job_id, state = EXCLUDED.state, what = EXCLUDED.what, attachments = EXCLUDED.attachments, subject = EXCLUDED.subject, from_addr = EXCLUDED.from_addr RETURNING *`);
            return json({ counts, done: row, left: todo.length - 1, reader });
          }
        }
        // FILE IT: the email itself, every attachment, then the label comes off
        await fileEmail(sql, job.id, x.id, subject, when);
        for (const a of atts) await fileAttachment(sql, job.id, x.id, a);
        await threads.setJSON(`thread/${x.threadId}`, { job_id: job.id });
        what = `${x.name} → ${priorJob ? "filed on" : "new"} ${M.ticketName(job)} · email + ${atts.length} file${atts.length === 1 ? "" : "s"}`;
        const [row] = norm(await sql`INSERT INTO mail_items (message_id, from_addr, subject, sent_at, snippet, job_id, state, what, attachments)
          VALUES (${x.id}, ${from}, ${subject}, ${when}, ${(msg.snippet || "").slice(0, 400)}, ${job.id}, 'filed', ${what}, ${atts.length}) ON CONFLICT (message_id) DO UPDATE SET job_id = EXCLUDED.job_id, state = EXCLUDED.state, what = EXCLUDED.what, attachments = EXCLUDED.attachments, subject = EXCLUDED.subject, from_addr = EXCLUDED.from_addr RETURNING *`);
        const off = await unlabel(x.id, x.lid);
        return json({ counts, done: { ...row, label_off: off }, left: todo.length - 1, reader });
      }

      // HE ANSWERED WHICH PROPERTY — the ticket is made with the label's tag, everything filed, label off
      if (m === "POST" && id && action === "place") {
        const b = await body();
        const [item] = norm(await sql`SELECT * FROM mail_items WHERE id = ${id}`);
        if (!item) return refuse("That email isn't on the list.", 404);
        const threads = getStore({ name: "mail-labels", consistency: "strong" });
        const pend: any = await threads.get(`pending/${item.message_id}`, { type: "json" });
        if (!pend) return refuse("That email didn't come in on a label.", 404);
        let [prop] = b.property_id ? norm(await sql`SELECT * FROM properties WHERE id = ${Number(b.property_id)}`) : [];
        if (!prop && b.customer_id) {
          // he named the customer — the property is made from the address / job name the email gave
          const addr = String(pend.street || pend.job_name || pend.title || "From email").trim();
          const [same] = norm(await sql`SELECT * FROM properties WHERE customer_id = ${Number(b.customer_id)} AND address_key = ${addressKey(addr)}`);
          prop = same || norm(await sql`INSERT INTO properties (customer_id, address, address_key, city, tenant, gc, notes)
            VALUES (${Number(b.customer_id)}, ${addr}, ${addressKey(addr)}, ${String(pend.city || "")}, '', '', ${`Made from the ${pend.label} email.`}) RETURNING *`)[0];
        }
        if (!prop) return refuse("Which customer? That one isn't on the book.", 404);
        const msg = await gmail(`messages/${item.message_id}?format=full`);
        const subject = headerOf(msg, "Subject"), when = new Date(Number(msg.internalDate || Date.now())).toISOString();
        const atts = attachmentsOf(msg.payload);
        const notes = [`Came in on the ${pend.label} label · ${item.from_addr} · ${when.slice(0, 10)}`, `Subject: ${subject}`, pend.summary ? `\n${pend.summary}` : ""].join("\n").trim();
        const due = pend.tag === "BID" && /^\d{4}-\d{2}-\d{2}$/.test(String(pend.bid_due || "")) ? pend.bid_due : null;
        const [j0] = norm(await sql`INSERT INTO jobs (property_id, tag, title, notes, stage, bid_due)
          VALUES (${prop.id}, ${pend.tag}, ${pend.title || subject || "From email"}, ${notes}, 'ready', ${due}) RETURNING *`);
        const job = norm(await loadJob(j0.id));
        await fileEmail(sql, job.id, item.message_id, subject, when);
        for (const a of atts) await fileAttachment(sql, job.id, item.message_id, a);
        await threads.setJSON(`thread/${pend.thread}`, { job_id: job.id });
        await threads.delete(`pending/${item.message_id}`);
        const off = await unlabel(item.message_id, pend.label_id);
        // every other email in that thread files in the same job file, and its label comes off too
        const tp: any = await threads.get(`pending-thread/${pend.thread}`, { type: "json" });
        let alsoFiled = 0;
        for (const mid of (tp?.more || [])) {
          const m2 = await gmail(`messages/${mid}?format=full`);
          const w2 = new Date(Number(m2.internalDate || Date.now())).toISOString();
          await fileEmail(sql, job.id, mid, headerOf(m2, "Subject"), w2);
          const a2 = attachmentsOf(m2.payload);
          for (const a of a2) await fileAttachment(sql, job.id, mid, a);
          for (const lid of (m2.labelIds || []).filter((l: string) => l === pend.label_id)) await unlabel(mid, lid);
          await sql`UPDATE mail_items SET job_id = ${job.id}, state = 'filed', what = ${`Same thread → ${M.ticketName(job)} · email + ${a2.length} file${a2.length === 1 ? "" : "s"}`} WHERE message_id = ${mid}`;
          alsoFiled++;
        }
        await threads.delete(`pending-thread/${pend.thread}`);
        const [r] = norm(await sql`UPDATE mail_items SET job_id = ${job.id}, state = 'filed',
          what = ${`${pend.label} → new ${M.ticketName(job)} · email + ${atts.length} file${atts.length === 1 ? "" : "s"}`} WHERE id = ${id} RETURNING *`);
        return json({ ...r, job_id: job.id, label_off: off, same_thread_filed: alsoFiled });
      }
      // ================= HE SENT AN INVOICE — THE APP FINISHES THE JOB =================
      // Adam sends the invoice out of Gmail. The app finds that sent email by the address on it,
      // files everything attached into the right drawer of that job file, reads the invoice number
      // and amount off the PDF onto the ticket, and marks it sent on the day he actually sent it —
      // which is what puts it in AR. It never marks anything sent that it cannot place on one ticket.
      if (m === "POST" && idRaw === "sent") {
        const props = norm(await sql`SELECT p.*, c.name AS customer_name FROM properties p JOIN customers c ON c.id = p.customer_id`);
        const jobs = norm(await sql`${JOB_COLS(sql)} WHERE j.tag <> 'BID'`);
        // only mail that IS an invoice going out — a tax return and a phone bill are not his invoices
        const list = await gmail("messages?maxResults=25&q=" + encodeURIComponent('in:sent has:attachment filename:pdf newer_than:45d (invoice OR "draw" OR billing)'));
        const out: any[] = [], skipped: any[] = [];
        for (const m0 of (list.messages || [])) {
          const [seen] = norm(await sql`SELECT id FROM mail_items WHERE message_id = ${m0.id}`);
          if (seen) continue;
          const msg = await gmail(`messages/${m0.id}?format=full`);
          const subject = headerOf(msg, "Subject"), to = headerOf(msg, "To");
          const whenIso = new Date(Number(msg.internalDate || Date.now())).toISOString();
          const sentDay = whenIso.slice(0, 10);
          const text = `${subject} ${msg.snippet || ""}`.toLowerCase();
          const atts = attachmentsOf(msg.payload);
          // it is only an invoice going out if the words say so AND there is paper on it
          if (!/\binvoice\b|\bdraw\b|\bbilling\b/i.test(text) || !atts.some((a: any) => PDF_RE.test(a.name))) {
            skipped.push(subject); continue;
          }
          // WHICH ROOF: the address in his own words
          const hit = props.find((p: any) => {
            const key = addressKey(p.address);
            const numPart = key.split(" ")[0];
            return key.length > 4 && text.includes(numPart) && key.split(" ").slice(1, 3).every((w: string) => text.includes(w));
          });
          let state = "needs_you", what = "", jobId: number | null = null;
          if (!hit) {
            what = `Sent invoice — no address on this roof matches. Which job?`;
          } else {
            // WHICH TICKET on that roof: the building or the tenant he named in the subject
            let mine = jobs.filter((j: any) => j.property_id === hit.id);
            // A BUILDING NAMED IN THE SUBJECT IS A HARD TEST, NOT A TIE-BREAKER. One roof, six buildings,
            // thirty tenants: "Building 3" must never land on the Building 4 ticket just because that is
            // the only ticket on the address. If the paper names a building, the ticket has to be it.
            const said = subject.toLowerCase().match(/\b(building|bldg|suite|ste|unit)\s*#?\s*([0-9]+[a-z]?|[a-z])\b/);
            const labelOf = (j: any) => `${j.title || ""} ${j.parent_title || ""} ${j.tenant || ""}`.toLowerCase();
            if (said) {
              const want = new RegExp(`\\b(building|bldg|suite|ste|unit)\\s*#?\\s*${said[2]}\\b`);
              mine = mine.filter((j: any) => want.test(labelOf(j)));
              if (!mine.length) {
                what = `Sent invoice says ${said[1]} ${said[2]} on ${hit.address} — no ticket here is that ${said[1]}. Which job?`;
                const [row0] = norm(await sql`INSERT INTO mail_items (message_id, from_addr, subject, sent_at, snippet, job_id, state, what, attachments)
                  VALUES (${m0.id}, ${"To " + to}, ${subject}, ${whenIso}, ${(msg.snippet || "").slice(0, 400)}, NULL, 'needs_you', ${what}, ${atts.length}) RETURNING *`);
                out.push(row0); continue;
              }
            } else if (mine.length > 1) {
              const scored = mine.map((j: any) => {
                const label = labelOf(j);
                let score = 0;
                for (const w of label.split(/[^a-z0-9]+/).filter((x: string) => x.length > 3)) if (text.includes(w)) score += 1;
                if (!j.done_at) score += 0.5;
                return { j, score };
              }).sort((a: any, b: any) => b.score - a.score);
              mine = (scored[0].score >= 1 && scored[0].score > scored[1].score) ? [scored[0].j] : mine;
            }
            if (mine.length !== 1) {
              what = `Sent invoice on ${hit.address} — ${mine.length} tickets there, which one?`;
            } else {
              const job = mine[0];
              jobId = job.id;
              // 1. the paper goes in the drawers
              let filed = 0;
              for (const a of atts) { await fileAttachment(sql, job.id, m0.id, a); filed++; }
              // 2. the invoice number and the amount, read off the PDF — never guessed
              let read: any = { number: "", amount: 0 };
              const pdfs = atts.filter((a: any) => PDF_RE.test(a.name));
              const first = pdfs.find((a: any) => /invoice|inv/i.test(a.name)) || pdfs[0];
              if (first) {
                const data = await gmail(`messages/${m0.id}/attachments/${first.id}`);
                const bytes = Buffer.from(String(data.data || "").replace(/-/g, "+").replace(/_/g, "/"), "base64");
                read = readInvoiceText(pdfText(bytes));
              }
              // 3. onto the ticket, and sent on the day he sent it — that is what puts it in AR
              const invs = norm(await sql`SELECT * FROM invoices WHERE job_id = ${job.id} ORDER BY id`);
              const bill = invs.find((i: any) => M.isBill(i) && !i.sent_at && !i.paid_at);
              const bits: string[] = [];
              if (bill) {
                const [r] = norm(await sql`UPDATE invoices SET
                  number = ${read.number || bill.number}, amount = ${read.amount > 0 ? read.amount : Number(bill.amount)},
                  sent_at = ${sentDay}::date, inv_date = COALESCE(inv_date, ${sentDay}::date) WHERE id = ${bill.id} RETURNING *`);
                bits.push(`Invoice ${r.number || "(no number on the PDF)"} $${Number(r.amount).toLocaleString()} — sent ${sentDay}, it is in AR`);
                state = "filed";
              } else if (read.number && read.amount > 0) {
                const [r] = norm(await sql`INSERT INTO invoices (job_id, kind, name, number, amount, inv_date, sent_at, memo, scope)
                  VALUES (${job.id}, 'real', 'Invoice', ${read.number}, ${read.amount}, ${sentDay}::date, ${sentDay}::date, ${"Read off the invoice emailed " + sentDay}, '') RETURNING *`);
                bits.push(`Invoice ${r.number} $${Number(r.amount).toLocaleString()} read off the PDF and written on the ticket — sent ${sentDay}, it is in AR`);
                state = "filed";
                const ph = invs.find((i: any) => i.kind === "placeholder" && Number(i.amount) > 0);
                if (ph) bits.push(`placeholder ${ph.number || ""} is still holding a price — zero it when you are ready`);
              } else {
                bits.push(`no invoice number or amount could be read off the paper — nothing was marked sent`);
              }
              if (filed) bits.unshift(`${filed} file${filed === 1 ? "" : "s"} filed on ${M.ticketName(job)}`);
              what = bits.join(" · ");
            }
          }
          const [row] = norm(await sql`INSERT INTO mail_items (message_id, from_addr, subject, sent_at, snippet, job_id, state, what, attachments)
            VALUES (${m0.id}, ${"To " + to}, ${subject}, ${whenIso}, ${(msg.snippet || "").slice(0, 400)}, ${jobId}, ${state}, ${what}, ${atts.length}) RETURNING *`);
          out.push(row);
        }
        return json({ looked_at: (list.messages || []).length, new: out.length, not_invoices: skipped.length,
          finished: out.filter((r: any) => r.state === "filed").length,
          needs_you: out.filter((r: any) => r.state === "needs_you").length, rows: out });
      }
      // He says which job it belongs to; then it files what was attached.
      if (m === "POST" && id && action === "assign") {
        const b = await body();
        const [item] = norm(await sql`SELECT * FROM mail_items WHERE id = ${id}`);
        if (!item) return refuse("That email isn't on the list.", 404);
        const job = norm(await loadJob(Number(b.job_id)));
        if (!job) return refuse("Which ticket? That one isn't on the book.", 404);
        let filed = 0;
        if (item.attachments > 0) {
          const msg = await gmail(`messages/${item.message_id}?format=full`);
          for (const a of attachmentsOf(msg.payload)) { await fileAttachment(sql, job.id, item.message_id, a); filed++; }
        }
        const [r] = norm(await sql`UPDATE mail_items SET job_id = ${job.id}, state = 'filed',
          what = ${filed ? `${filed} file${filed === 1 ? "" : "s"} → ${M.ticketName(job)}` : `Filed on ${M.ticketName(job)}`} WHERE id = ${id} RETURNING *`);
        return json({ ...r, filed });
      }
      if (m === "POST" && id && action === "skip") {
        const [r0] = norm(await sql`SELECT message_id FROM mail_items WHERE id = ${id}`);
        const isLabel = r0 ? !!(await getStore({ name: "mail-labels", consistency: "strong" }).get(`pending/${r0.message_id}`)) : false;
        const [r] = await sql`UPDATE mail_items SET state = 'skipped', what = ${isLabel ? 'Not ours (label)' : 'Not ours'} WHERE id = ${id} RETURNING *`;
        // a labeled email he says isn't ours: the label comes off so it is never listed again
        const threads = getStore({ name: "mail-labels", consistency: "strong" });
        const pend: any = r ? await threads.get(`pending/${r.message_id}`, { type: "json" }) : null;
        if (pend) {
          await unlabel(r.message_id, pend.label_id); await threads.delete(`pending/${r.message_id}`);
          const tp: any = await threads.get(`pending-thread/${pend.thread}`, { type: "json" });
          for (const mid of (tp?.more || [])) { await unlabel(mid, pend.label_id); await sql`UPDATE mail_items SET state = 'skipped', what = 'Not ours (label)' WHERE message_id = ${mid}`; }
          await threads.delete(`pending-thread/${pend.thread}`);
        }
        return json(norm(r));
      }
    }

    // ================= STEP 1: WHO AND WHERE =================
    // Customer → property → tenant, each one picked from what he already has or typed new.
    // Nothing here touches QuickBooks or the schedule. Only Awarded does that.
    if (kind === "bid-start" && m === "POST") {
      const b = await body();
      const custName = String(b.customer_name || "").trim();
      const address = String(b.address || "").trim();
      // A BID STARTS WITH WHATEVER HE HAS. No name yet, no address yet — it still starts.
      const startMiss = [...(custName ? [] : ["the customer"]), ...(address ? [] : ["the address"])];
      let custId = Number(b.customer_id) || 0;
      if (!custId) {
        const [existing] = norm(await sql`SELECT id FROM customers WHERE LOWER(name) = ${custName.toLowerCase()}`);
        custId = existing ? existing.id : (await sql`INSERT INTO customers (name) VALUES (${custName}) RETURNING *`)[0].id;
      }
      let propId = Number(b.property_id) || 0;
      if (!propId) {
        const key = addressKey(address);
        const [existing] = norm(await sql`SELECT id FROM properties WHERE address_key = ${key} AND city = ${String(b.city || "")}`);
        propId = existing ? existing.id : (await sql`INSERT INTO properties (customer_id, address, address_key, city)
          VALUES (${custId}, ${address}, ${key}, ${String(b.city || "")}) RETURNING *`)[0].id;
      }
      const tenant = String(b.tenant_name || "").trim();
      const [job] = norm(await sql`INSERT INTO jobs (property_id, tag, title, notes, stage, tenant_name, bid_due)
        VALUES (${propId}, 'BID', ${tenant || address}, '', 'ready', ${tenant}, ${b.bid_due || null}) RETURNING *`);
      return json({ job_id: job.id, customer_id: custId, property_id: propId, missing: startMiss }, 201);
    }

    // ================= STEP 2: THE PILLS, ONE LAYER AT A TIME =================
    if (kind === "bid-option" && id && m === "POST") {
      const b = await body();
      const cat = String(b.cat || "").trim(), grp = String(b.grp || "").trim(), name = String(b.name || "").trim();
      if (!cat || !grp || !name) return refuse("No pill came through on that tap.", 400);
      if (b.remove) await sql`DELETE FROM bid_options WHERE job_id = ${id} AND cat = ${cat} AND grp = ${grp} AND name = ${name}`;
      else if (b.one) {
        await sql`DELETE FROM bid_options WHERE job_id = ${id} AND cat = ${cat} AND grp = ${grp}`;
        await sql`INSERT INTO bid_options (job_id, cat, grp, name) VALUES (${id}, ${cat}, ${grp}, ${name})`;
      } else await sql`INSERT INTO bid_options (job_id, cat, grp, name) VALUES (${id}, ${cat}, ${grp}, ${name}) ON CONFLICT DO NOTHING`;
      return json(norm(await sql`SELECT * FROM bid_options WHERE job_id = ${id} ORDER BY id`));
    }

    // ================= TELL IT WHAT THE JOB IS =================
    // One box. He types or dictates the job; the app finds the property, picks the templates and sets the due date.
    if (kind === "bid-talk" && m === "POST") {
      const b = await body();
      const said = String(b.text || "").trim();
      if (!said) return refuse("Nothing was typed in the box.", 400);
      const read = TALK.readBid(said, today());
      if (!read.address) return refuse("No address in that — start with it, like \"2409 Eastlake, TPO tear off, due Friday\".", 400);
      const key = addressKey(read.address);
      const props = norm(await sql`SELECT p.*, c.name AS customer_name FROM properties p JOIN customers c ON c.id = p.customer_id`);
      let prop = props.find((p: any) => p.address_key === key)
        || props.find((p: any) => p.address_key.startsWith(key) || key.startsWith(p.address_key));
      if (!prop) {
        // never guess whose it is
        if (!b.customer_id && !String(b.new_customer || "").trim()) {
          return json({ need: "customer", address: read.address, read, customers: norm(await sql`SELECT id, name FROM customers ORDER BY LOWER(name)`) });
        }
        let custId = Number(b.customer_id) || 0;
        if (!custId) {
          const [c] = await sql`INSERT INTO customers (name) VALUES (${String(b.new_customer).trim()}) RETURNING *`;
          custId = c.id;
        }
        const [p] = await sql`INSERT INTO properties (customer_id, address, address_key, city) VALUES (${custId}, ${read.address}, ${key}, ${String(b.city || "")}) RETURNING *`;
        prop = norm(p);
      }
      const title = read.systems.length
        ? read.systems.map((s: any) => TALK.saySystem(s) + (s.size ? ` (${s.size})` : "")).join(" + ")
        : said.slice(0, 60);
      const [job] = norm(await sql`INSERT INTO jobs (property_id, tag, title, notes, stage, bid_due, bid_said, bid_cat, bid_system)
        VALUES (${prop.id}, 'BID', ${title}, '', 'ready', ${read.due || null}, ${said}, ${read.systems[0]?.cat || ""}, ${read.systems[0]?.system || ""}) RETURNING *`);
      for (const s of read.systems) await sql`INSERT INTO bid_systems (job_id, cat, system, size) VALUES (${job.id}, ${s.cat}, ${s.system}, ${s.size}) ON CONFLICT DO NOTHING`;
      return json({ job_id: job.id, property: prop.address, customer: prop.customer_name, read }, 201);
    }

    // ================= BIDS (half 1) =================
    // A bid lives here until Awarded. Only what he owes somebody is chased; a sent bid is filed and never followed up.
    if (kind === "bids") {
      if (m === "GET" && !id) {
        const rows = norm(await sql`${JOB_COLS(sql)} WHERE j.tag = 'BID' AND j.awarded_at IS NULL ORDER BY j.bid_due NULLS LAST, LOWER(p.address)`);
        const awarded = norm(await sql`${JOB_COLS(sql)} WHERE j.tag = 'BID' AND j.awarded_at IS NOT NULL ORDER BY j.awarded_at DESC`);
        return json({ owe: rows.filter((b: any) => !b.bid_sent_at), sent: rows.filter((b: any) => b.bid_sent_at), awarded, today: today() });
      }
      if (m === "POST" && !id) {
        const b = await body();
        // A BID SAVES WITH NO PROPERTY AND NO NAME ON IT YET — both come back as notes.
        const propertyId = Number(b.property_id) || null;
        const title = String(b.title || "").trim();
        const miss = [...(propertyId ? [] : ["the property it's for"]), ...(title ? [] : ["what the bid is"])];
        const [r] = await sql`INSERT INTO jobs (property_id, tag, title, notes, bid_due, bid_amount, stage)
          VALUES (${propertyId}, 'BID', ${title}, ${String(b.notes || "")}, ${b.bid_due || null}, ${b.bid_amount === "" || b.bid_amount == null ? null : Number(b.bid_amount)}, 'ready') RETURNING *`;
        return json({ ...norm(r), missing: miss }, 201);
      }
      const bid = id ? norm(await loadJob(id)) : null;
      if (!bid || bid.tag !== "BID") return refuse("That bid doesn't exist.", 404);
      if (m === "PUT" && !action) {
        const b = await body();
        const [r] = await sql`UPDATE jobs SET title = ${String(b.title ?? bid.title)}, bid_due = ${b.bid_due === undefined ? bid.bid_due : (b.bid_due || null)},
          bid_amount = ${b.bid_amount === undefined ? bid.bid_amount : (b.bid_amount === "" || b.bid_amount == null ? null : Number(b.bid_amount))},
          bid_cat = ${b.bid_cat === undefined ? bid.bid_cat : String(b.bid_cat || "")},
          bid_system = ${b.bid_system === undefined ? bid.bid_system : String(b.bid_system || "")} WHERE id = ${id} RETURNING *`;
        return json(norm(r));
      }
      if (m === "POST" && action === "system") {
        const b = await body();
        const cat = String(b.cat || "").trim(), system = String(b.system || "").trim();
        if (!cat) return refuse("No system came through on that tap.", 400);
        if (b.remove) await sql`DELETE FROM bid_systems WHERE job_id = ${id} AND cat = ${cat} AND system = ${system}`;
        else await sql`INSERT INTO bid_systems (job_id, cat, system, size) VALUES (${id}, ${cat}, ${system}, ${String(b.size || "")}) ON CONFLICT DO NOTHING`;
        return json(norm(await sql`SELECT * FROM bid_systems WHERE job_id = ${id} ORDER BY id`));
      }
      if (m === "POST" && action === "sent") {
        const b = await body();
        const [r] = await sql`UPDATE jobs SET bid_sent_at = ${b.value === false ? null : (b.on || today())} WHERE id = ${id} RETURNING *`;
        return json(norm(r));
      }
      if (m === "POST" && action === "awarded") {
        // Awarded makes the real ticket, opens its ledger, and sets the contract the draws bill off.
        const b = await body();
        const tag = String(b.tag || "JC").toUpperCase();
        if (!M.isWork(tag)) return refuse("Pick what the ticket is: JC, UC, R or CO.");
        if (bid.awarded_at) return refuse("That bid is already awarded.");
        const contract = b.contract === "" || b.contract == null ? (bid.bid_amount == null ? null : Number(bid.bid_amount)) : Number(b.contract);
        const client = await db.pool.connect();
        try {
          await client.query("BEGIN");
          const ins = await client.query(`INSERT INTO jobs (property_id, tag, title, notes, stage, job_contract) VALUES ($1, $2, $3, $4, 'ready', $5) RETURNING id`,
            [bid.property_id, tag, bid.title, `Awarded from the bid ${M.money(contract || 0)} on ${today()}`, tag === "UC" ? contract : null]);
          const jobId = ins.rows[0].id;
          if (tag === "JC" && contract != null) await client.query(`UPDATE properties SET contract_amount = $1 WHERE id = $2`, [contract, bid.property_id]);
          await client.query(`UPDATE jobs SET awarded_at = $1, awarded_job_id = $2, bid_amount = COALESCE(bid_amount, $3) WHERE id = $4`, [today(), jobId, contract, id]);
          await client.query("COMMIT");
          return json({ job_id: jobId, tag, contract }, 201);
        } catch (e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); }
      }
      return refuse("Unknown bid request.", 404);
    }

    // ================= AR =================
    if (kind === "ar" && m === "GET") {
      const rows = norm(await sql`SELECT i.*, j.tag, j.title, j.id AS job_id, p.address, p.city, p.tenant, c.name AS customer_name, c.id AS customer_id, (SELECT pj.title FROM jobs pj WHERE pj.id = j.parent_job_id) AS parent_title
        FROM invoices i JOIN jobs j ON j.id = i.job_id JOIN properties p ON p.id = j.property_id JOIN customers c ON c.id = p.customer_id
        WHERE i.kind IN ('real','draw') AND i.sent_at IS NOT NULL AND i.paid_at IS NULL ORDER BY i.sent_at`);
      const open = rows.filter((r: any) => M.inAR(r));
      const cost = await costFor([...new Set(open.map((r: any) => r.job_id))] as number[]);
      // DONE MEANS MONEY: every done, unpaid ticket that can't be in AR yet (no amount / no real number / never sent)
      const doneJobs = norm(await sql`${JOB_COLS(sql)} WHERE j.tag <> 'BID' AND j.done_at IS NOT NULL AND NOT j.no_charge ORDER BY j.done_at`);
      const dIds = doneJobs.map((j: any) => j.id);
      const dInvs = dIds.length ? norm(await sql`SELECT * FROM invoices WHERE job_id = ANY(${dIds}::int[])`) : [];
      const stuck = doneJobs.map((j: any) => { const mineInvs = dInvs.filter((i: any) => i.job_id === j.id);
        // AR is sent invoices only (his rule 9/17). A done ticket still on Invoicing or Tabled is NOT shown here — only one that is on no other screen.
        if (M.inInvoicing(j, mineInvs) || j.tabled_at) return null;
        const why = M.doneNotPaid(j, dInvs); return why ? { ...j, why, invoices: dInvs.filter((i: any) => i.job_id === j.id) } : null; }).filter(Boolean);
      return json({ rows: open.map((r: any) => ({ ...r, balance: M.round2(Number(r.amount)), cost: cost[r.job_id] || 0 })), stuck, today: today() });
    }

    // ================= TICKET PICKER =================
    if (kind === "tickets" && m === "GET") {
      return json(norm(await sql`${JOB_COLS(sql)} WHERE j.tag <> 'BID' ORDER BY (j.done_at IS NOT NULL), (j.tag = 'R') DESC, LOWER(p.address)`));
    }

    // ================= SUPPLY INVOICES =================
    if (kind === "supply") {
      // the order he dragged them into; a credit dropped under a bill ties to that bill
      if (m === "PUT" && idRaw === "order") {
        const b = await body();
        const rows = (b.rows || []) as any[];
        if (!rows.length) return refuse("Nothing to put in order — the list came in empty.", 400);
        for (let n = 0; n < rows.length; n++) {
          await sql`UPDATE supply_invoices SET ord = ${n}, credit_of = ${rows[n].credit_of ? Number(rows[n].credit_of) : null} WHERE id = ${Number(rows[n].id)}`;
        }
        return json(norm(await sql`SELECT id, ord, credit_of FROM supply_invoices WHERE id = ANY(${rows.map((r: any) => Number(r.id))}::int[]) ORDER BY ord`));
      }
      // ONE CLICK PAID — same as the pay ledger on Subs. Click marks it paid with today's date, click again takes it back.
      if (m === "PUT" && id && action === "paid") {
        const b = await body();
        // paid with no date on it: settled before this book, and a date nobody knows is never invented
        const [r] = b.no_date
          ? await sql`UPDATE supply_invoices SET settled = ${!!b.paid}, paid_at = NULL WHERE id = ${id} RETURNING *`
          : await sql`UPDATE supply_invoices SET paid_at = ${b.paid ? (b.on || today()) : null}, settled = FALSE WHERE id = ${id} RETURNING *`;
        if (!r) return refuse("That invoice doesn't exist.", 404);
        return json(norm(r));
      }
      // TERMS — he switches them himself on the bill, and the due date moves with them.
      // Nothing else on the invoice is touched, so this never asks him to put the lines on a job first.
      if (m === "PUT" && id && action === "terms") {
        const b = await body();
        const [inv] = norm(await sql`SELECT inv_date FROM supply_invoices WHERE id = ${id}`);
        if (!inv) return refuse("That invoice doesn't exist.", 404);
        const due = M.dueFromTerms(inv.inv_date, String(b.terms || ""));
        if (due === undefined) return refuse("Terms it knows: " + M.TERMS.map((t: any) => t.l).join(", "), 400);
        // no invoice date yet: there is nothing to count the terms from, so the due date is left blank
        // and that is said out loud. The bill itself is untouched and still saves like everything else.
        const [r] = await sql`UPDATE supply_invoices SET due_date = ${due} WHERE id = ${id} RETURNING *`;
        return json({ ...norm(r), missing: due === null ? ["the invoice date — terms count from the day it was written"] : [] });
      }
      // the three checks, the dispute flag, how it books, and the terms — changed from the invoice page
      if (m === "PUT" && id && action === "flags") {
        const b = await body();
        const [r] = await sql`UPDATE supply_invoices SET
          qty_ok = ${String(b.qty_ok ?? "")}, prod_ok = ${String(b.prod_ok ?? "")}, price_ok = ${String(b.price_ok ?? "")},
          checked_at = ${b.checked_at || null}, dispute = ${String(b.dispute ?? "")},
          books_as = ${String(b.books_as || "Material")},
          needs_reading = ${!!b.needs_reading}, credit_of = ${b.credit_of ? Number(b.credit_of) : null}
          WHERE id = ${id} RETURNING *`;
        return json(norm(r));
      }
      // THE HOUSES THEMSELVES. A house is a record, not a word typed on an invoice —
      // it is on the page with its own ledger from the day it is added, empty or not.
      if (m === "POST" && idRaw === "house") {
        const b = await body();
        const name = String(b.name || "").trim();
        if (!name) return refuse("Type the name and it goes on the book.", 400);
        const [dupe] = norm(await sql`SELECT * FROM supply_houses WHERE LOWER(name) = ${name.toLowerCase()}`);
        if (dupe) return refuse(`${dupe.name} is already on the book.`);
        const [h] = norm(await sql`INSERT INTO supply_houses (name) VALUES (${name}) RETURNING *`);
        return json(h, 201);
      }
      // A STACK OF INVOICES AT ONCE — read off the paper, written exactly as read.
      // Lines land on NO job on purpose: every dollar shows in "Not on a job yet" until he puts it somewhere.
      if (m === "POST" && idRaw === "import") {
        const b = await body();
        const house = String(b.house || "").trim();
        if (!house) return refuse("These came in with no supply house on them.", 400);
        const made: any[] = [], skipped: any[] = [];
        for (const r of (b.invoices || [])) {
          const number = String(r.number || "").trim();
          if (!number) { skipped.push({ why: "no invoice number on it" }); continue; }
          const [dupe] = norm(await sql`SELECT id FROM supply_invoices WHERE LOWER(house) = ${house.toLowerCase()} AND number = ${number}`);
          if (dupe) { skipped.push({ number, why: "already on the book" }); continue; }
          const [inv] = norm(await sql`INSERT INTO supply_invoices (house, number, inv_date, due_date, po, amount, notes, needs_reading)
            VALUES (${house}, ${number}, ${r.inv_date}, ${r.due_date || null}, ${String(r.po || "")}, ${Number(r.amount) || 0}, ${String(r.notes || "")}, FALSE) RETURNING *`);
          for (const l of (r.lines || [])) {
            await sql`INSERT INTO supply_lines (invoice_id, sku, description, qty, unit, unit_price, line_total)
              VALUES (${inv.id}, ${String(l.sku || "")}, ${String(l.description || "")}, ${Number(l.qty) || 0}, ${String(l.unit || "")}, ${Number(l.unit_price) || 0}, ${Number(l.line_total) || 0})`;
          }
          made.push({ id: inv.id, number, amount: Number(inv.amount), lines: (r.lines || []).length });
        }
        return json({ made, skipped }, 201);
      }
      // ONE VENDOR, ONE LEDGER. Renaming a house carries every invoice already written
      // against the old name with it, in one transaction — a vendor never ends up on two pages.
      if (m === "PUT" && idRaw === "house") {
        const b = await body();
        const from = String(b.from || "").trim(), to = String(b.to || "").trim();
        if (!from || !to) return refuse("A rename needs the old name and the new one.", 400);
        const [h] = norm(await sql`SELECT * FROM supply_houses WHERE LOWER(name) = ${from.toLowerCase()}`);
        if (!h) return refuse(`${from} isn't on the book.`, 404);
        const [clash] = norm(await sql`SELECT * FROM supply_houses WHERE LOWER(name) = ${to.toLowerCase()} AND id <> ${h.id}`);
        if (clash) return refuse(`${clash.name} is already on the book — two houses cannot share a name.`);
        const client = await db.pool.connect();
        let moved = 0;
        try {
          await client.query("BEGIN");
          await client.query(`UPDATE supply_houses SET name = $1 WHERE id = $2`, [to, h.id]);
          const r = await client.query(`UPDATE supply_invoices SET house = $1 WHERE house = $2`, [to, h.name]);
          moved = r.rowCount || 0;
          await client.query("COMMIT");
        } catch (e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); }
        return json({ was: h.name, name: to, invoices_moved: moved });
      }
      if (m === "GET" && !id) {
        const invs = norm(await sql`SELECT s.*,
            (SELECT COUNT(*)::int FROM supply_lines l WHERE l.invoice_id = s.id) AS line_count,
            (SELECT COALESCE(SUM(l.line_total),0) FROM supply_lines l WHERE l.invoice_id = s.id) AS lines_sum,
            (SELECT COALESCE(SUM(pl.amount),0) FROM payment_lines pl JOIN payments p ON p.id = pl.payment_id WHERE pl.invoice_id = s.id AND p.voided_at IS NULL) AS paid_sum,
            (SELECT COUNT(*)::int FROM files f WHERE f.supply_invoice_id = s.id AND f.complete) AS file_count,
            (SELECT COALESCE(SUM(l.line_total),0) FROM supply_lines l WHERE l.invoice_id = s.id AND l.job_id IS NULL AND NOT l.shop) AS unplaced
          FROM supply_invoices s ORDER BY s.house, s.ord NULLS LAST, COALESCE(s.due_date, s.inv_date), s.id`);
        const payments = norm(await sql`SELECT * FROM payments ORDER BY pay_date DESC, id DESC`);
        const plines = norm(await sql`SELECT pl.*, s.number, s.amount AS invoice_amount FROM payment_lines pl JOIN supply_invoices s ON s.id = pl.invoice_id`);
        const houses = norm(await sql`SELECT * FROM supply_houses ORDER BY ord NULLS LAST, name`);
        return json({ houses, invoices: invs, payments: payments.map((p: any) => ({ ...p, lines: plines.filter((l: any) => l.payment_id === p.id) })) });
      }
      if (m === "GET" && id) {
        const [inv] = norm(await sql`SELECT * FROM supply_invoices WHERE id = ${id}`);
        if (!inv) return refuse("That invoice doesn't exist.", 404);
        inv.lines = norm(await sql`SELECT l.*, j.tag, j.title, p.address FROM supply_lines l LEFT JOIN jobs j ON j.id = l.job_id
          LEFT JOIN properties p ON p.id = j.property_id WHERE l.invoice_id = ${id} ORDER BY l.id`);
        inv.files = norm(await sql`SELECT id, name, size_bytes FROM files WHERE supply_invoice_id = ${id} AND complete`);
        return json(inv);
      }
      if ((m === "POST" && !id) || (m === "PUT" && id)) {
        const b = await body();
        const lines = (b.lines || []).map((l: any) => ({ ...l, job_id: l.shop ? null : (l.job_id ? Number(l.job_id) : null), shop: !!l.shop }));
        // "SAVE IS NEVER BLOCKED" (9/20/26). Whatever is on the screen goes in the book — no house,
        // no number, no date, lines that don't tie, lines not on a job yet. What is missing comes
        // back as `missing` and the page writes it down until he knows the answer.
        const miss = M.missingOnSupplyInvoice(b, lines);
        const client = await db.pool.connect();
        try {
          await client.query("BEGIN");
          let invId = id;
          if (id) {
            await client.query(`UPDATE supply_invoices SET house=$1, number=$2, inv_date=$3, due_date=$4, po=$5, amount=$6, notes=$7, books_as=$9, ship_date=$10 WHERE id=$8`,
              [String(b.house || "").trim(), String(b.number || "").trim(), b.inv_date || null, b.due_date || null, b.po || "", Number(b.amount) || 0, b.notes || "", id, b.books_as || "Material", b.ship_date || null]);
            await client.query(`DELETE FROM supply_lines WHERE invoice_id = $1`, [id]);
          } else {
            const r = await client.query(`INSERT INTO supply_invoices (house, number, inv_date, due_date, po, amount, notes) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
              [String(b.house || "").trim(), String(b.number || "").trim(), b.inv_date || null, b.due_date || null, b.po || "", Number(b.amount) || 0, b.notes || ""]);
            invId = r.rows[0].id;
          }
          for (const l of lines) {
            await client.query(`INSERT INTO supply_lines (invoice_id, sku, description, qty, unit, unit_price, line_total, job_id, shop) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
              [invId, l.sku || "", String(l.description || "").trim(), Number(l.qty) || 0, l.unit || "", l.unit_price === "" || l.unit_price == null ? null : Number(l.unit_price), Number(l.line_total) || 0, l.job_id, l.shop]);
          }
          await client.query("COMMIT");
          return json({ id: invId, missing: miss }, id ? 200 : 201);
        } catch (e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); }
      }
    }

    // ================= SUPPLY PAYMENTS =================
    if (kind === "payments") {
      if (m === "POST" && !id) {
        const b = await body();
        const lines = (b.lines || []).filter((l: any) => l.invoice_id && Number(l.amount) !== 0);
        // the house and the date can still be blank — what it cannot be is a payment against nothing
        if (!lines.length) return refuse("Tick at least one invoice — a payment has to come off something.", 400);
        const client = await db.pool.connect();
        try {
          await client.query("BEGIN");
          const r = await client.query(`INSERT INTO payments (house, pay_date, method, ref, note) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
            [String(b.house || "").trim(), b.pay_date || null, b.method || "", b.ref || "", b.note || ""]);
          for (const l of lines) await client.query(`INSERT INTO payment_lines (payment_id, invoice_id, amount, surcharge_pct) VALUES ($1,$2,$3,$4)`,
            [r.rows[0].id, Number(l.invoice_id), Number(l.amount), Number(l.surcharge_pct || 0)]);
          await client.query("COMMIT");
          return json({ id: r.rows[0].id, totals: M.paymentTotals(lines) }, 201);
        } catch (e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); }
      }
      if (m === "POST" && id && action === "void") {
        const [r] = await sql`UPDATE payments SET voided_at = NOW() WHERE id = ${id} RETURNING *`;
        return json(norm(r));
      }
    }

    return json({ error: "Unknown request" }, 404);
  } catch (e: any) {
    return json({ error: String(e?.message || e) }, 500);
  }
};

export const config: Config = { path: "/w/*" };
