-- INVOICE BILL-TO (9/23/26). "When the invoice goes out, they don't want to be on invoices."
-- Four Corners jobs sit under Four Corners in the books, but the invoice itself says the owning LLC
-- top left and the tenant on the right. Blank = the invoice goes out the way it always has.
ALTER TABLE properties ADD COLUMN bill_name TEXT NOT NULL DEFAULT '';
ALTER TABLE properties ADD COLUMN bill_addr TEXT NOT NULL DEFAULT '';
ALTER TABLE properties ADD COLUMN ship_addr TEXT NOT NULL DEFAULT '';
