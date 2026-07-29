DROP INDEX IF EXISTS plans_confirmed_option_id_idx;
ALTER TABLE plans DROP COLUMN IF EXISTS confirmed_option_id;
