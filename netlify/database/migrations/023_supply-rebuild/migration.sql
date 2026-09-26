-- Supply houses, the way the old board had them.
ALTER TABLE supply_invoices ADD COLUMN books_as TEXT NOT NULL DEFAULT 'Material';   -- Material · Equipment · Sub
ALTER TABLE supply_invoices ADD COLUMN ship_date DATE;
ALTER TABLE supply_invoices ADD COLUMN credit_of INTEGER REFERENCES supply_invoices(id) ON DELETE SET NULL;  -- a credit sits under the bill it comes off
ALTER TABLE supply_invoices ADD COLUMN dispute TEXT NOT NULL DEFAULT '';            -- words = DO NOT PAY, in dispute
ALTER TABLE supply_invoices ADD COLUMN qty_ok TEXT NOT NULL DEFAULT '';             -- the three checks: who checked it
ALTER TABLE supply_invoices ADD COLUMN prod_ok TEXT NOT NULL DEFAULT '';
ALTER TABLE supply_invoices ADD COLUMN price_ok TEXT NOT NULL DEFAULT '';
ALTER TABLE supply_invoices ADD COLUMN checked_at DATE;
ALTER TABLE supply_invoices ADD COLUMN needs_reading BOOLEAN NOT NULL DEFAULT FALSE; -- landed as paper, nothing read off it yet
