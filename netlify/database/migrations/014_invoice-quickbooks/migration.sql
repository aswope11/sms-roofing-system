-- Step 5 to QuickBooks: the QuickBooks invoice id once it's in, and why it didn't go if it failed.
ALTER TABLE invoices ADD COLUMN qb_id TEXT NOT NULL DEFAULT '';
ALTER TABLE invoices ADD COLUMN qb_error TEXT NOT NULL DEFAULT '';
