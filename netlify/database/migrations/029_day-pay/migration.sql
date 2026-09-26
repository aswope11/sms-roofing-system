-- A DAY'S ACTUAL PAY (9/25/26). "The numbers I use are more of a placeholder... every once in a while I get a quote, so I need to change it."
-- Blank = days × his day rate, same as always. A number here = what he is actually paid that day. His day rate never changes.
ALTER TABLE crew_days ADD COLUMN pay NUMERIC(10,2);
