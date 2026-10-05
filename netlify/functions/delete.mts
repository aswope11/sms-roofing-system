// DELETE, everywhere, one place.
// GET    /d/:type/:id  -> what it is, everything attached that goes with it, and anything that blocks it. Changes nothing.
// DELETE /d/:type/:id  -> checks the same things again, then deletes it all in one transaction.
// Rules: he confirms first and sees what's attached; nothing cascades without being listed;
// a ticket with money on it (or anything in QuickBooks) can't be deleted, only tabled; this never touches QuickBooks.
import { getDatabase } from "@netlify/database";
import { getStore } from "@netlify/blobs";
import type { Config } from "@netlify/functions";
import * as M from "../../lib/money.js";

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
const { countOf } = M;

type Plan = { what: string; label: string; back: string; attached: string[]; blocked: string[]; table_job?: number; run: () => Promise<string[]> };

export default async (req: Request) => {
  const db = getDatabase();
  const url = new URL(req.url);
  const [type, idRaw] = url.pathname.replace(/^\/d\/?/, "").split("/").filter(Boolean);
  const client = await db.pool.connect();
  const q = async (text: string, vals: any[] = []) => (await client.query(text, vals)).rows;
  const n = async (text: string, vals: any[] = []) => Number((await q(text, vals))[0].n);

  // Everything hanging off a set of job files / tickets. Used by job, property and customer.
  const jobsPart = async (ids: number[]) => {
    const attached: string[] = [], blocked: string[] = [];
    if (!ids.length) return { attached, blocked, run: async () => [] as string[] };
    const jobs = await q(`SELECT j.*, p.address, p.city FROM jobs j JOIN properties p ON p.id = j.property_id WHERE j.id = ANY($1::int[])`, [ids]);
    const invs = await q(`SELECT * FROM invoices WHERE job_id = ANY($1::int[])`, [ids]);
    const paid = await q(`SELECT job_id, COUNT(*)::int AS n FROM sub_paid WHERE paid AND job_id = ANY($1::int[]) GROUP BY job_id`, [ids]);
    for (const j of jobs) {
      const why = M.whyTicketLocked(invs.filter((i: any) => i.job_id === j.id), (paid.find((p: any) => p.job_id === j.id) || {}).n || 0);
      if (why.length) blocked.push(`${M.ticketName(j)} — ${why.join(", ")}`);
    }
    const stops = await n(`SELECT COUNT(*)::int AS n FROM stops WHERE job_id = ANY($1::int[])`, [ids]);
    const files = await q(`SELECT blob_key, chunks FROM files WHERE job_id = ANY($1::int[])`, [ids]);
    const scopes = await n(`SELECT COUNT(*)::int AS n FROM job_scopes WHERE job_id = ANY($1::int[])`, [ids]);
    const cats = await n(`SELECT COUNT(*)::int AS n FROM cost_categories WHERE job_id = ANY($1::int[])`, [ids]);
    const lines = await n(`SELECT COUNT(*)::int AS n FROM supply_lines WHERE job_id = ANY($1::int[])`, [ids]);
    const subLines = await n(`SELECT COUNT(*)::int AS n FROM sub_paid WHERE job_id = ANY($1::int[])`, [ids]);
    if (stops) attached.push(`${countOf(stops, "man-day")} on the schedule and payroll — they come off, and that pay leaves payroll`);
    if (invs.length) attached.push(`${countOf(invs.length, "invoice line")} in the app (none in QuickBooks)`);
    if (files.length) attached.push(`${countOf(files.length, "file")} in the file cabinet`);
    if (scopes) attached.push(countOf(scopes, "scope of work"));
    if (cats) attached.push(countOf(cats, "material category", "material categories"));
    if (lines) attached.push(`${countOf(lines, "supply invoice line")} applied to it — the supply invoices stay, those lines go back to no job`);
    if (subLines) attached.push(countOf(subLines, "unpaid sub pay line"));
    const run = async () => {
      const touched = await q(`SELECT DISTINCT work_date, crew_id FROM stops WHERE job_id = ANY($1::int[])`, [ids]);
      await q(`DELETE FROM stops WHERE job_id = ANY($1::int[])`, [ids]);
      for (const t of touched) await q(`DELETE FROM crew_days d WHERE d.work_date = $1 AND d.crew_id = $2 AND NOT EXISTS (SELECT 1 FROM stops s WHERE s.work_date = $1 AND s.crew_id = $2)`, [t.work_date, t.crew_id]);
      await q(`DELETE FROM invoices WHERE job_id = ANY($1::int[])`, [ids]);
      await q(`DELETE FROM sub_paid WHERE job_id = ANY($1::int[])`, [ids]);
      await q(`DELETE FROM job_scopes WHERE job_id = ANY($1::int[])`, [ids]);
      await q(`DELETE FROM cost_categories WHERE job_id = ANY($1::int[])`, [ids]);
      await q(`DELETE FROM material_category WHERE job_id = ANY($1::int[])`, [ids]);
      await q(`UPDATE supply_lines SET job_id = NULL WHERE job_id = ANY($1::int[])`, [ids]);
      await q(`DELETE FROM files WHERE job_id = ANY($1::int[])`, [ids]);
      await q(`DELETE FROM jobs WHERE id = ANY($1::int[])`, [ids]);
      return files.map((f: any) => blobKeys(f)).flat();
    };
    return { attached, blocked, run };
  };
  const blobKeys = (f: any) => Array.from({ length: Number(f.chunks) }, (_, i) => `${f.blob_key}/${i}`);

  const plan = async (): Promise<Plan | null> => {
    // ---------- CUSTOMER ----------
    if (type === "customer") {
      const [c] = await q(`SELECT * FROM customers WHERE id = $1`, [Number(idRaw)]); if (!c) return null;
      const props = await q(`SELECT id FROM properties WHERE customer_id = $1`, [c.id]);
      const jobIds = (await q(`SELECT j.id FROM jobs j JOIN properties p ON p.id = j.property_id WHERE p.customer_id = $1`, [c.id])).map((r: any) => r.id);
      const part = await jobsPart(jobIds);
      return { what: "customer", label: c.name, back: "#/",
        attached: [...(props.length ? [countOf(props.length, "property", "properties")] : []), ...(jobIds.length ? [countOf(jobIds.length, "job file")] : []), ...part.attached],
        blocked: part.blocked,
        run: async () => { const keys = await part.run(); await q(`DELETE FROM properties WHERE customer_id = $1`, [c.id]); await q(`DELETE FROM customers WHERE id = $1`, [c.id]); return keys; } };
    }
    // ---------- PROPERTY ----------
    if (type === "property") {
      const [p] = await q(`SELECT * FROM properties WHERE id = $1`, [Number(idRaw)]); if (!p) return null;
      const jobIds = (await q(`SELECT id FROM jobs WHERE property_id = $1`, [p.id])).map((r: any) => r.id);
      const part = await jobsPart(jobIds);
      return { what: "property", label: [p.address, p.city].filter(Boolean).join(", "), back: `#/customer/${p.customer_id}`,
        attached: [...(jobIds.length ? [countOf(jobIds.length, "job file")] : []), ...(p.contract_amount != null ? [`a contract of ${M.money(p.contract_amount)}`] : []), ...part.attached],
        blocked: part.blocked,
        run: async () => { const keys = await part.run(); await q(`DELETE FROM properties WHERE id = $1`, [p.id]); return keys; } };
    }
    // ---------- JOB FILE / TICKET (same record) ----------
    if (type === "job") {
      const [j] = await q(`SELECT j.*, p.address, p.city FROM jobs j JOIN properties p ON p.id = j.property_id WHERE j.id = $1`, [Number(idRaw)]); if (!j) return null;
      const part = await jobsPart([j.id]);
      return { what: "job file", label: M.ticketName(j), back: `#/property/${j.property_id}`, attached: [...part.blocked.map(b => b.replace(/^.* — /, "") + " — stays in QuickBooks; this only takes it out of the app"), ...part.attached],
        blocked: [], run: part.run };   // 10/5/26: he can delete any ticket — money on it is listed, not a block
    }
    // ---------- CREW ----------
    if (type === "crew") {
      const [c] = await q(`SELECT * FROM crew WHERE id = $1`, [Number(idRaw)]); if (!c) return null;
      const stops = await n(`SELECT COUNT(*)::int AS n FROM stops WHERE crew_id = $1`, [c.id]);
      const days = await n(`SELECT COUNT(*)::int AS n FROM crew_days WHERE crew_id = $1`, [c.id]);
      const men = await q(`SELECT name FROM crew WHERE boss_id = $1`, [c.id]);
      const subs = await q(`SELECT name FROM subs WHERE crew_id = $1`, [c.id]);
      const attached: string[] = [];
      if (stops || days) attached.push(`${countOf(Math.max(stops, days), "day")} he worked on the schedule and payroll — they come off, and that pay leaves every job cost`);
      if (men.length) attached.push(`${countOf(men.length, "man", "men")} working under him (${men.map((x: any) => x.name).join(", ")}) — they stay, with nobody over them`);
      if (subs.length) attached.push(`the sub page ${subs.map((x: any) => x.name).join(", ")} — it stays, no longer tied to a crew`);
      return { what: "crew member", label: c.name, back: "#/crew", attached, blocked: [],
        run: async () => {
          await q(`DELETE FROM stops WHERE crew_id = $1`, [c.id]); await q(`DELETE FROM crew_days WHERE crew_id = $1`, [c.id]);
          await q(`UPDATE crew SET boss_id = NULL WHERE boss_id = $1`, [c.id]); await q(`UPDATE subs SET crew_id = NULL WHERE crew_id = $1`, [c.id]);
          await q(`DELETE FROM crew WHERE id = $1`, [c.id]); return [];
        } };
    }
    // ---------- SCOPE OF WORK ----------
    if (type === "scope") {
      const [s] = await q(`SELECT * FROM job_scopes WHERE id = $1`, [Number(idRaw)]); if (!s) return null;
      const used = await q(`SELECT id, day_scope, scope_split FROM stops WHERE job_id = $1 AND (scope_split ? $2 OR $2 = ANY(string_to_array(day_scope, ' · ')))`, [s.job_id, s.name]);
      const attached: string[] = [];
      if (s.budget != null) attached.push(`a budget of ${M.money(s.budget)}`);
      if (used.length) attached.push(`used on ${countOf(used.length, "man-day")} — the scope comes off those days; the days and their pay stay`);
      return { what: "scope", label: s.name, back: `#/jobcost/${s.job_id}`, attached, blocked: [],
        run: async () => {
          for (const u of used) {
            const split = u.scope_split && typeof u.scope_split === "object" ? { ...u.scope_split } : null;
            if (split) delete split[s.name];
            const names = String(u.day_scope || "").split(" · ").filter((x: string) => x && x !== s.name);
            await q(`UPDATE stops SET day_scope = $1, scope_split = $2 WHERE id = $3`, [names.join(" · "), split && Object.keys(split).length ? JSON.stringify(split) : null, u.id]);
          }
          await q(`DELETE FROM job_scopes WHERE id = $1`, [s.id]); return [];
        } };
    }
    // ---------- CUSTOMER INVOICE / DRAW / PLACEHOLDER ----------
    if (type === "invoice") {
      const [i] = await q(`SELECT i.*, j.tag, j.title, p.address, p.city FROM invoices i JOIN jobs j ON j.id = i.job_id JOIN properties p ON p.id = j.property_id WHERE i.id = $1`, [Number(idRaw)]); if (!i) return null;
      const kindWord = i.kind === "draw" ? "draw" : i.kind === "placeholder" ? "placeholder" : "invoice";
      const blocked: string[] = [];
      if (M.inQuickBooks(i)) blocked.push(`it's already in QuickBooks (${[i.number ? "number " + i.number : "", i.sent_at ? "marked sent" : "", i.paid_at ? "marked paid" : ""].filter(Boolean).join(", ")}) — void it in QuickBooks yourself, then fix it here`);
      const attached: string[] = [];
      if (Number(i.amount) > 0) attached.push(`${M.money(i.amount)} on it`);
      if (i.covers_through) attached.push(`it covers work through ${i.covers_through.toISOString ? i.covers_through.toISOString().slice(0, 10) : i.covers_through} — those days show up as not billed again`);
      return { what: kindWord, label: `${i.name || kindWord} on ${M.ticketName(i)}`, back: `#/jobcost/${i.job_id}/invoices`, attached, blocked,
        run: async () => { await q(`DELETE FROM invoices WHERE id = $1`, [i.id]); return []; } };
    }
    // ---------- SUPPLY INVOICE ----------
    if (type === "supply") {
      const [s] = await q(`SELECT * FROM supply_invoices WHERE id = $1`, [Number(idRaw)]); if (!s) return null;
      const payLines = await n(`SELECT COUNT(*)::int AS n FROM payment_lines pl JOIN payments p ON p.id = pl.payment_id WHERE pl.invoice_id = $1 AND p.voided_at IS NULL`, [s.id]);
      const voidLines = await n(`SELECT COUNT(*)::int AS n FROM payment_lines WHERE invoice_id = $1`, [s.id]);
      const lines = await q(`SELECT DISTINCT job_id FROM supply_lines WHERE invoice_id = $1`, [s.id]);
      const lineCount = await n(`SELECT COUNT(*)::int AS n FROM supply_lines WHERE invoice_id = $1`, [s.id]);
      const files = await q(`SELECT blob_key, chunks FROM files WHERE supply_invoice_id = $1`, [s.id]);
      const blocked = payLines ? [`a payment is recorded on it (${countOf(payLines, "payment line")}) — void the payment first`] : [];
      const jobs = lines.filter((l: any) => l.job_id).length;
      const attached: string[] = [];
      if (lineCount) attached.push(`${countOf(lineCount, "line")}${jobs ? `, applied to ${countOf(jobs, "job")} — that material comes off those job costs` : ""}`);
      if (files.length) attached.push(`${countOf(files.length, "file")} of paper on it`);
      if (voidLines) attached.push(`${countOf(voidLines, "voided payment line")}`);
      return { what: "supply invoice", label: `${s.house} ${s.number}`, back: "#/supply", attached, blocked,
        run: async () => {
          await q(`DELETE FROM supply_lines WHERE invoice_id = $1`, [s.id]); await q(`DELETE FROM material_category WHERE invoice_id = $1`, [s.id]);
          await q(`DELETE FROM payment_lines WHERE invoice_id = $1`, [s.id]); await q(`DELETE FROM files WHERE supply_invoice_id = $1`, [s.id]);
          await q(`DELETE FROM supply_invoices WHERE id = $1`, [s.id]); return files.map(blobKeys).flat();
        } };
    }
    // ---------- A FILE IN A CABINET ----------
    if (type === "file") {
      const [f] = await q(`SELECT * FROM files WHERE id = $1`, [Number(idRaw)]); if (!f) return null;
      const back = f.job_id ? `#/job/${f.job_id}` : f.supply_invoice_id ? `#/supply/${f.supply_invoice_id}` : f.sub_id ? `#/subs/${f.sub_id}` : "#/";
      return { what: "file", label: `${f.name}${f.drawer ? ` (${f.drawer})` : ""}`, back, attached: [], blocked: [],
        run: async () => { await q(`DELETE FROM files WHERE id = $1`, [f.id]); return blobKeys(f); } };
    }
    // ---------- A SCHEDULE ENTRY: one man on one job on one day ----------
    if (type === "stop") {
      const [s] = await q(`SELECT s.*, c.name, c.pay_to, j.tag, j.title, p.address, p.city FROM stops s JOIN crew c ON c.id = s.crew_id JOIN jobs j ON j.id = s.job_id JOIN properties p ON p.id = j.property_id WHERE s.id = $1`, [Number(idRaw)]); if (!s) return null;
      const d = s.work_date.toISOString().slice(0, 10);
      const others = await n(`SELECT COUNT(*)::int AS n FROM stops WHERE work_date = $1 AND crew_id = $2 AND id <> $3`, [d, s.crew_id, s.id]);
      const paid = await n(`SELECT COUNT(*)::int AS n FROM sub_paid WHERE paid AND work_date = $1 AND job_id = $2 AND pay_to = $3`, [d, s.job_id, s.pay_to || ""]);
      const green = await n(`SELECT COUNT(*)::int AS n FROM green_days WHERE green AND work_date = $1`, [d]);
      const attached = [others ? `his day splits over his other ${countOf(others, "job")} instead` : `it's his only job that day — his whole day (and that pay) comes off payroll`];
      if (s.day_scope) attached.push(`what he did: ${s.day_scope}`);
      if (green) attached.push(`${M.shortDate(d)} is marked green`);
      return { what: "schedule entry", label: `${s.name} on ${M.ticketName(s)}, ${M.shortDate(d)}`, back: "#/schedule", attached,
        blocked: paid ? [`the pay for this job that day is marked paid to ${s.pay_to} — un-tap paid first`] : [],
        run: async () => {
          await q(`DELETE FROM stops WHERE id = $1`, [s.id]);
          if (!others) await q(`DELETE FROM crew_days WHERE work_date = $1 AND crew_id = $2`, [d, s.crew_id]);
          return [];
        } };
    }
    // ---------- A PAYROLL DAY: one man's whole day. id = crewId_YYYY-MM-DD ----------
    if (type === "payday") {
      const [crewId, d] = String(idRaw || "").split("_");
      const [c] = await q(`SELECT * FROM crew WHERE id = $1`, [Number(crewId)]); if (!c || !/^\d{4}-\d{2}-\d{2}$/.test(d || "")) return null;
      const stops = await q(`SELECT s.id, j.tag, j.title, p.address, p.city, s.job_id FROM stops s JOIN jobs j ON j.id = s.job_id JOIN properties p ON p.id = j.property_id WHERE s.work_date = $1 AND s.crew_id = $2`, [d, c.id]);
      const [cd] = await q(`SELECT * FROM crew_days WHERE work_date = $1 AND crew_id = $2`, [d, c.id]);
      if (!stops.length && !cd) return null;
      const paid = stops.length ? await n(`SELECT COUNT(*)::int AS n FROM sub_paid WHERE paid AND work_date = $1 AND pay_to = $2 AND job_id = ANY($3::int[])`, [d, c.pay_to || "", stops.map((s: any) => s.job_id)]) : 0;
      const green = await n(`SELECT COUNT(*)::int AS n FROM green_days WHERE green AND work_date = $1`, [d]);
      const attached = stops.length ? [`${countOf(stops.length, "job")} on the schedule that day: ${stops.map((s: any) => M.ticketName(s)).join("; ")} — they come off those job costs`] : [];
      if (green) attached.push(`${M.shortDate(d)} is marked green`);
      return { what: "payroll day", label: `${c.name}, ${M.shortDate(d)}`, back: "#/crew", attached,
        blocked: paid ? [`pay that day is marked paid to ${c.pay_to} — un-tap paid first`] : [],
        run: async () => { await q(`DELETE FROM stops WHERE work_date = $1 AND crew_id = $2`, [d, c.id]); await q(`DELETE FROM crew_days WHERE work_date = $1 AND crew_id = $2`, [d, c.id]); return []; } };
    }
    return null;
  };

  try {
    const known = ["customer", "property", "job", "crew", "scope", "invoice", "supply", "file", "stop", "payday"];
    if (!known.includes(type)) return json({ error: "Unknown thing to delete." }, 404);
    if (req.method === "GET") {
      const p = await plan();
      if (!p) return json({ error: "It's already gone." }, 404);
      const { run, ...show } = p;
      return json(show);
    }
    if (req.method === "DELETE") {
      await client.query("BEGIN");
      const p = await plan();
      if (!p) { await client.query("ROLLBACK"); return json({ error: "It's already gone." }, 404); }
      if (p.blocked.length) { await client.query("ROLLBACK"); return json({ error: `Can't delete ${p.label}: ${p.blocked.join("; ")}`, blocked: p.blocked, table_job: p.table_job }, 409); }
      let keys: string[] = [];
      try { keys = await p.run(); await client.query("COMMIT"); }
      catch (e) { await client.query("ROLLBACK"); throw e; }
      // The pieces of any deleted file come out of storage after the records are gone.
      if (keys.length) { const store = getStore({ name: "job-files", consistency: "strong" }); for (const k of keys) await store.delete(k); }
      return json({ deleted: p.label, back: p.back });
    }
    return json({ error: "Unknown request" }, 404);
  } catch (e: any) {
    return json({ error: String(e?.message || e) }, 500);
  } finally { client.release(); }
};

export const config: Config = { path: "/d/*" };
