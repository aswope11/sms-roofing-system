-- Mail import bookkeeping. New columns and a new table only.
-- No existing mail, file, job, or invoice row is updated or deleted.
-- Safe to run again: each add is skipped when it is already there.
ALTER TABLE mail_items ADD COLUMN IF NOT EXISTS thread_id TEXT;
ALTER TABLE mail_items ADD COLUMN IF NOT EXISTS label_kept BOOLEAN;
ALTER TABLE mail_items ADD COLUMN IF NOT EXISTS import_label TEXT;
ALTER TABLE files ADD COLUMN IF NOT EXISTS gmail_message_id TEXT;
CREATE INDEX IF NOT EXISTS files_gmail_message ON files (gmail_message_id);
CREATE TABLE IF NOT EXISTS mail_import_log (
  id SERIAL PRIMARY KEY,
  message_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  job_id INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  dismissed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS mail_import_log_open ON mail_import_log (message_id, kind);
