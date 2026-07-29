CREATE TABLE IF NOT EXISTS plan_schedule_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id UUID NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('instant','interval','recurrence')),
    state TEXT NOT NULL DEFAULT 'confirmed' CHECK (state IN ('candidate','confirmed','cancelled')),
    start_time TIMESTAMPTZ,
    end_time TIMESTAMPTZ,
    recurrence JSONB,
    timezone TEXT NOT NULL DEFAULT 'Europe/Madrid',
    source_option_id UUID REFERENCES plan_date_options(id) ON DELETE CASCADE,
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
CREATE UNIQUE INDEX IF NOT EXISTS plan_schedule_entries_single_instant_uidx
    ON plan_schedule_entries(plan_id)
    WHERE kind='instant';
CREATE INDEX IF NOT EXISTS plan_schedule_entries_plan_idx ON plan_schedule_entries(plan_id);
CREATE INDEX IF NOT EXISTS plan_schedule_entries_range_idx ON plan_schedule_entries(start_time,end_time);

INSERT INTO plan_schedule_entries(plan_id,kind,state,start_time,end_time,source_option_id)
SELECT o.plan_id,
       'interval',
       CASE WHEN p.status='confirmed' AND (p.confirmed_option_id=o.id OR (p.confirmed_option_id IS NULL AND p.confirmed_date IS NOT NULL AND abs(extract(epoch FROM (o.start_time-p.confirmed_date))) < 60)) THEN 'confirmed' ELSE 'candidate' END,
       o.start_time,o.end_time,o.id
FROM plan_date_options o
JOIN plans p ON p.id=o.plan_id
ON CONFLICT (source_option_id) WHERE source_option_id IS NOT NULL DO NOTHING;

INSERT INTO plan_schedule_entries(plan_id,kind,state,start_time)
SELECT p.id,'instant','confirmed',p.confirmed_date
FROM plans p
WHERE p.confirmed_date IS NOT NULL
  AND p.schedule_mode <> 'trip'
  AND NOT EXISTS (SELECT 1 FROM plan_schedule_entries s WHERE s.plan_id=p.id)
ON CONFLICT (plan_id) WHERE kind='instant' DO NOTHING;

CREATE OR REPLACE FUNCTION sync_plan_option_schedule() RETURNS trigger AS $$
DECLARE plan_status TEXT; confirmed_id UUID; confirmed_at TIMESTAMPTZ;
BEGIN
    SELECT status, confirmed_option_id, confirmed_date INTO plan_status, confirmed_id, confirmed_at FROM plans WHERE id=NEW.plan_id;
    INSERT INTO plan_schedule_entries(plan_id,kind,state,start_time,end_time,source_option_id,updated_at)
    VALUES(NEW.plan_id,'interval',CASE WHEN plan_status='confirmed' AND (confirmed_id=NEW.id OR (confirmed_id IS NULL AND confirmed_at IS NOT NULL AND abs(extract(epoch FROM (NEW.start_time-confirmed_at))) < 60)) THEN 'confirmed' ELSE 'candidate' END,NEW.start_time,NEW.end_time,NEW.id,now())
    ON CONFLICT (source_option_id) WHERE source_option_id IS NOT NULL
    DO UPDATE SET start_time=EXCLUDED.start_time,end_time=EXCLUDED.end_time,state=EXCLUDED.state,updated_at=now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER plan_option_schedule_sync
AFTER INSERT OR UPDATE OF start_time,end_time ON plan_date_options
FOR EACH ROW EXECUTE FUNCTION sync_plan_option_schedule();

CREATE OR REPLACE FUNCTION sync_plan_schedule_state() RETURNS trigger AS $$
BEGIN
    IF NEW.schedule_mode <> 'trip' AND NEW.confirmed_date IS NOT NULL THEN
        INSERT INTO plan_schedule_entries(plan_id,kind,state,start_time,updated_at)
        VALUES(NEW.id,'instant','confirmed',NEW.confirmed_date,now())
        ON CONFLICT (plan_id) WHERE kind='instant'
        DO UPDATE SET start_time=EXCLUDED.start_time,state='confirmed',updated_at=now();
    END IF;
    IF NEW.schedule_mode='trip' THEN
        UPDATE plan_schedule_entries s
        SET state=CASE WHEN NEW.status='confirmed' AND (NEW.confirmed_option_id=s.source_option_id OR (NEW.confirmed_option_id IS NULL AND NEW.confirmed_date IS NOT NULL AND abs(extract(epoch FROM (s.start_time-NEW.confirmed_date))) < 60)) THEN 'confirmed' ELSE 'candidate' END,
            updated_at=now()
        WHERE s.plan_id=NEW.id AND s.kind='interval';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER plan_schedule_state_sync
AFTER INSERT OR UPDATE OF confirmed_date,confirmed_option_id,status,schedule_mode ON plans
FOR EACH ROW EXECUTE FUNCTION sync_plan_schedule_state();
