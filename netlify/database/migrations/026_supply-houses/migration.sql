-- EVERY SUPPLY HOUSE HE USES IS ITS OWN RECORD — listed whether or not it has an invoice on it.
-- The old board kept the same five and seeded them the same way (SEED_HOUSES).
CREATE TABLE supply_houses (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  ord INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO supply_houses (name, ord) VALUES
  ('ABC', 1), ('QXO', 2), ('SBM', 3), ('SRS', 4), ('TX First Rentals', 5);
-- anything already carrying invoices gets its record too, so nothing on the book loses its page
INSERT INTO supply_houses (name)
  SELECT DISTINCT TRIM(house) FROM supply_invoices WHERE TRIM(house) <> ''
  ON CONFLICT (name) DO NOTHING;
