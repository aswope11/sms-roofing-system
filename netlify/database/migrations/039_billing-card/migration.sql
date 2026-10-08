-- BILLING CARD PER COMPANY (10/8/26). Who the invoice is billed to and how they pay, kept once on the customer,
-- so every invoice for that company fills Bill To from it (a building's own bill_name/bill_addr still wins —
-- Four Corners' owner LLCs live on the building). no_pay = never QuickBooks' online "View and pay".
-- And the invoice checker's result on each invoice. New columns only; safe to run again.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS bill_name TEXT NOT NULL DEFAULT '';
ALTER TABLE customers ADD COLUMN IF NOT EXISTS bill_addr TEXT NOT NULL DEFAULT '';
ALTER TABLE customers ADD COLUMN IF NOT EXISTS no_pay BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS check_problems TEXT NOT NULL DEFAULT '';
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS checked_at TIMESTAMPTZ;
UPDATE customers SET bill_name = 'Standridge Companies', bill_addr = E'10711 Preston Rd, Suite 222\nDallas, TX 75230'
  WHERE name ILIKE '%standridge%' AND bill_name = '';
UPDATE customers SET bill_name = 'Wortham Brothers Roofing', bill_addr = E'1492 FM 2933\nMcKinney, TX 75071'
  WHERE name ILIKE '%wortham%' AND bill_name = '';
UPDATE customers SET no_pay = TRUE WHERE name ILIKE '%standridge%' OR name ILIKE '%wortham%' OR name ILIKE '%four corners%';
