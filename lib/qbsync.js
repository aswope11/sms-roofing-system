// QuickBooks customer match + new-invoice sync (10/7/26).
// New syncs only. Never updates, voids, deletes, or re-pushes a QuickBooks invoice this sync did not create.
// A missing parent is an error — a parent customer is never created. A missing property sub-customer is created once.
import * as M from "./money.js";

const DROP = new Set(["inc", "incorporated", "llc", "co", "company", "companies", "ltd", "corp", "the", "roofing"]);
const EXTRA_OK = new Set(["property", "properties", "group", "holdings", "enterprises"]);
const SUFFIX = {
  street: "st", st: "st", road: "rd", rd: "rd", avenue: "ave", ave: "ave", parkway: "pkwy", pkwy: "pkwy",
  drive: "dr", dr: "dr", lane: "ln", ln: "ln", boulevard: "blvd", blvd: "blvd", court: "ct", ct: "ct",
  trail: "trl", trl: "trl", place: "pl", pl: "pl", highway: "hwy", hwy: "hwy", circle: "cir", cir: "cir",
  freeway: "fwy", fwy: "fwy", expressway: "expy", expy: "expy",
};
const SUFFIX_VALUES = new Set(Object.values(SUFFIX));
const DIR = { n: "n", north: "n", s: "s", south: "s", e: "e", east: "e", w: "w", west: "w" };
const DIR_VALUES = new Set(Object.values(DIR));
const OWED_KINDS = new Set(["placeholder", "co_line"]);

const BUCKET_NAMES = {
  UC: ["uc", "unit cost", "unit-cost"],
  CO: ["co", "change order", "change orders"],
  R: ["r", "repair", "repairs"],
};

export function normTokens(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\bbrothers\b/g, "bros")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(w => w && !DROP.has(w));
}

// "Wortham Brothers Roofing" and "Wortham Bros., Inc." are the same company.
// "Four Corners Property Company" and "Four Corners" are the same company.
export function sameParty(a, b) {
  const x = normTokens(a), y = normTokens(b);
  if (!x.length || !y.length) return false;
  if (x.join(" ") === y.join(" ")) return true;
  const [shorter, longer] = x.length <= y.length ? [x, y] : [y, x];
  if (longer.slice(0, shorter.length).join(" ") !== shorter.join(" ")) return false;
  return longer.slice(shorter.length).every(t => EXTRA_OK.has(t));
}

export function addrTokens(address) {
  return String(address || "").toLowerCase().replace(/\./g, "").replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean).map(t => DIR[t] || SUFFIX[t] || t);
}

// "216 W. Mulberry St" matches "216 West Mulberry Street". A different street suffix does not.
// "6101 Windhaven" still matches "6101 Windhaven Parkway" when one side has no suffix.
export function addrMatches(propertyAddress, qbName) {
  const want = addrTokens(propertyAddress);
  if (!want.length) return false;
  const name = addrTokens(qbName);
  const num = want[0];
  if (!/^\d/.test(num)) return name.join(" ").includes(want.join(" "));
  const idx = name.indexOf(num);
  if (idx < 0) return false;
  const after = name.slice(idx + 1);
  const wantSuffix = want.find(t => SUFFIX_VALUES.has(t)) || "";
  const nameSuffix = name.slice(idx).find(t => SUFFIX_VALUES.has(t)) || "";
  if (wantSuffix && nameSuffix && wantSuffix !== nameSuffix) return false;
  const wantDirs = want.slice(1).filter(t => DIR_VALUES.has(t));
  if (wantDirs.length && !wantDirs.every(d => after.includes(d))) return false;
  const words = want.slice(1).filter(t => !SUFFIX_VALUES.has(t) && !DIR_VALUES.has(t));
  return words.every(w => after.includes(w));
}

function tenantPart(name) {
  const s = String(name || "");
  const i = s.lastIndexOf(" - ");
  return i < 0 ? "" : s.slice(i + 3).trim().toLowerCase();
}

export function subDisplayName(job) {
  const place = [String(job.address || "").trim(), String(job.city || "").trim()].filter(Boolean).join(", ");
  const tenant = String(job.tenant || "").trim();
  return [place, tenant].filter(Boolean).join(" - ");
}

// "Gravel stop and reflash the posts" → "Change order gravel stop and reflash posts"
export function changeOrderLabel(title) {
  let t = String(title || "").replace(/\bthe\b/gi, " ").replace(/\s+/g, " ").trim();
  t = t.replace(/^change order\s+/i, "").trim();
  if (!t) t = "work";
  return "Change order " + t.charAt(0).toLowerCase() + t.slice(1);
}

export function mdyy(iso) {
  const [y, mo, d] = String(iso || "").slice(0, 10).split("-");
  if (!y || !mo || !d) return "";
  return `${Number(mo)}/${Number(d)}/${y.slice(2)}`;
}

export function dayLineDescription(workDate, labor, materialCost, tag) {
  const parts = [`Date: ${mdyy(workDate)}`];
  for (const l of labor || []) parts.push(l.how + (l.amount != null ? ` = ${M.money(l.amount)}` : ""));
  if (Number(materialCost)) parts.push(`Material ${M.money(materialCost)}${tag === "JC" ? "" : " × 1.2"} = ${M.money(M.billMaterial(materialCost, tag))}`);
  return parts.join("\n\n");
}

export function lineHasDay(lines, workDate) {
  const date = `Date: ${mdyy(workDate)}`;
  return (lines || []).some(l => l && l.DetailType === "SalesItemLineDetail" && String(l.Description || "").includes(date));
}

