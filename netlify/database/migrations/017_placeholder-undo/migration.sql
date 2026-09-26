-- So a real invoice can be undone (ticket reopened): each placeholder it zeroed remembers its price and which invoice zeroed it.
ALTER TABLE invoices ADD COLUMN zeroed_from NUMERIC(12,2);
ALTER TABLE invoices ADD COLUMN zeroed_by INTEGER;
