-- PINNED ON THE COMPANY (9/28/26). His ask: pin Keeson's Four Corners property list (entity names + addresses)
-- to the Four Corners account "so all the info is there". A file can now belong to a customer (company page),
-- same file cabinet as job files / W-9s / supply paper. No foreign key on purpose: deleting a customer never
-- gets blocked by a pinned file.
ALTER TABLE files ADD COLUMN customer_id INTEGER;
