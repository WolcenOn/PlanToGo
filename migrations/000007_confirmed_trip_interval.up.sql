ALTER TABLE plans
ADD COLUMN IF NOT EXISTS confirmed_option_id UUID REFERENCES plan_date_options(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS plans_confirmed_option_id_idx
ON plans(confirmed_option_id);
