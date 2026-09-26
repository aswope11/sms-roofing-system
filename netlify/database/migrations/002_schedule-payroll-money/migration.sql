-- Step 2: schedule, payroll, ledger, AR, invoicing. Built empty.

-- The contract lives on the property.
ALTER TABLE properties ADD COLUMN contract_amount NUMERIC(12,2);

-- A work ticket's life. Every check here is HIS tick; the app never sets them.
ALTER TABLE jobs ADD COLUMN scheduled_date DATE;
ALTER TABLE jobs ADD COLUMN priority BOOLEAN DEFAULT FALSE;
ALTER TABLE jobs ADD COLUMN scope TEXT DEFAULT '';
ALTER TABLE jobs ADD COLUMN scope_ok BOOLEAN DEFAULT FALSE;
ALTER TABLE jobs ADD COLUMN scope_ok_at TIMESTAMPTZ;
ALTER TABLE jobs ADD COLUMN pics_ok BOOLEAN DEFAULT FALSE;
ALTER TABLE jobs ADD COLUMN pics_ok_at TIMESTAMPTZ;
ALTER TABLE jobs ADD COLUMN done_at DATE;
ALTER TABLE jobs ADD COLUMN tabled_at DATE;
ALTER TABLE jobs ADD COLUMN tabled_why TEXT DEFAULT '';
ALTER TABLE jobs ADD COLUMN no_charge BOOLEAN DEFAULT FALSE;

-- The crew. Pay-to is the Zelle / 1099 name. A man under a sub carries boss_id.
CREATE TABLE crew (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'employee' CHECK (kind IN ('employee','sub')),
  day_rate NUMERIC(10,2) NOT NULL DEFAULT 0,
  pay_to TEXT DEFAULT '',
  boss_id INTEGER REFERENCES crew(id),
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- A man on a job on a day. The schedule and Daily Payroll read the same rows.
CREATE TABLE stops (
  id SERIAL PRIMARY KEY,
  work_date DATE NOT NULL,
  crew_id INTEGER NOT NULL REFERENCES crew(id),
  job_id INTEGER NOT NULL REFERENCES jobs(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (work_date, crew_id, job_id)
);

-- How much of a day a man worked. No row = 1 day when he has stops.
CREATE TABLE crew_days (
  work_date DATE NOT NULL,
  crew_id INTEGER NOT NULL REFERENCES crew(id),
  days NUMERIC(4,2) NOT NULL,
  PRIMARY KEY (work_date, crew_id)
);

-- Green = this day is finished and correct.
CREATE TABLE green_days (
  work_date DATE PRIMARY KEY,
  green BOOLEAN NOT NULL DEFAULT TRUE,
  changed_at TIMESTAMPTZ DEFAULT NOW()
);

-- Customer invoices on a ticket: placeholder (a priced seat), real (the bill), draw (a piece of a contract).
CREATE TABLE invoices (
  id SERIAL PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES jobs(id),
  kind TEXT NOT NULL CHECK (kind IN ('placeholder','real','draw')),
  name TEXT DEFAULT '',
  number TEXT DEFAULT '',
  amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  inv_date DATE,
  work_date DATE,
  sent_at DATE,
  paid_at DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Supply house invoices, every line, every line applied to a job or the shop.
CREATE TABLE supply_invoices (
  id SERIAL PRIMARY KEY,
  house TEXT NOT NULL,
  number TEXT NOT NULL,
  inv_date DATE NOT NULL,
  due_date DATE,
  po TEXT DEFAULT '',
  amount NUMERIC(12,2) NOT NULL,
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE supply_lines (
  id SERIAL PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES supply_invoices(id),
  sku TEXT DEFAULT '',
  description TEXT NOT NULL,
  qty NUMERIC(12,3) NOT NULL,
  unit TEXT DEFAULT '',
  unit_price NUMERIC(12,4),
  line_total NUMERIC(12,2) NOT NULL,
  job_id INTEGER REFERENCES jobs(id),
  shop BOOLEAN DEFAULT FALSE
);

-- The paper on a supply invoice lives in the same file cabinet.
ALTER TABLE files ALTER COLUMN job_id DROP NOT NULL;
ALTER TABLE files ADD COLUMN supply_invoice_id INTEGER REFERENCES supply_invoices(id);

-- One payment, many invoices, a surcharge % per line. Taking one back voids it; nothing is deleted.
CREATE TABLE payments (
  id SERIAL PRIMARY KEY,
  house TEXT NOT NULL,
  pay_date DATE NOT NULL,
  method TEXT DEFAULT '',
  ref TEXT DEFAULT '',
  note TEXT DEFAULT '',
  voided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE payment_lines (
  id SERIAL PRIMARY KEY,
  payment_id INTEGER NOT NULL REFERENCES payments(id),
  invoice_id INTEGER NOT NULL REFERENCES supply_invoices(id),
  amount NUMERIC(12,2) NOT NULL,
  surcharge_pct NUMERIC(6,3) DEFAULT 0
);
