-- A man's day can be divided by percent instead of evenly (10% one job, 90% the other). NULL = even share of what's left.
ALTER TABLE stops ADD COLUMN pct NUMERIC(5,2);
-- What he did on that job that day.
ALTER TABLE stops ADD COLUMN day_scope TEXT NOT NULL DEFAULT '';
