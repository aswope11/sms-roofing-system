-- Step 1 of a bid: who and where. The tenant belongs to THIS bid, not to the property —
-- one address (6101 Windhaven) can carry six buildings and thirty tenants.
ALTER TABLE jobs ADD COLUMN tenant_name TEXT NOT NULL DEFAULT '';
-- Step 2: the pills he tapped, one layer at a time, under the system they belong to.
CREATE TABLE bid_options (
  id SERIAL PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  cat TEXT NOT NULL,
  grp TEXT NOT NULL,
  name TEXT NOT NULL
);
CREATE UNIQUE INDEX bid_options_one ON bid_options(job_id, cat, grp, name);
