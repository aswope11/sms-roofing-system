-- Let a ticket be tagged TC (test cut). Bills like a repair. Existing rows stay as they are.
ALTER TABLE jobs DROP CONSTRAINT jobs_tag_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_tag_check CHECK (tag IN ('BID','R','WT','TC','CO','UC','JC','W'));
