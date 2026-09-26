-- A real invoice written from "Ready to bill" covers every green day up to this date, so those days never show as unbilled again.
ALTER TABLE invoices ADD COLUMN covers_through DATE;
