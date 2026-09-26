-- A sub's pay ledger: one line per job per day, in the pay-to name. He taps the amount once the Zelle is sent.
CREATE TABLE sub_paid (
  pay_to TEXT NOT NULL,
  work_date DATE NOT NULL,
  job_id INTEGER NOT NULL REFERENCES jobs(id),
  paid BOOLEAN NOT NULL DEFAULT TRUE,
  changed_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (pay_to, work_date, job_id)
);
