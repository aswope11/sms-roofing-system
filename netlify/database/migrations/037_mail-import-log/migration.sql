-- Mail import bookkeeping. New columns and a new table only.
-- No existing mail, file, job, or invoice row is updated or deleted.
ALTER TABLE mail_items ADD COLUMN thread_id TEXT;
ALTER TABLE mail_items ADD COLUMN label_kept BOOLEAN;
ALTER TABLE files ADD COLUMN gmail_message_id TEXT;
CREATE INDEX files_gmail_message ON files (gmail_message_id);
CREATE TABLE mail_import_log (
  id SERIAL PRIMARY KEY,
  message_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  job_id INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  dismissed_at TIMESTAMPTZ
);
CREATE INDEX mail_import_log_open ON mail_import_log (message_id, kind);