// The latest dated sales line still on the invoice, as YYYY-MM-DD. Empty when none remain.
export function latestCoveredDate(lines) {
  let best = "";
  for (const l of lines || []) {
    if (!l || l.DetailType !== "SalesItemLineDetail") continue;
    const m = String(l.Description || "").match(/Date:\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
    if (!m) continue;
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    const iso = `${y}-${String(m[1]).padStart(2, "0")}-${String(m[2]).padStart(2, "0")}`;
    if (iso > best) best = iso;
  }
  return best;
}

// A change-order day is covered only when that day itself is on an invoice (a done claim, or a claim that already has a QuickBooks id).
// The running invoice's latest date does not cover earlier days. Other tickets still use covers_through.
export function dayIsCovered(job, workDate, { covers = [], claims = [] } = {}) {
  const day = v => String(v || "").slice(0, 10);
  const d = day(workDate);
  if (!d) return false;
  if (job && job.tag === "CO") {
    return (claims || []).some(c => Number(c.job_id) === Number(job.id) && day(c.work_date) === d && (c.state === "done" || String(c.qb_id || "")));
  }
  return (covers || []).some(x => Number(x.job_id) === Number(job.id) && day(x.covers_through) && day(x.covers_through) >= d);
}

const isParent = c => !c.Job && !c.ParentRef?.value;

export function matchParent(customerName, customers) {
  const parents = (customers || []).filter(isParent);
  const hits = parents.filter(c => sameParty(customerName, c.DisplayName) || sameParty(customerName, c.FullyQualifiedName));
  if (hits.length === 1) return { customer: hits[0] };
  if (hits.length > 1) return { error: `QuickBooks has ${hits.length} customers named like "${customerName}": ${hits.map(c => c.DisplayName).join(" / ")}. Pick the parent on the customer page — none was created.` };
  return { error: `No QuickBooks customer matches "${customerName}". Pick the QuickBooks customer on the customer page — a new one was not created.` };
}

function underParent(parent, customer) {
  if (String(customer.Id) === String(parent.Id)) return false;
  if (String(customer.ParentRef?.value || "") === String(parent.Id)) return true;
  const p = parent.FullyQualifiedName || parent.DisplayName || "";
  const fqn = customer.FullyQualifiedName || "";
  return !!(p && fqn.startsWith(p + ":"));
}

function depth(customer) {
  return String(customer.FullyQualifiedName || customer.DisplayName || "").split(":").length;
}

export function matchSub(job, parent, customers) {
  const kids = (customers || []).filter(c => underParent(parent, c) && addrMatches(job.address, `${c.DisplayName || ""} ${c.FullyQualifiedName || ""}`));
  const tenant = String(job.tenant || "").trim().toLowerCase();
  const pool = kids.filter(c => {
    const part = tenantPart(c.DisplayName) || tenantPart(c.FullyQualifiedName);
    if (!tenant || !part) return true;
    return part === tenant || part.includes(tenant) || tenant.includes(part);
  });
  if (!pool.length) return { customer: null };
  pool.sort((a, b) => depth(a) - depth(b));
  let shallow = pool.filter(c => depth(c) === depth(pool[0]));
  if (shallow.length > 1) {
    const city = String(job.city || "").trim().toLowerCase();
    if (city) {
      const byCity = shallow.filter(c => `${c.DisplayName} ${c.FullyQualifiedName}`.toLowerCase().includes(city));
      if (byCity.length === 1) return { customer: byCity[0] };
      if (byCity.length > 1) shallow = byCity;
    }
  }
  if (shallow.length === 1) return { customer: shallow[0] };
  const names = shallow.map(c => c.FullyQualifiedName || c.DisplayName);
  return { error: `QuickBooks has ${names.length} customers at ${job.address}: ${names.join(" / ")}. Pick the property on the customer page — none was created.` };
}

// What the Match button shows. Nothing is written. "create" is only a property that already has work.
export function previewProperty(prop, parent, customers) {
  if (!parent) return { action: "ambiguous", error: "No parent customer to put this property under." };
  if (prop.qb_subcustomer_id) return { action: "match", qb_subcustomer_id: String(prop.qb_subcustomer_id), qb_subcustomer_name: prop.qb_subcustomer_name || "" };
  const hit = matchSub(prop, parent, customers);
  if (hit.error) return { action: "ambiguous", error: hit.error };
  if (hit.customer) return { action: "match", qb_subcustomer_id: String(hit.customer.Id), qb_subcustomer_name: hit.customer.FullyQualifiedName || hit.customer.DisplayName || "" };
  if (!(Number(prop.work_count) > 0)) return { action: "skip", error: "Bid only — a QuickBooks customer is not added until there is work." };
  return { action: "create", qb_subcustomer_name: subDisplayName(prop) };
}

function bucketNames(tag) {
  return BUCKET_NAMES[tag] || [];
}

function simple(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// Least disruption: existing books are parent → property. Use a deeper sub-customer or a class only when one already exists.
export function pickBucket(tag, propertySub, customers, classes) {
  const names = new Set(bucketNames(tag));
  const deeper = (customers || []).filter(c => String(c.ParentRef?.value || "") === String(propertySub.Id) && names.has(simple(c.DisplayName)));
  if (deeper.length === 1) return { customerId: deeper[0].Id, how: "subcustomer" };
  const cls = (classes || []).filter(c => names.has(simple(c.Name)));
  if (cls.length === 1) return { customerId: propertySub.Id, classId: cls[0].Id, how: "class" };
  return { customerId: propertySub.Id, how: "label" };
}

function qEsc(s) {
  return String(s || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

export async function listActiveCustomers(qb) {
  const all = [];
  let start = 1;
  for (;;) {
    const q = `SELECT Id, DisplayName, FullyQualifiedName, Job, ParentRef FROM Customer WHERE Active = true STARTPOSITION ${start} MAXRESULTS 1000`;
    const data = await qb("GET", `query?query=${encodeURIComponent(q)}`);
    const page = data.QueryResponse?.Customer || [];
    all.push(...page);
    if (page.length < 1000) break;
    start += 1000;
    if (start > 20000) break;
  }
  return all;
}

export async function listClasses(qb) {
  try {
    const data = await qb("GET", `query?query=${encodeURIComponent("SELECT Id, Name FROM Class WHERE Active = true MAXRESULTS 1000")}`);
    return data.QueryResponse?.Class || [];
  } catch {
    return [];
  }
}

async function findByDoc(qb, doc) {
  const data = await qb("GET", `query?query=${encodeURIComponent(`SELECT Id, DocNumber, TotalAmt FROM Invoice WHERE DocNumber = '${qEsc(doc)}'`)}`);
  const row = (data.QueryResponse?.Invoice || [])[0];
  if (!row) return null;
  const full = (await qb("GET", `invoice/${row.Id}`)).Invoice;
  return full || null;
}

function salesLine(amount, description, classId) {
  return {
    DetailType: "SalesItemLineDetail",
    Amount: amount,
    Description: description,
    SalesItemLineDetail: { ItemRef: { value: "1" }, Qty: 1, UnitPrice: amount, ...(classId ? { ClassRef: { value: classId } } : {}) },
  };
}

// The note on a new QuickBooks invoice. The crm# key is this job, this day, this kind — a shared memo is not enough.
export function syncNote(memo, jobId, workDate, kind) {
  return `${memo} · crm#${jobId}|${String(workDate).slice(0, 10)}|${kind}`;
}

// Lines to send back on an update. Subtotal is QuickBooks' own line. A dropped day is one dated sales line.
export function linesForUpdate(lines, dropDate) {
  const date = dropDate ? `Date: ${mdyy(dropDate)}` : "";
  return (lines || []).filter(l => {
    if (!l || l.DetailType === "SubTotalLineDetail") return false;
    if (date && l.DetailType === "SalesItemLineDetail" && String(l.Description || "").includes(date)) return false;
    return true;
  }).map(l => ({ ...l }));
}

// Reopen leaves the running change-order invoice alone. Other unsent real invoices still come back.
export function invoicesToUndo(invs, coInvoiceId) {
  const keep = String(coInvoiceId || "");
  return (invs || []).filter(i => {
    if (i.kind !== "real" || i.sent_at || i.paid_at) return false;
    if (keep && String(i.qb_id || "") === keep) return false;
    return true;
  });
}

// A real invoice uses the QuickBooks customer its placeholder is already on.
export function customerFromPlaceholder(phInvoice) {
  const id = phInvoice?.CustomerRef?.value;
  if (!id) return null;
  return { Id: String(id), DisplayName: phInvoice.CustomerRef.name || "" };
}

export function legacyPlaceholderWarning(placeholders) {
  const legacy = (placeholders || []).filter(p => p.kind === "placeholder" && !p.qb_sync && (String(p.qb_id || "") || String(p.number || "").trim() || Number(p.amount) > 0));
  if (!legacy.length) return "";
  const list = legacy.map(p => `#${p.number || "no number"} ${M.money(p.amount)}`).join(", ");
  return `Older placeholders stay in QuickBooks at full price and are not included on this invoice: ${list}. Add them by hand if the customer should be billed for those days.`;
}

// Days already on a QuickBooks placeholder or on a change-order invoice are left out of a new bill. Those placeholders are not zeroed.
export function coBillSplit(job, ready, invoices, claims = [], materialLines = []) {
  const day = v => String(v || "").slice(0, 10);
  const legacy = (invoices || []).filter(p => p.kind === "placeholder" && !p.qb_sync && (String(p.qb_id || "") || String(p.number || "").trim() || Number(p.amount) > 0));
  const skip = new Set();
  for (const p of invoices || []) {
    if (p.kind !== "placeholder" || !day(p.work_date)) continue;
    const legacyRow = !p.qb_sync && (String(p.qb_id || "") || String(p.number || "").trim() || Number(p.amount) > 0);
    if (legacyRow || String(p.qb_id || "")) skip.add(day(p.work_date));
  }
  for (const c of claims || []) {
    if (job && c.job_id != null && Number(c.job_id) !== Number(job.id)) continue;
    if ((c.state === "done" || String(c.qb_id || "")) && day(c.work_date)) skip.add(day(c.work_date));
  }
  const days = (ready?.days || []).filter(d => !skip.has(day(d.date)));
  const kept = (invoices || []).filter(p => !(p.kind === "placeholder" && skip.has(day(p.work_date))));
  const warning = legacyPlaceholderWarning(legacy);
  if (!days.length) return { ready: null, invoices: kept, warning, legacy };
  const labor = M.round2(days.reduce((a, d) => a + Number(d.labor_total || 0), 0));
  const mats = (materialLines || []).filter(l => (!job || l.job_id == null || Number(l.job_id) === Number(job.id)) && days.some(d => day(d.date) === day(l.inv_date)));
  const material_cost = M.round2(mats.reduce((a, l) => a + Number(l.line_total || 0), 0));
  const material = M.billMaterial(material_cost, job?.tag);
  const priced = days.every(d => (d.labor || []).every(l => l.amount != null));
  return {
    ready: { ...ready, days, through: day(days[days.length - 1].date), labor, material_cost, material, priced, total: priced ? M.round2(labor + material) : null },
    invoices: kept, warning, legacy,
  };
}

// Resolve once, then invoices go by id. Automatic sync never creates a sub-customer. Never creates a parent.
export async function resolveCustomer({ qb, store, job, cache, createSub = false }) {
  if (!M.canPlaceholder(job.tag)) return { error: "A JC never goes to QuickBooks." };
  const savedBucket = String(job.qb_bucket_customer_id || "");
  const savedClass = String(job.qb_class_id || "");
  if (job.qb_subcustomer_id && savedBucket) {
    const customerId = savedBucket === "self" ? job.qb_subcustomer_id : savedBucket;
    return {
      customerId, parentId: job.qb_customer_id || "", displayName: job.qb_subcustomer_name || "",
      classId: savedClass && savedClass !== "none" ? savedClass : "", createdSub: false,
    };
  }
  if (!cache.customers) cache.customers = await listActiveCustomers(qb);
  const list = cache.customers;
  let parent = null;
  if (job.qb_customer_id) parent = list.find(c => String(c.Id) === String(job.qb_customer_id)) || { Id: job.qb_customer_id, DisplayName: job.qb_customer_name || "", FullyQualifiedName: job.qb_customer_name || "" };
  else {
    const hit = matchParent(job.customer_name, list);
    if (hit.error) return hit;
    parent = hit.customer;
    await store.saveParent(job.customer_id, parent);
    job.qb_customer_id = parent.Id;
    job.qb_customer_name = parent.DisplayName || "";
  }
  let createdSub = false;
  let sub = null;
  if (job.qb_subcustomer_id) sub = list.find(c => String(c.Id) === String(job.qb_subcustomer_id)) || { Id: job.qb_subcustomer_id, DisplayName: job.qb_subcustomer_name || "" };
  else {
    const hit = matchSub(job, parent, list);
    if (hit.error) return hit;
    if (hit.customer) sub = hit.customer;
    else if (!createSub) return { error: "Link this property to QuickBooks on the customer page. Nothing was created." };
    else {
      const display = subDisplayName(job);
      if (!display) return { error: "No address on this property, so no QuickBooks sub-customer was created." };
      const made = (await qb("POST", "customer", { DisplayName: display, ParentRef: { value: String(parent.Id) }, Job: true, BillWithParent: false })).Customer;
      sub = made;
      list.push(made);
      createdSub = true;
    }
    await store.saveSub(job.property_id, sub);
    job.qb_subcustomer_id = sub.Id;
    job.qb_subcustomer_name = sub.DisplayName || sub.FullyQualifiedName || "";
  }
  if (!cache.classes) cache.classes = await listClasses(qb);
  const bucket = pickBucket(job.tag, sub, list, cache.classes);
  const bucketStored = bucket.how === "subcustomer" ? bucket.customerId : "self";
  const classStored = bucket.classId || "none";
  await store.saveBucket(job.id, bucketStored, classStored);
  job.qb_bucket_customer_id = bucketStored;
  job.qb_class_id = classStored;
  return { customerId: bucket.customerId, parentId: parent.Id, displayName: sub.DisplayName || "", classId: bucket.classId || "", createdSub, how: bucket.how };
}

function adopts(found, marker, customerId) {
  if (!found || String(found.PrivateNote || "") !== marker) return false;
  if (customerId && String(found.CustomerRef?.value || "") !== String(customerId)) return false;
  return true;
}

async function reserveDoc(qb, store, claim, nextNumber, marker, customerId) {
  if (claim.doc_number) {
    const found = await findByDoc(qb, claim.doc_number);
    if (adopts(found, marker, customerId)) return { doc: claim.doc_number, existing: found };
    if (!found) return { doc: claim.doc_number, existing: null };
  }
  let doc = claim.doc_number ? String(Number(claim.doc_number) + 1) : await nextNumber();
  for (let i = 0; i < 8; i++) {
    const found = await findByDoc(qb, doc);
    if (!found) {
      await store.updateClaim(claim.job_id, claim.work_date, { doc_number: doc });
      claim.doc_number = doc;
      return { doc, existing: null };
    }
    if (adopts(found, marker, customerId)) {
      await store.updateClaim(claim.job_id, claim.work_date, { doc_number: doc });
      claim.doc_number = doc;
      return { doc, existing: found };
    }
    doc = String(Number(doc) + 1);
  }
  throw new Error("QuickBooks said: could not find a free invoice number");
}

async function syncSlot({ qb, store, slot, nextNumber, cache }) {
  const job = slot.job;
  const label = M.ticketName(job);
  const kind = job.tag === "CO" ? "co_line" : "placeholder";
  if (!M.canPlaceholder(job.tag)) return { skipped: "jc" };
  const existing = await store.findPlaceholder(job.id, slot.work_date);
  if (existing && (existing.qb_id || !existing.qb_sync)) return { skipped: "seated" };
  const claim = await store.tryClaim(job.id, slot.work_date, { allowRetry: !!slot.allowRetry, staleMs: store.staleMs || 90000 });
  if (!claim.ok) return { skipped: claim.skip || "busy" };
  if (!(Number(slot.amount) > 0)) {
    const msg = `${label}: not priced — type the price on Send to QuickBooks`;
    await store.recordAttempt({ job_id: job.id, work_date: slot.work_date, kind, ok: false, qb_error: msg, qb_id: "" });
    await store.updateClaim(job.id, slot.work_date, { state: "failed" });
    return { error: msg };
  }
  try {
    const resolved = await resolveCustomer({ qb, store, job, cache });
    if (resolved.error) throw new Error(resolved.error);
    if (job.tag === "CO") return await syncCo({ qb, store, slot, nextNumber, resolved, label, claim: claim.row });
    return await syncPlaceholder({ qb, store, slot, nextNumber, resolved, label, existing, claim: claim.row });
  } catch (e) {
    const msg = String(e?.message || e);
    await store.recordAttempt({ job_id: job.id, work_date: slot.work_date, kind, ok: false, qb_error: msg, qb_id: "" });
    await store.updateClaim(job.id, slot.work_date, { state: "failed" });
    const ph = existing || await store.findPlaceholder(job.id, slot.work_date);
    if (ph?.id && !ph.qb_id) await store.updateInvoice(ph.id, { qb_error: msg });
    return { error: `${label}: ${msg}` };
  }
}

async function syncPlaceholder({ qb, store, slot, nextNumber, resolved, label, existing, claim }) {
  const job = slot.job;
  const memo = M.placeholderMemo(job, slot.work_date);
  const marker = syncNote(memo, job.id, slot.work_date, "placeholder");
  const reserved = await reserveDoc(qb, store, { ...claim, doc_number: claim.doc_number || existing?.number || "" }, nextNumber, marker, resolved.customerId);
  const amount = M.round2(Number(slot.amount));
  const desc = dayLineDescription(slot.work_date, slot.labor, slot.material_cost, job.tag);
  const invDate = M.addDays(slot.work_date, 14);
  let row = existing;
  if (!row) {
    row = await store.insertInvoice({
      job_id: job.id, kind: "placeholder", name: "", number: reserved.doc, amount, inv_date: invDate,
      work_date: slot.work_date, memo, qb_id: "", qb_error: "", qb_sync: true,
    });
    await store.updateClaim(job.id, slot.work_date, { invoice_id: row.id, doc_number: reserved.doc });
  }
  let qbInv = reserved.existing;
  if (!qbInv) {
    const made = (await qb("POST", "invoice", {
      CustomerRef: { value: String(resolved.customerId) }, DocNumber: reserved.doc, TxnDate: invDate, DueDate: invDate, PrivateNote: marker,
      Line: [salesLine(amount, desc, resolved.classId)],
    })).Invoice;
    const back = (await qb("GET", `invoice/${made.Id}`)).Invoice;
    if (!back || Number(back.TotalAmt) !== amount || back.DocNumber !== reserved.doc) throw new Error("QuickBooks read-back doesn't match — check placeholder #" + reserved.doc + " in QuickBooks.");
    qbInv = back;
  }
  await store.updateInvoice(row.id, { qb_id: qbInv.Id, number: reserved.doc, qb_error: "" });
  await store.updateClaim(job.id, slot.work_date, { state: "done", qb_id: qbInv.Id, doc_number: reserved.doc, invoice_id: row.id });
  await store.recordAttempt({ job_id: job.id, work_date: slot.work_date, kind: "placeholder", ok: true, qb_error: "", qb_id: qbInv.Id });
  return { result: { kind: "placeholder", number: reserved.doc, customer: resolved.displayName, amount, invoice_id: row.id, qb_id: qbInv.Id, done: `#${reserved.doc} ${label} ${M.money(amount)}` } };
}

async function syncCo({ qb, store, slot, nextNumber, resolved, label, claim }) {
  const job = slot.job;
  const name = changeOrderLabel(job.title);
  const amount = M.round2(Number(slot.amount));
  const desc = dayLineDescription(slot.work_date, slot.labor, slot.material_cost, job.tag);
  const marker = syncNote(name, job.id, slot.work_date, "co");
  let runningId = String((await store.getCoInvoice(job.id)) || job.qb_co_invoice_id || "");
  let opened = false;
  if (!runningId) {
    const gate = await store.reserveCoOpen(job.id);
    if (!gate.ok) {
      runningId = String((await store.getCoInvoice(job.id)) || "");
      if (!runningId) throw new Error("The change order invoice is opening on another day. Press Send to QuickBooks to add this day. Nothing else was created.");
    } else opened = true;
  }
  if (runningId) job.qb_co_invoice_id = runningId;
  try {
  let replaceRunning = false;
  if (runningId) {
    const owned = await store.findByQbId(runningId);
    if (!owned || !owned.qb_sync) throw new Error("This change order points at a QuickBooks invoice this sync did not create. It was left as it is.");
    if (owned.sent_at || owned.paid_at) replaceRunning = true;
    else {
      const cur = (await qb("GET", `invoice/${runningId}`)).Invoice;
      if (!cur) throw new Error("QuickBooks said: the change order invoice was not found");
      if (String(cur.Id) !== runningId) throw new Error("QuickBooks said: the change order invoice was not found");
      if (!lineHasDay(cur.Line, slot.work_date)) {
        const lines = linesForUpdate(cur.Line);
        lines.push(salesLine(amount, desc, resolved.classId));
        await qb("POST", "invoice", { Id: runningId, SyncToken: cur.SyncToken, sparse: true, Line: lines });
      }
      const back = (await qb("GET", `invoice/${runningId}`)).Invoice;
      const total = M.round2(Number(back.TotalAmt));
      await store.updateInvoice(owned.id, { amount: total, covers_through: slot.work_date > String(owned.covers_through || "") ? slot.work_date : owned.covers_through, qb_error: "" });
      await store.updateClaim(job.id, slot.work_date, { state: "done", qb_id: runningId, invoice_id: owned.id });
      await store.recordAttempt({ job_id: job.id, work_date: slot.work_date, kind: "co_line", ok: true, qb_error: "", qb_id: runningId });
      return { result: { kind: "co", number: back.DocNumber, customer: resolved.displayName, amount: total, invoice_id: owned.id, qb_id: runningId, done: `#${back.DocNumber} ${name} ${M.money(total)}` } };
    }
  }
  const reserved = await reserveDoc(qb, store, claim, nextNumber, marker, resolved.customerId);
  const invDate = M.addDays(slot.work_date, 14);
  let qbInv = reserved.existing;
  if (!qbInv) {
    const made = (await qb("POST", "invoice", {
      CustomerRef: { value: String(resolved.customerId) }, DocNumber: reserved.doc, TxnDate: invDate, DueDate: invDate,
      PrivateNote: marker, CustomerMemo: { value: name },
      Line: [salesLine(amount, desc, resolved.classId)],
    })).Invoice;
    qbInv = (await qb("GET", `invoice/${made.Id}`)).Invoice;
    if (!qbInv || qbInv.DocNumber !== reserved.doc || String(qbInv.PrivateNote || "") !== marker) throw new Error("QuickBooks read-back doesn't match — check invoice #" + reserved.doc + " in QuickBooks.");
  }
  const total = M.round2(Number(qbInv.TotalAmt));
  let row = await store.findByQbId(qbInv.Id);
  if (!row) row = await store.insertInvoice({
    job_id: job.id, kind: "real", name, number: qbInv.DocNumber, amount: total, inv_date: invDate,
    work_date: slot.work_date, memo: name, scope: String(job.scope || ""), covers_through: slot.work_date,
    qb_id: qbInv.Id, qb_error: "", qb_sync: true,
  });
  await store.saveCoInvoice(job.id, qbInv.Id, { replace: replaceRunning });
  job.qb_co_invoice_id = qbInv.Id;
  await store.updateClaim(job.id, slot.work_date, { state: "done", qb_id: qbInv.Id, doc_number: qbInv.DocNumber, invoice_id: row.id });
  await store.recordAttempt({ job_id: job.id, work_date: slot.work_date, kind: "co_line", ok: true, qb_error: "", qb_id: qbInv.Id });
  return { result: { kind: "co", number: qbInv.DocNumber, customer: resolved.displayName, amount: total, invoice_id: row.id, qb_id: qbInv.Id, done: `#${qbInv.DocNumber} ${name} ${M.money(total)}` } };
  } finally {
    if (opened) await store.releaseCoOpen(job.id);
  }
}

// One job at a time until the time budget runs out. A later call continues. A claim stops a second run from creating the same invoice.
export async function syncSlots({ qb, store, slots, budgetMs = 6000, now = () => Date.now(), nextNumber, staleMs = 90000 }) {
  const deadline = now() + budgetMs;
  const done = [], errors = [], results = [];
  let pending = false;
  const cache = { customers: null, classes: null };
  store.staleMs = staleMs;
  for (let i = 0; i < slots.length; i++) {
    if (i > 0 && now() >= deadline) { pending = true; break; }
    const out = await syncSlot({ qb, store, slot: slots[i], nextNumber, cache });
    if (out?.error) errors.push(out.error);
    if (out?.result) { done.push(out.result.done); results.push(out.result); }
  }
  return { done, errors, pending, results };
}

// Placeholders owed = a recorded failure, or a run that stopped (stale claim) before QuickBooks answered.
// A green day that was never attempted is not on this list.
export function owedRows({ attempts = [], claims = [], invoices = [], now = Date.now(), staleMs = 90000 }) {
  const day = v => String(v || "").slice(0, 10);
  const latest = new Map();
  for (const a of attempts) {
    if (a.kind && !OWED_KINDS.has(a.kind)) continue;
    if (!day(a.work_date)) continue;
    const k = `${a.job_id}|${day(a.work_date)}`;
    const prev = latest.get(k);
    if (!prev || Number(a.id) >= Number(prev.id)) latest.set(k, a);
  }
  // A reserved number on a sync row is not "seated" until QuickBooks has the invoice. A number he typed himself (qb_sync false) is.
  const seated = (jobId, workDate) => invoices.some(i => {
    if (i.job_id !== jobId || day(i.work_date) !== day(workDate) || i.kind !== "placeholder") return false;
    if (String(i.qb_id || "")) return true;
    return !i.qb_sync && String(i.number || "").trim() && !String(i.qb_error || "").trim();
  });
  const rows = [];
  const seen = new Set();
  for (const [k, a] of latest) {
    seen.add(k);
    if (a.ok || !String(a.qb_error || "").trim()) continue;
    if (seated(a.job_id, a.work_date)) continue;
    const ph = invoices.find(i => i.job_id === a.job_id && day(i.work_date) === day(a.work_date) && i.kind === "placeholder" && !i.qb_id);
    rows.push({ job_id: a.job_id, work_date: day(a.work_date), qb_error: a.qb_error, invoice_id: ph?.id || null });
  }
  for (const c of claims) {
    const k = `${c.job_id}|${day(c.work_date)}`;
    if (seen.has(k) || c.state !== "working" || c.qb_id) continue;
    const updated = new Date(c.updated_at).getTime();
    if (!Number.isFinite(updated) || now - updated < staleMs) continue;
    if (seated(c.job_id, c.work_date)) continue;
    rows.push({
      job_id: c.job_id, work_date: day(c.work_date), invoice_id: c.invoice_id || null,
      qb_error: "QuickBooks sync stopped before it finished. Nothing else was sent. Press Send to QuickBooks to retry.",
    });
  }
  return rows;
}

// A day that already started syncing, but this job never got a success or a saved error.
// A green day that was never started is not included — those are not pushed from here.
export function gapsOnStartedDay(unseated, claims = [], attempts = [], now = Date.now(), staleMs = 90000) {
  const day = v => String(v || "").slice(0, 10);
  const counted = (attempts || []).filter(a => (!a.kind || OWED_KINDS.has(a.kind)) && day(a.work_date));
  const started = new Set();
  for (const x of [...claims, ...counted]) if (day(x.work_date)) started.add(day(x.work_date));
  return unseated.filter(o => {
    const d = day(o.work_date);
    if (!started.has(d)) return false;
    const claim = claims.find(c => c.job_id === o.job_id && day(c.work_date) === d);
    if (claim && (claim.state === "done" || claim.qb_id)) return false;
    if (claim && claim.state === "working" && now - new Date(claim.updated_at).getTime() < staleMs) return false;
    if (counted.some(a => a.job_id === o.job_id && day(a.work_date) === d && !a.ok && String(a.qb_error || "").trim())) return false;
    return true;
  });
}

// A green day with logged work and no placeholder, and no sync attempt yet. Shown, not pushed from here.
export function neverSentRows(unseated, attempts = [], claims = []) {
  const day = v => String(v || "").slice(0, 10);
  const touched = new Set();
  for (const a of attempts) {
    if (a.kind && !OWED_KINDS.has(a.kind)) continue;
    if (day(a.work_date)) touched.add(`${a.job_id}|${day(a.work_date)}`);
  }
  for (const c of claims) if (day(c.work_date)) touched.add(`${c.job_id}|${day(c.work_date)}`);
  return (unseated || []).filter(o => !touched.has(`${o.job_id}|${day(o.work_date)}`)).map(o => ({
    job_id: o.job_id, work_date: day(o.work_date), invoice_id: null, qb_error: "never sent",
  }));
}

export function keepVisible(rows, open) {
  const day = v => String(v || "").slice(0, 10);
  const keys = new Set((open || []).map(o => `${o.job_id}|${day(o.work_date)}`));
  return (rows || []).filter(r => keys.has(`${r.job_id}|${day(r.work_date)}`));
}

export function makeMemoryStore() {
  const state = { parents: new Map(), subs: new Map(), buckets: new Map(), co: new Map(), coOpen: new Map(), claims: new Map(), invoices: [], attempts: [], seq: 1 };
  const key = (jobId, workDate) => `${jobId}|${String(workDate).slice(0, 10)}`;
  const store = {
    staleMs: 90000,
    state,
    async saveParent(customerId, customer) { state.parents.set(customerId, { qb_customer_id: customer.Id, qb_customer_name: customer.DisplayName || "" }); },
    async saveSub(propertyId, customer) { state.subs.set(propertyId, { qb_subcustomer_id: customer.Id, qb_subcustomer_name: customer.DisplayName || customer.FullyQualifiedName || "" }); },
    async saveBucket(jobId, bucketId, classId) { state.buckets.set(jobId, { qb_bucket_customer_id: bucketId, qb_class_id: classId }); },
    async saveCoInvoice(jobId, qbId, opts = {}) {
      if (state.co.get(jobId) && !opts.replace) return;
      state.co.set(jobId, String(qbId));
    },
    async getCoInvoice(jobId) { return state.co.get(jobId) || ""; },
    async reserveCoOpen(jobId) {
      const at = state.coOpen.get(jobId);
      if (at == null || Date.now() - at >= store.staleMs) { state.coOpen.set(jobId, Date.now()); return { ok: true }; }
      return { ok: false };
    },
    async releaseCoOpen(jobId) { state.coOpen.delete(jobId); },
    async findPlaceholder(jobId, workDate) {
      return state.invoices.find(i => i.job_id === jobId && i.kind === "placeholder" && String(i.work_date).slice(0, 10) === String(workDate).slice(0, 10)) || null;
    },
    async findByQbId(qbId) { return state.invoices.find(i => String(i.qb_id) === String(qbId)) || null; },
    async insertInvoice(row) { const inv = { ...row, id: state.seq++ }; state.invoices.push(inv); return inv; },
    async updateInvoice(id, patch) {
      const inv = state.invoices.find(i => i.id === id);
      if (inv) Object.assign(inv, patch);
      return inv;
    },
    async recordAttempt(row) { state.attempts.push({ ...row, id: state.seq++ }); },
    async updateClaim(jobId, workDate, patch) {
      const row = state.claims.get(key(jobId, workDate));
      if (row) Object.assign(row, patch, { updated_at: new Date().toISOString() });
      return row;
    },
    async tryClaim(jobId, workDate, { allowRetry = false } = {}) {
      const k = key(jobId, workDate);
      let row = state.claims.get(k);
      if (!row) {
        row = { job_id: jobId, work_date: workDate, state: "working", doc_number: "", invoice_id: null, qb_id: "", updated_at: new Date().toISOString() };
        state.claims.set(k, row);
        return { ok: true, row };
      }
      if (row.state === "done") return { ok: false, skip: "done", row };
      if (row.state === "failed" && !allowRetry) return { ok: false, skip: "failed", row };
      if (row.state === "failed" && allowRetry) { row.state = "working"; row.updated_at = new Date().toISOString(); return { ok: true, row }; }
      const age = Date.now() - new Date(row.updated_at).getTime();
      if (row.state === "working" && age >= store.staleMs) { row.updated_at = new Date().toISOString(); return { ok: true, resumed: true, row }; }
      return { ok: false, skip: "busy", row };
    },
  };
  return store;
}

export function makeSqlStore(sql, norm = x => x) {
  const one = rows => { const n = norm(rows); return Array.isArray(n) ? n[0] : n; };
  const many = rows => { const n = norm(rows); return Array.isArray(n) ? n : []; };
  return {
    async saveParent(customerId, customer) {
      await sql`UPDATE customers SET qb_customer_id = ${String(customer.Id)}, qb_customer_name = ${customer.DisplayName || ""} WHERE id = ${customerId}`;
    },
    async saveSub(propertyId, customer) {
      await sql`UPDATE properties SET qb_subcustomer_id = ${String(customer.Id)}, qb_subcustomer_name = ${customer.DisplayName || customer.FullyQualifiedName || ""} WHERE id = ${propertyId}`;
    },
    async saveBucket(jobId, bucketId, classId) {
      await sql`UPDATE jobs SET qb_bucket_customer_id = ${bucketId || ""}, qb_class_id = ${classId || ""} WHERE id = ${jobId}`;
    },
    async saveCoInvoice(jobId, qbId, opts = {}) {
      if (opts.replace) await sql`UPDATE jobs SET qb_co_invoice_id = ${String(qbId)} WHERE id = ${jobId}`;
      else await sql`UPDATE jobs SET qb_co_invoice_id = ${String(qbId)} WHERE id = ${jobId} AND qb_co_invoice_id = ''`;
    },
    async getCoInvoice(jobId) {
      const row = one(await sql`SELECT qb_co_invoice_id FROM jobs WHERE id = ${jobId}`);
      return String(row?.qb_co_invoice_id || "");
    },
    async reserveCoOpen(jobId) {
      const inserted = many(await sql`INSERT INTO qb_co_open (job_id) VALUES (${jobId}) ON CONFLICT (job_id) DO NOTHING RETURNING job_id`);
      if (inserted.length) return { ok: true };
      const cur = one(await sql`SELECT updated_at FROM qb_co_open WHERE job_id = ${jobId}`);
      const age = cur ? Date.now() - new Date(cur.updated_at).getTime() : 0;
      if (cur && age >= 90000) {
        const stole = many(await sql`UPDATE qb_co_open SET updated_at = NOW() WHERE job_id = ${jobId} AND updated_at <= ${new Date(Date.now() - 90000).toISOString()} RETURNING job_id`);
        if (stole.length) return { ok: true };
      }
      return { ok: false };
    },
    async releaseCoOpen(jobId) { await sql`DELETE FROM qb_co_open WHERE job_id = ${jobId}`; },
    async findPlaceholder(jobId, workDate) {
      return one(await sql`SELECT * FROM invoices WHERE job_id = ${jobId} AND kind = 'placeholder' AND work_date = ${workDate} ORDER BY id LIMIT 1`);
    },
    async findByQbId(qbId) {
      return one(await sql`SELECT * FROM invoices WHERE qb_id = ${String(qbId)} ORDER BY id LIMIT 1`);
    },
    async insertInvoice(row) {
      return one(await sql`INSERT INTO invoices (job_id, kind, name, number, amount, inv_date, work_date, memo, scope, covers_through, qb_id, qb_error, qb_sync)
        VALUES (${row.job_id}, ${row.kind}, ${row.name || ""}, ${row.number || ""}, ${row.amount || 0}, ${row.inv_date || null}, ${row.work_date || null}, ${row.memo || ""}, ${row.scope || ""}, ${row.covers_through || null}, ${row.qb_id || ""}, ${row.qb_error || ""}, ${!!row.qb_sync}) RETURNING *`);
    },
    async updateInvoice(id, patch) {
      const cur = one(await sql`SELECT * FROM invoices WHERE id = ${id}`);
      if (!cur) return null;
      return one(await sql`UPDATE invoices SET
        qb_id = ${patch.qb_id != null ? String(patch.qb_id) : cur.qb_id},
        number = ${patch.number != null ? String(patch.number) : cur.number},
        amount = ${patch.amount != null ? patch.amount : cur.amount},
        qb_error = ${patch.qb_error != null ? String(patch.qb_error) : cur.qb_error},
        covers_through = ${patch.covers_through != null ? patch.covers_through : cur.covers_through}
        WHERE id = ${id} RETURNING *`);
    },
    async recordAttempt(row) {
      await sql`INSERT INTO qb_sync_attempts (job_id, work_date, kind, ok, qb_error, qb_id)
        VALUES (${row.job_id}, ${row.work_date || null}, ${row.kind}, ${!!row.ok}, ${row.qb_error || ""}, ${row.qb_id || ""})`;
    },
    async updateClaim(jobId, workDate, patch) {
      const cur = one(await sql`SELECT * FROM qb_sync_claims WHERE job_id = ${jobId} AND work_date = ${workDate}`);
      if (!cur) return null;
      return one(await sql`UPDATE qb_sync_claims SET
        state = ${patch.state || cur.state},
        doc_number = ${patch.doc_number != null ? String(patch.doc_number) : cur.doc_number},
        invoice_id = ${patch.invoice_id != null ? patch.invoice_id : cur.invoice_id},
        qb_id = ${patch.qb_id != null ? String(patch.qb_id) : cur.qb_id},
        updated_at = NOW()
        WHERE job_id = ${jobId} AND work_date = ${workDate} RETURNING *`);
    },
    async tryClaim(jobId, workDate, { allowRetry = false, staleMs = 90000 } = {}) {
      const inserted = many(await sql`INSERT INTO qb_sync_claims (job_id, work_date, state) VALUES (${jobId}, ${workDate}, 'working') ON CONFLICT (job_id, work_date) DO NOTHING RETURNING *`);
      if (inserted.length) return { ok: true, row: inserted[0] };
      const cur = one(await sql`SELECT * FROM qb_sync_claims WHERE job_id = ${jobId} AND work_date = ${workDate}`);
      if (!cur) return { ok: false, row: null };
      if (cur.state === "done") return { ok: false, skip: "done", row: cur };
      if (cur.state === "failed" && !allowRetry) return { ok: false, skip: "failed", row: cur };
      if (cur.state === "failed" && allowRetry) {
        const u = one(await sql`UPDATE qb_sync_claims SET state = 'working', updated_at = NOW() WHERE job_id = ${jobId} AND work_date = ${workDate} AND state = 'failed' RETURNING *`);
        return u ? { ok: true, row: u } : { ok: false, skip: "failed", row: cur };
      }
      const age = Date.now() - new Date(cur.updated_at).getTime();
      if (cur.state === "working" && age >= staleMs) {
        const cutoff = new Date(Date.now() - staleMs).toISOString();
        const u = one(await sql`UPDATE qb_sync_claims SET updated_at = NOW() WHERE job_id = ${jobId} AND work_date = ${workDate} AND state = 'working' AND updated_at <= ${cutoff} RETURNING *`);
        return u ? { ok: true, resumed: true, row: u } : { ok: false, skip: "busy", row: cur };
      }
      return { ok: false, skip: "busy", row: cur };
    },
  };
}
