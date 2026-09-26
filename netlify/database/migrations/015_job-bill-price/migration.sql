-- The price he puts on the ticket for the real invoice (blank = the placeholder's price). Cleared once the invoice is written.
ALTER TABLE jobs ADD COLUMN bill_price NUMERIC(12,2);
