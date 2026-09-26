-- Step 5: the real invoice and the placeholder it replaces carry the SAME memo, word for word; the real invoice carries the scope word for word.
ALTER TABLE invoices ADD COLUMN memo TEXT NOT NULL DEFAULT '';
ALTER TABLE invoices ADD COLUMN scope TEXT NOT NULL DEFAULT '';
