-- SHOP JOURNAL (9/28/26). His ask: "a journal of all labor applied to shop and why".
-- The labor itself comes from the Schedule (men put on the Shop job file). This only holds the WHY:
-- one line per day per name that shows on the job cost sheet (a sub's crew is one line under the sub).
CREATE TABLE shop_why (
  work_date DATE NOT NULL,
  shows_as TEXT NOT NULL,
  why TEXT NOT NULL DEFAULT '',
  changed_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (work_date, shows_as)
);
