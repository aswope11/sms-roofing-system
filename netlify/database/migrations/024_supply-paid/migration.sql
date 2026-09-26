-- One click marks a supply invoice paid, the same as Tenorio's pay ledger. Click again and it comes back.
ALTER TABLE supply_invoices ADD COLUMN paid_at DATE;
