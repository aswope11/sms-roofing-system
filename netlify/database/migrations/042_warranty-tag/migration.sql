-- Let a new ticket be tagged W (warranty). Existing rows stay as they are.
ALTER TABLE jobs DROP CONSTRAINT jobs_tag_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_tag_check CHECK (tag IN ('BID','R','CO','UC','JC','W'));
