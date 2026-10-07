-- QuickBooks customer map (10/7/26). Ids only — nothing here reads or writes QuickBooks.
-- Parent customer on the company, property sub-customer on the property.
-- Bucket (UC / CO / R) is not a new QuickBooks customer; it is a label, or an existing class / deeper sub-customer found later.
-- Numbered 038 because 036 and 037 belong to other pull requests. Netlify rejects a number at or below one already applied.
-- Idempotent: a preview database may already have these columns from an earlier 036 of this same change.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS qb_customer_id TEXT NOT NULL DEFAULT '';
ALTER TABLE customers ADD COLUMN IF NOT EXISTS qb_customer_name TEXT NOT NULL DEFAULT '';
ALTER TABLE properties ADD COLUMN IF NOT EXISTS qb_subcustomer_id TEXT NOT NULL DEFAULT '';
ALTER TABLE properties ADD COLUMN IF NOT EXISTS qb_subcustomer_name TEXT NOT NULL DEFAULT '';
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS qb_co_invoice_id TEXT NOT NULL DEFAULT '';
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS qb_class_id TEXT NOT NULL DEFAULT '';
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS qb_bucket_customer_id TEXT NOT NULL DEFAULT '';
-- qb_sync: this row was created by the new sync. Older QuickBooks invoices stay qb_sync false and are never edited from here.
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS qb_sync BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS qb_sync_attempts (
  id SERIAL PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  work_date DATE,
  kind TEXT NOT NULL,
  ok BOOLEAN NOT NULL DEFAULT FALSE,
  qb_error TEXT NOT NULL DEFAULT '',
  qb_id TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One claim per job per work day, so two green-day runs cannot both create an invoice.
CREATE TABLE IF NOT EXISTS qb_sync_claims (
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  work_date DATE NOT NULL,
  state TEXT NOT NULL DEFAULT 'working',
  doc_number TEXT NOT NULL DEFAULT '',
  invoice_id INTEGER,
  qb_id TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (job_id, work_date)
);

-- One opener at a time for a new change-order invoice, so two days cannot each create one.
CREATE TABLE IF NOT EXISTS qb_co_open (
  job_id INTEGER PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
