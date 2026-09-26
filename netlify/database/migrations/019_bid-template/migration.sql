-- The bid's template: which system it's bid on, from the old bid app's list. Structure only — no numbers yet.
ALTER TABLE jobs ADD COLUMN bid_cat TEXT NOT NULL DEFAULT '';
ALTER TABLE jobs ADD COLUMN bid_system TEXT NOT NULL DEFAULT '';
