-- A UC is a mini job cost: it carries its own contract, and each trip bills off it.
ALTER TABLE jobs ADD COLUMN job_contract NUMERIC(12,2);
