-- The pills under the old board's schedule: where a ticket stands, why it's priority one, and his up/down order.
ALTER TABLE jobs ADD COLUMN stage TEXT NOT NULL DEFAULT 'ready' CHECK (stage IN ('ready','hold','trades','contract'));
ALTER TABLE jobs ADD COLUMN priority_why TEXT DEFAULT '';
ALTER TABLE jobs ADD COLUMN sched_rank INTEGER;
