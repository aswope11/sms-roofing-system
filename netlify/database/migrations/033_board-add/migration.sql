-- SUBS ON THE SCHEDULE ONLY THE WEEK THEY WORK (9/28/26) — "same exact way the old app was".
-- SMS employees are always on the board. A sub (and the men under him) shows on a week when he has a job that week,
-- or when he is put up with "Put somebody on the board" (this table). The ✕ turns on_board off — nothing is deleted.
CREATE TABLE board_add (
  week_start DATE NOT NULL,
  crew_id INTEGER NOT NULL REFERENCES crew(id),
  on_board BOOLEAN NOT NULL DEFAULT TRUE,
  changed_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (week_start, crew_id)
);
