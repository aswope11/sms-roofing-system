-- The order men show in on Crew and Daily Payroll. He sets it by dragging.
ALTER TABLE crew ADD COLUMN sort_order INTEGER;
UPDATE crew SET sort_order = id;
