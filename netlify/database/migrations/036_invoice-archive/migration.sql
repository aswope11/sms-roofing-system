-- A copy of an unsent invoice at the moment Work is done is undone (reopen).
-- Adds a table only. No existing invoice, stop, or payment row is changed.
-- Safe to run again: if the table is already there, this does nothing.
CREATE TABLE IF NOT EXISTS invoice_archive (
  id SERIAL PRIMARY KEY,
  invoice_id INTEGER,
  job_id INTEGER,
  kind TEXT,
  name TEXT DEFAULT '',
  number TEXT DEFAULT '',
  amount NUMERIC(12,2),
  qb_id TEXT DEFAULT '',
  memo TEXT DEFAULT '',
  scope TEXT DEFAULT '',
  work_date DATE,
  inv_date DATE,
  covers_through DATE,
  deleted_at TIMESTAMPTZ DEFAULT NOW(),
  why TEXT NOT NULL DEFAULT ''
);
