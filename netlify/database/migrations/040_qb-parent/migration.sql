-- QUICKBOOKS PARENT NAME ON THE BILLING CARD (10/8/26). The company's name in QuickBooks is not always the app's name
-- ("Wortham Bros., Inc." vs "Wortham Brothers Roofing"), so new building customers landed loose instead of under the
-- company — and then sat in the wrong spot on the P&L and AR. New column only; safe to run again.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS qb_parent TEXT NOT NULL DEFAULT '';
UPDATE customers SET qb_parent = 'Wortham Bros., Inc.' WHERE name ILIKE '%wortham%' AND qb_parent = '';
UPDATE customers SET qb_parent = 'Standridge Companies' WHERE name ILIKE '%standridge%' AND qb_parent = '';
UPDATE customers SET qb_parent = 'Four Corners Property Company' WHERE name ILIKE '%four corners%' AND qb_parent = '';
