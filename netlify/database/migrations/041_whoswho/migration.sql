-- WHO'S WHO — THE LOCKED CUSTOMER MAP (10/11/26). One row per job location (building + tenant): who pays, the building,
-- the tenant, who called it in, and the QuickBooks spot (Company › Building › Tenant). A confirmed row is locked — only he
-- changes it. Every ticket/invoice is matched to one row before anything goes to QuickBooks; no confirmed match = stop and ask.
-- New tables only; safe to run again.
CREATE TABLE IF NOT EXISTS whoswho (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  property_id INTEGER REFERENCES properties(id) ON DELETE SET NULL,
  tenant TEXT NOT NULL DEFAULT '',
  tenant_key TEXT NOT NULL DEFAULT '',
  building TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  suite TEXT NOT NULL DEFAULT '',
  bill_name TEXT NOT NULL DEFAULT '',
  bill_addr TEXT NOT NULL DEFAULT '',
  called_in TEXT NOT NULL DEFAULT '',
  qb_customer_id TEXT NOT NULL DEFAULT '',
  qb_path TEXT NOT NULL DEFAULT '',
  building_qb_id TEXT NOT NULL DEFAULT '',
  building_qb_path TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'confirmed')),
  conflicts JSONB NOT NULL DEFAULT '[]'::jsonb,
  sources JSONB NOT NULL DEFAULT '{}'::jsonb,
  notes JSONB NOT NULL DEFAULT '[]'::jsonb,
  confirmed_by TEXT NOT NULL DEFAULT '',
  confirmed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS whoswho_loc ON whoswho(property_id, tenant_key);
-- Tickets the app stopped on because no confirmed row matched — the popup asks him, one at a time.
CREATE TABLE IF NOT EXISTS whoswho_ask (
  job_id INTEGER PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
  why TEXT NOT NULL DEFAULT '',
  asked_at TIMESTAMPTZ DEFAULT NOW()
);
-- Every change to a row and why (his confirm, his fix, his move in QuickBooks). Corrections stick.
CREATE TABLE IF NOT EXISTS whoswho_log (
  id SERIAL PRIMARY KEY,
  row_id INTEGER,
  what TEXT NOT NULL DEFAULT '',
  at TIMESTAMPTZ DEFAULT NOW()
);
-- Built-at time + the QuickBooks flags/customer lists per company from the last pre-fill.
CREATE TABLE IF NOT EXISTS whoswho_meta (
  k TEXT PRIMARY KEY,
  v JSONB NOT NULL DEFAULT '{}'::jsonb,
  at TIMESTAMPTZ DEFAULT NOW()
);
