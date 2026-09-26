-- Subs tab, rebuilt from the old board's Subs page. A crew sub (crew_id set) is paid off his pay ledger, not off invoices.
CREATE TABLE subs (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  contact TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  email TEXT DEFAULT '',
  addr TEXT DEFAULT '',
  trade TEXT DEFAULT '',
  about TEXT DEFAULT '',
  crew_id INTEGER REFERENCES crew(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE files ADD COLUMN sub_id INTEGER REFERENCES subs(id);
