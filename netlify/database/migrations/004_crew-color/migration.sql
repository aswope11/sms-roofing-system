-- Each crew's color. Set on the man who runs the crew; men under him show his color.
ALTER TABLE crew ADD COLUMN color TEXT DEFAULT '';
UPDATE crew SET color = (ARRAY['#ff7a3d','#3dff8f','#7fe3ff','#ff4d8d','#ffd24d','#b388ff','#00e5c0','#ff9cf0'])[1 + (id % 8)] WHERE boss_id IS NULL;
