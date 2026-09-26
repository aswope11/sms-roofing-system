-- PAID, WITH NO DATE ON IT. An invoice that was settled before this book existed is paid —
-- but nobody knows the day the money moved, and a date nobody knows is a date nobody should invent.
ALTER TABLE supply_invoices ADD COLUMN settled BOOLEAN NOT NULL DEFAULT FALSE;
