-- ONE OPEN PLACEHOLDER PER TICKET (10/7/26). A placeholder is the running total for its ticket and holds every
-- green day added to it, with that day's dollars: {"2026-10-05": 1050.00}. New column only; each existing
-- placeholder gets its own one day filled in. Safe to run again.
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS days JSONB NOT NULL DEFAULT '{}'::jsonb;
UPDATE invoices SET days = jsonb_build_object(to_char(work_date, 'YYYY-MM-DD'), amount)
  WHERE kind = 'placeholder' AND work_date IS NOT NULL AND days = '{}'::jsonb;
