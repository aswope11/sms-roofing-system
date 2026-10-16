-- SUPPLY INVOICE → QUICKBOOKS (10/16/26): which supply bill went onto which QuickBooks placeholder, for which ticket,
-- with the exact line words and dollars, so a re-save swaps that one line instead of adding it twice. JC never lands here.
CREATE TABLE IF NOT EXISTS supply_qb (
  id SERIAL PRIMARY KEY,
  invoice_id INT NOT NULL,
  job_id INT NOT NULL,
  placeholder_id INT NOT NULL,
  qb_id TEXT NOT NULL,
  description TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (invoice_id, job_id)
);
