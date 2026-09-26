-- One bid can carry as many systems as the job has. He names them in one sentence; the app pulls the templates.
CREATE TABLE bid_systems (
  id SERIAL PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  cat TEXT NOT NULL,
  system TEXT NOT NULL DEFAULT '',
  size TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX bid_systems_one ON bid_systems(job_id, cat, system);
-- What he actually typed or said, kept word for word on the bid.
ALTER TABLE jobs ADD COLUMN bid_said TEXT NOT NULL DEFAULT '';
