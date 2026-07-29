CREATE TABLE IF NOT EXISTS plan_schedule_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id UUID NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('instant','interval','recurrence')),
    state TEXT NOT NULL DEFAULT 'confirmed' CHECK (state IN ('candidate','confirmed','cancelled')),
    start_time TIMESTAMPTZ,
    end_time TIMESTAMPTZ,
    recurrence JSONB,
    timezone TEXT NOT NULL DEFAULT 'Europe/Madrid',
    source_option_id UUID REFERENCES plan_date_options(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (
        (kind = 'instant' AND start_time IS NOT NULL AND end_time IS NULL AND recurrence IS NULL)
        OR (kind = 'interval' AND start_time IS NOT NULL AND end_time IS NOT NULL AND end_time > start_time AND recurrence IS NULL)
        OR (kind = 'recurrence' AND recurrence IS NOT NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS plan_schedule_entries_source_option_uidx
    ON plan_schedule_entries(source_option_id)
    WHERE source_option_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS plan_schedule_entries_plan_idx ON plan_schedule_entries(plan_id);
CREATE INDEX IF NOT EXISTS plan_schedule_entries_range_idx ON plan_schedule_entries(start_time,end_time);

INSERT INTO plan_schedule_entries(plan_id,kind,state,start_time,end_time,source_option_id)
SELECT o.plan_id,
       'interval',
       CASE WHEN p.status='confirmed' AND (p.confirmed_option_id=o.id OR (p.confirmed_option_id IS NULL AND p.confirmed_date IS NOT NULL AND abs(extract(epoch FROM (o.start_time-p.confirmed_date))) < 60)) THEN 'confirmed' ELSE 'candidate' END,
       o.start_time,
       o.end_time,
       o.id
FROM plan_date_options o
JOIN plans p ON p.id=o.plan_id
ON CONFLICT (source_option_id) WHERE source_option_id IS NOT NULL DO NOTHING;

INSERT INTO plan_schedule_entries(plan_id,kind,state,start_time)
SELECT p.id,'instant','confirmed',p.confirmed_date
FROM plans p
WHERE p.confirmed_date IS NOT NULL
  AND p.schedule_mode <> 'trip'
  AND NOT EXISTS (SELECT 1 FROM plan_schedule_entries s WHERE s.plan_id=p.id)
  AND NOT EXISTS (SELECT 1 FROM plan_schedule_entries s WHERE s.plan_id=p.id AND s.kind='instant' AND s.start_time=p.confirmed_date);
