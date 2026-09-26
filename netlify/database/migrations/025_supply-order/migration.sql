-- He drags the bills into the order he pays them. A credit dropped under a bill ties to that bill.
ALTER TABLE supply_invoices ADD COLUMN ord INTEGER;
