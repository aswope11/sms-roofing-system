-- Bids page: a bid is a BID ticket with a due date. It stays on Bids until it's Awarded, which makes the real ticket.
ALTER TABLE jobs ADD COLUMN bid_due DATE;
ALTER TABLE jobs ADD COLUMN bid_sent_at DATE;
ALTER TABLE jobs ADD COLUMN bid_amount NUMERIC(12,2);
ALTER TABLE jobs ADD COLUMN awarded_at DATE;
ALTER TABLE jobs ADD COLUMN awarded_job_id INTEGER REFERENCES jobs(id) ON DELETE SET NULL;
