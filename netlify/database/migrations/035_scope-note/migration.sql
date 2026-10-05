-- WHERE THE SCOPE GOES ON THE QUICKBOOKS INVOICE (10/4/26, his rule). TRUE = the Note to customer (bottom left).
-- Standridge and Four Corners always go to the note (set in code, not here). Everybody else: his switch on the ticket.
ALTER TABLE jobs ADD COLUMN scope_note BOOLEAN NOT NULL DEFAULT FALSE;
