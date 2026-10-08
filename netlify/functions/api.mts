import { getDatabase } from "@netlify/database";
import { getStore } from "@netlify/blobs";
import { randomUUID } from "node:crypto";
import type { Config, Context } from "@netlify/functions";
import { addressKey, chunkCount, missingOnCustomer, missingOnProperty, missingOnJob, missingOnFile, TAGS, CHUNK_BYTES } from "../../lib/rules.js";

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
// NOTHING IN THIS APP EVER REFUSES TO SAVE (locked 9/20/26). What is still missing rides back on
// the saved record as `missing`, so the screen can write it down. It is never a 400.
const note = (row: any, missing: string[]) => json(missing.length ? { ...row, missing } : row);

export default async (req: Request, context: Context) => {
  const db = getDatabase();
  const sql = db.sql;
  const url = new URL(req.url);
  const parts = url.pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean);
  const [kind, idRaw, sub, subId] = parts;
  const id = idRaw ? Number(idRaw) : null;
  const m = req.method;

  try {
    // ---------- CUSTOMERS ----------
    if (kind === "customers") {
      if (m === "GET" && !id) return json(await sql`
        SELECT c.*, (SELECT COUNT(*)::int FROM properties p WHERE p.customer_id = c.id) AS property_count
        FROM customers c ORDER BY LOWER(c.name)`);
      if (m === "GET" && id) {
        const [c] = await sql`SELECT * FROM customers WHERE id = ${id}`;
        if (!c) return json({ error: "Not found" }, 404);
        c.properties = await sql`
          SELECT p.*, (SELECT COUNT(*)::int FROM jobs j WHERE j.property_id = p.id) AS job_count,
            (SELECT COUNT(*)::int FROM jobs j WHERE j.property_id = p.id AND j.tag IS DISTINCT FROM 'BID') AS work_count
          FROM properties p WHERE p.customer_id = ${id} ORDER BY LOWER(p.address)`;
        c.files = await sql`SELECT id, name, content_type, size_bytes, created_at FROM files
          WHERE customer_id = ${id} AND complete ORDER BY created_at`;
        return json(c);
      }
      const b = await req.json();
      const miss = missingOnCustomer(b);          // a note that rides back, never a refusal
      const cname = String(b.name || "").trim();
      if (m === "POST") {
        const [c] = await sql`INSERT INTO customers (name, phone, email, notes)
          VALUES (${cname}, ${b.phone || ""}, ${b.email || ""}, ${b.notes || ""}) RETURNING *`;
        return note(c, miss);
      }
      if (m === "PUT" && id) {
        // BILLING CARD (10/8/26): Bill To name + mailing address + "never View and pay" — sent → saved; left out → kept.
        const [c] = await sql`UPDATE customers SET name=${cname}, phone=${b.phone || ""},
          email=${b.email || ""}, notes=${b.notes || ""},
          bill_name=CASE WHEN ${"bill_name" in b}::boolean THEN ${String(b.bill_name || "").trim()} ELSE bill_name END,
          bill_addr=CASE WHEN ${"bill_addr" in b}::boolean THEN ${String(b.bill_addr || "").trim()} ELSE bill_addr END,
          no_pay=CASE WHEN ${"no_pay" in b}::boolean THEN ${!!b.no_pay && b.no_pay !== "0"} ELSE no_pay END
          WHERE id=${id} RETURNING *`;
        return note(c, miss);
      }
    }

    // ---------- PROPERTIES ----------
    if (kind === "properties") {
      if (m === "GET" && id) {
        const [p] = await sql`SELECT p.*, c.name AS customer_name FROM properties p
          JOIN customers c ON c.id = p.customer_id WHERE p.id = ${id}`;
        if (!p) return json({ error: "Not found" }, 404);
        p.jobs = await sql`SELECT j.*, (SELECT COUNT(*)::int FROM files f WHERE f.job_id=j.id AND f.complete) AS file_count,
          (SELECT pj.title FROM jobs pj WHERE pj.id=j.parent_job_id) AS parent_title
          FROM jobs j WHERE j.property_id = ${id} ORDER BY j.created_at DESC`;
        // CUSTOMER PAGE FILING (10/8/26, his drawing): each ticket shows its real invoice + placeholder under it.
        const jobIds = p.jobs.map((j: any) => j.id);
        p.invoices = jobIds.length ? await sql`SELECT id, job_id, kind, number, work_date, covers_through
          FROM invoices WHERE job_id = ANY(${jobIds}::int[]) AND kind IN ('real','placeholder','draw') ORDER BY id` : [];
        return json(p);
      }
      if (m === "GET" && !id) {
        const q = url.searchParams.get("address");
        if (q) return json(await sql`SELECT p.*, c.name AS customer_name FROM properties p
          JOIN customers c ON c.id=p.customer_id WHERE p.address_key = ${addressKey(q)}`);
        return json(await sql`SELECT p.*, c.name AS customer_name FROM properties p
          JOIN customers c ON c.id=p.customer_id ORDER BY LOWER(p.address)`);
      }
      const b = await req.json();
      const miss = missingOnProperty(b);          // a note that rides back, never a refusal
      const addr = String(b.address || "").trim();
      const key = addressKey(addr);
      if (m === "POST") {
        // THE ONE THING STILL TURNED AWAY HERE IS A SECOND COPY OF THE SAME ROOF — not a blank
        // field. The address is already on file, so the app hands back the one that exists.
        const [dupe] = key ? await sql`SELECT p.id, c.name AS customer_name FROM properties p JOIN customers c ON c.id=p.customer_id
          WHERE p.address_key=${key} AND p.city=${(b.city || "").trim()}` : [];
        if (dupe) return json({ error: `This address is already on file under ${dupe.customer_name}.`, existing_id: dupe.id }, 409);
        const [p] = await sql`INSERT INTO properties (customer_id, address, address_key, city, tenant, gc, notes)
          VALUES (${b.customer_id || null}, ${addr}, ${key}, ${(b.city || "").trim()}, ${b.tenant || ""}, ${b.gc || ""}, ${b.notes || ""})
          RETURNING *`;
        return note(p, miss);
      }
      if (m === "PUT" && id) {
        const [p] = await sql`UPDATE properties SET customer_id=${b.customer_id || null}, address=${addr}, address_key=${key},
          city=${(b.city || "").trim()}, tenant=${b.tenant || ""}, gc=${b.gc || ""}, notes=${b.notes || ""},
          bill_name=COALESCE(${b.bill_name ?? null}, bill_name), bill_addr=COALESCE(${b.bill_addr ?? null}, bill_addr), ship_addr=COALESCE(${b.ship_addr ?? null}, ship_addr)
          WHERE id=${id} RETURNING *`;
        return note(p, miss);
      }
    }

    // ---------- JOBS ----------
    if (kind === "jobs") {
      if (m === "GET" && id) {
        const [j] = await sql`SELECT j.*, p.address, p.city, COALESCE(NULLIF(j.tenant_name, ''), p.tenant) AS tenant, p.gc, p.customer_id, c.name AS customer_name,
          (SELECT pj.title FROM jobs pj WHERE pj.id=j.parent_job_id) AS parent_title
          FROM jobs j JOIN properties p ON p.id=j.property_id JOIN customers c ON c.id=p.customer_id WHERE j.id=${id}`;
        if (!j) return json({ error: "Not found" }, 404);
        j.files = await sql`SELECT id, job_id, drawer, name, content_type, size_bytes, chunks, created_at
          FROM files WHERE job_id=${id} AND complete ORDER BY drawer, created_at`;
        return json(j);
      }
      const b = await req.json();
      const miss = missingOnJob(b);               // a note that rides back, never a refusal
      const tag = TAGS.includes(b.tag) ? b.tag : "";       // no tag yet is a blank, not a stop sign
      const title = String(b.title || "").trim();
      // a job file can sit INSIDE another job file on the same property (Building › tenant › ticket, 10/1/26). Blank = right on the property.
      const hasPid = "parent_job_id" in b;
      const pid = b.parent_job_id && Number(b.parent_job_id) !== id ? Number(b.parent_job_id) : null;
      if (m === "POST") {
        const [j] = await sql`INSERT INTO jobs (property_id, tag, title, notes, parent_job_id)
          VALUES (${b.property_id || null}, ${tag}, ${title}, ${b.notes || ""}, ${pid}) RETURNING *`;
        return note(j, miss);
      }
      if (m === "PUT" && id) {
        // TENANT ON THE TICKET (10/4/26): one property can hold several tenants (6101 Windhaven: whole-property inspection, Carries Pilates, Bellezza).
        // A ticket's own tenant wins over the property's; sending tenant_name sets it, leaving it out keeps it.
        const [j] = await sql`UPDATE jobs SET tag=${tag}, title=${title}, notes=${b.notes || ""},
          tenant_name=CASE WHEN ${"tenant_name" in b}::boolean THEN ${String(b.tenant_name || "").trim()} ELSE tenant_name END,
          property_id=COALESCE(${b.property_id ? Number(b.property_id) : null}, property_id),
          parent_job_id=CASE WHEN ${hasPid}::boolean THEN ${pid}::int ELSE parent_job_id END
          WHERE id=${id} RETURNING *`;
        return note(j, miss);
      }
    }

    // ---------- FILE CABINET ----------
    // POST /api/files                 -> start a file (metadata), returns id + how many pieces to send
    // PUT  /api/files/:id/chunk/:n    -> send piece n (raw bytes, max 4 MB)
    // POST /api/files/:id/finish      -> checks every piece is there, then marks the file complete
    // GET  /api/files/:id             -> download (pieces glued back together)
    if (kind === "files") {
      const store = getStore({ name: "job-files", consistency: "strong" });
      if (m === "POST" && !id) {
        const b = await req.json();
        const miss = missingOnFile(b);            // a note that rides back, never a refusal
        const chunks = chunkCount(Number(b.size_bytes) || 0);
        const owner = b.customer_id ? `customer-${b.customer_id}` : b.sub_id ? `sub-${b.sub_id}` : b.supply_invoice_id ? `supply-${b.supply_invoice_id}` : `job-${b.job_id}`;
        const key = `${owner}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const [f] = await sql`INSERT INTO files (job_id, supply_invoice_id, sub_id, customer_id, drawer, name, content_type, size_bytes, chunks, blob_key)
          VALUES (${b.job_id || null}, ${b.supply_invoice_id || null}, ${b.sub_id || null}, ${b.customer_id || null}, ${b.customer_id ? "Pinned" : b.sub_id ? "W-9" : b.supply_invoice_id ? "Paper" : (b.drawer || "")}, ${String(b.name || "").trim()}, ${b.content_type || "application/octet-stream"}, ${Number(b.size_bytes) || 0}, ${chunks}, ${key})
          RETURNING *`;
        return note({ ...f, chunk_bytes: CHUNK_BYTES }, miss);
      }
      const [f] = id ? await sql`SELECT * FROM files WHERE id=${id}` : [];
      if (!f) return json({ error: "Not found" }, 404);
      if (m === "PUT" && sub === "chunk") {
        const n = Number(subId);
        if (!(n >= 0 && n < f.chunks)) return json({ error: "Bad piece number" }, 400);
        const bytes = await req.arrayBuffer();
        await store.set(`${f.blob_key}/${n}`, bytes);
        const back = await store.get(`${f.blob_key}/${n}`, { type: "arrayBuffer" });
        if (!back || back.byteLength !== bytes.byteLength) return json({ error: `Piece ${n} did not save` }, 500);
        return json({ piece: n, bytes: back.byteLength });
      }
      if (m === "POST" && sub === "finish") {
        let total = 0;
        for (let n = 0; n < f.chunks; n++) {
          const meta = await store.getWithMetadata(`${f.blob_key}/${n}`, { type: "arrayBuffer" });
          if (!meta) return json({ error: `Piece ${n + 1} of ${f.chunks} is missing` }, 409);
          total += meta.data.byteLength;
        }
        if (total !== Number(f.size_bytes)) return json({ error: `Size mismatch: expected ${f.size_bytes}, stored ${total}` }, 409);
        const [done] = await sql`UPDATE files SET complete=TRUE WHERE id=${id} RETURNING *`;
        return json(done);
      }
      if (m === "GET") {
        const pieces: Uint8Array[] = [];
        for (let n = 0; n < f.chunks; n++) {
          const buf = await store.get(`${f.blob_key}/${n}`, { type: "arrayBuffer" });
          if (!buf) return json({ error: `Piece ${n + 1} missing` }, 500);
          pieces.push(new Uint8Array(buf));
        }
        const stream = new ReadableStream({ start(ctrl) { pieces.forEach(p => ctrl.enqueue(p)); ctrl.close(); } });
        const inline = /^(image\/|application\/pdf|text\/)/.test(f.content_type);
        return new Response(stream, { headers: {
          "content-type": f.content_type,
          "content-length": String(f.size_bytes),
          "content-disposition": `${inline ? "inline" : "attachment"}; filename="${encodeURIComponent(f.name)}"`,
        }});
      }
    }

    // ---------- SEARCH ----------
    if (kind === "search" && m === "GET") {
      const q = "%" + (url.searchParams.get("q") || "").trim().toLowerCase() + "%";
      const customers = await sql`SELECT id, name FROM customers WHERE LOWER(name) LIKE ${q} ORDER BY LOWER(name) LIMIT 25`;
      const properties = await sql`SELECT p.id, p.address, p.city, c.name AS customer_name FROM properties p
        JOIN customers c ON c.id=p.customer_id WHERE LOWER(p.address) LIKE ${q} OR LOWER(p.tenant) LIKE ${q} OR LOWER(p.city) LIKE ${q} OR LOWER(p.bill_name) LIKE ${q}
        ORDER BY LOWER(p.address) LIMIT 25`;
      return json({ customers, properties });
    }

    // ---------- GMAIL OAUTH ----------
    // Read, file, and take a label off when it is done (9/21/26). gmail.modify is the smallest Google
    // permission that lets the app remove SMS/R etc. from an email once it has filed it. The app has
    // no send and no reply anywhere in it — a build test fails if one is ever added.
    if (kind === "gmail") {
      const store = getStore({ name: "gmail", consistency: "strong" });
      const clientId = Netlify.env.get("GMAIL_CLIENT_ID") || "";
      const clientSecret = Netlify.env.get("GMAIL_CLIENT_SECRET") || "";
      const redirectUri = `${url.origin}/api/gmail/callback`;

      if (idRaw === "connect" && m === "GET") {
        const state = randomUUID();
        await store.set("state", state);
        const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
        authUrl.searchParams.set("client_id", clientId);
        authUrl.searchParams.set("response_type", "code");
        authUrl.searchParams.set("scope", "https://www.googleapis.com/auth/gmail.modify");
        authUrl.searchParams.set("redirect_uri", redirectUri);
        authUrl.searchParams.set("access_type", "offline");
        authUrl.searchParams.set("prompt", "consent");
        authUrl.searchParams.set("state", state);
        return new Response(null, { status: 302, headers: { location: authUrl.toString() } });
      }

      if (idRaw === "callback" && m === "GET") {
        const err = url.searchParams.get("error");
        if (err) return json({ error: `Google declined: ${err}` }, 400);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const savedState = await store.get("state");
        if (!code || !state || state !== savedState) return json({ error: "That connect link is bad or expired. Go to /api/gmail/connect and try again." }, 400);
        const res = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code" }),
        });
        const tok: any = await res.json();
        if (!res.ok) return json({ error: "Google token exchange failed", detail: tok }, 502);
        await store.setJSON("tokens", {
          access_token: tok.access_token,
          refresh_token: tok.refresh_token,
          obtained_at: Date.now(),
          expires_at: Date.now() + (tok.expires_in || 3600) * 1000,
          scope: String(tok.scope || ""),
        });
        return new Response(null, { status: 302, headers: { location: "/?gmail=connected" } });
      }

      if (idRaw === "status" && m === "GET") {
        const tokens: any = await store.get("tokens", { type: "json" });
        // can_label = the connection allows taking a label off; an older read-only connection can't
        return json({ connected: !!tokens, can_label: !!tokens && /gmail\.modify/.test(String(tokens.scope || "")) });
      }
    }

    // ---------- QUICKBOOKS OAUTH ----------
    if (kind === "qbo") {
      const store = getStore({ name: "qbo", consistency: "strong" });
      const clientId = Netlify.env.get("QBO_CLIENT_ID") || "";
      const clientSecret = Netlify.env.get("QBO_CLIENT_SECRET") || "";
      const redirectUri = `${url.origin}/api/qbo/callback`;

      if (idRaw === "connect" && m === "GET") {
        const state = randomUUID();
        await store.set("state", state);
        const authUrl = new URL("https://appcenter.intuit.com/connect/oauth2");
        authUrl.searchParams.set("client_id", clientId);
        authUrl.searchParams.set("response_type", "code");
        authUrl.searchParams.set("scope", "com.intuit.quickbooks.accounting");
        authUrl.searchParams.set("redirect_uri", redirectUri);
        authUrl.searchParams.set("state", state);
        return new Response(null, { status: 302, headers: { location: authUrl.toString() } });
      }

      if (idRaw === "callback" && m === "GET") {
        const err = url.searchParams.get("error");
        if (err) return json({ error: `QuickBooks declined: ${err}` }, 400);
        const code = url.searchParams.get("code");
        const realmId = url.searchParams.get("realmId");
        const state = url.searchParams.get("state");
        const savedState = await store.get("state");
        if (!code || !realmId || !state || state !== savedState) {
          return json({ error: "That connect link is bad or expired. Go to /api/qbo/connect and try again." }, 400);
        }
        const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
        const res = await fetch("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", {
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            "accept": "application/json",
            "authorization": `Basic ${basic}`,
          },
          body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri }),
        });
        const tok = await res.json();
        if (!res.ok) return json({ error: "QuickBooks token exchange failed", detail: tok }, 502);
        await store.setJSON("tokens", {
          access_token: tok.access_token,
          refresh_token: tok.refresh_token,
          realm_id: realmId,
          obtained_at: Date.now(),
          expires_at: Date.now() + (tok.expires_in || 3600) * 1000,
        });
        return new Response(null, { status: 302, headers: { location: "/?qbo=connected" } });
      }

      if (idRaw === "status" && m === "GET") {
        const tokens: any = await store.get("tokens", { type: "json" });
        return json({ connected: !!tokens, realm_id: tokens?.realm_id || null });
      }
    }

    return json({ error: "Unknown request" }, 404);
  } catch (e: any) {
    return json({ error: String(e?.message || e) }, 500);
  }
};

export const config: Config = { path: "/api/*" };
