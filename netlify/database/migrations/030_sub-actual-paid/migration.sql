-- ACTUAL PAID on a sub's pay ledger line (9/25/26). "I just want to go in and say 800 and then right next to it say actual paid... doctor it right there."
-- Sub page only: blank = the line is what the men's days add up to. A number = what he actually sent for that job that day.
-- It does not touch payroll, job cost or the customer bill.
ALTER TABLE sub_paid ADD COLUMN actual NUMERIC(10,2);
