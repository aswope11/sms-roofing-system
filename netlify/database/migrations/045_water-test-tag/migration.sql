-- Let a ticket be tagged WT (water test). Existing rows stay as they are.
ALTER TABLE jobs DROP CONSTRAINT jobs_tag_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_tag_check CHECK (tag IN ('BID','R','WT','CO','UC','JC','W'));
