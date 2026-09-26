-- A change order belongs to the job it was made on (e.g. CO under JC Building 4). A CO made on a CO belongs to that CO's parent.
ALTER TABLE jobs ADD COLUMN parent_job_id INTEGER REFERENCES jobs(id) ON DELETE SET NULL;
-- Link the COs already made from the schedule, read from their note "Change order made from the schedule — TAG Title".
UPDATE jobs c SET parent_job_id = p.id FROM jobs p
  WHERE c.tag = 'CO' AND c.parent_job_id IS NULL AND p.property_id = c.property_id AND p.id <> c.id
    AND c.notes = 'Change order made from the schedule — ' || p.tag || ' ' || p.title;
-- A CO whose parent is itself a CO moves up to that CO's parent.
UPDATE jobs c SET parent_job_id = p.parent_job_id FROM jobs p
  WHERE c.parent_job_id = p.id AND p.tag = 'CO' AND p.parent_job_id IS NOT NULL;
