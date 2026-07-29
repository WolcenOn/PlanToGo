ALTER TABLE plans
    ADD COLUMN IF NOT EXISTS schedule_mode TEXT NOT NULL DEFAULT 'standard';

UPDATE plans p
SET schedule_mode = 'trip'
WHERE p.confirmed_option_id IS NOT NULL
   OR EXISTS (
       SELECT 1
       FROM plan_date_options o
       WHERE o.plan_id = p.id
         AND o.end_time - o.start_time >= INTERVAL '12 hours'
   );

CREATE INDEX IF NOT EXISTS plans_schedule_mode_idx ON plans(schedule_mode);
