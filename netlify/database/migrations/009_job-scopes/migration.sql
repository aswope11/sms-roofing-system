-- Scopes of work typed on a job come back as pills on that job only (old board jobParts / costCats).
CREATE TABLE job_scopes (
  id SERIAL PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES jobs(id),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (job_id, name)
);
INSERT INTO job_scopes (job_id, name)
  SELECT DISTINCT job_id, day_scope FROM stops WHERE day_scope <> '' ON CONFLICT DO NOTHING;
