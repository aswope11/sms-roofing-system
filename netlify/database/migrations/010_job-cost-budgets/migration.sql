-- Job cost sheet (Greenhill layout). Scopes come from the bid for the job and grow as work comes up.
ALTER TABLE job_scopes ADD COLUMN budget NUMERIC(12,2);
-- How a man's stop divides across the scopes he worked: {"SS Panels": 70, "Coping cap": null}; blank = even share of what's left.
ALTER TABLE stops ADD COLUMN scope_split JSONB;
UPDATE stops SET scope_split = (SELECT jsonb_object_agg(x, 'null'::jsonb) FROM unnest(string_to_array(day_scope, ' · ')) AS x)
  WHERE day_scope <> '';
-- Materials categories per job with a budget (TPO, Home Depot, Skytrak, GL insurance …).
CREATE TABLE cost_categories (
  id SERIAL PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES jobs(id),
  name TEXT NOT NULL,
  budget NUMERIC(12,2),
  UNIQUE (job_id, name)
);
-- Which category a supply invoice lands in on a job. Blank = the supply house name.
CREATE TABLE material_category (
  job_id INTEGER NOT NULL REFERENCES jobs(id),
  invoice_id INTEGER NOT NULL REFERENCES supply_invoices(id),
  category TEXT NOT NULL,
  PRIMARY KEY (job_id, invoice_id)
);
-- What a change order was sold for.
ALTER TABLE jobs ADD COLUMN co_amount NUMERIC(12,2);
