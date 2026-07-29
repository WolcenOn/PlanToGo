DROP INDEX IF EXISTS plans_schedule_mode_idx;
ALTER TABLE plans DROP COLUMN IF EXISTS schedule_mode;
