-- The app's own Gmail: every message it has looked at once, and where it put it. Read and file only — it never sends.
CREATE TABLE mail_items (
  id SERIAL PRIMARY KEY,
  message_id TEXT NOT NULL UNIQUE,
  from_addr TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '',
  sent_at TIMESTAMPTZ,
  snippet TEXT NOT NULL DEFAULT '',
  job_id INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
  state TEXT NOT NULL DEFAULT 'needs_you',      -- filed · needs_you · skipped
  what TEXT NOT NULL DEFAULT '',                 -- what it did, in plain words
  attachments INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX mail_items_state ON mail_items(state);
