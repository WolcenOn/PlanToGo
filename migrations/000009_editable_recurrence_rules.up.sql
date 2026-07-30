CREATE TABLE IF NOT EXISTS plan_recurrence_series_v2 (
    plan_id UUID PRIMARY KEY REFERENCES plans(id) ON DELETE CASCADE,
    starts_on DATE NOT NULL,
    ends_on DATE NOT NULL,
    timezone TEXT NOT NULL DEFAULT 'Europe/Madrid',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (ends_on >= starts_on)
);

CREATE TABLE IF NOT EXISTS plan_recurrence_rules_v2 (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id UUID NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
    weekday SMALLINT NOT NULL CHECK (weekday BETWEEN 1 AND 7),
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(plan_id, weekday),
    CHECK (end_time > start_time)
);

CREATE TABLE IF NOT EXISTS plan_recurrence_exceptions_v2 (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id UUID NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
    occurrence_date DATE NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('cancel','override')),
    starts_at TIMESTAMPTZ,
    ends_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(plan_id, occurrence_date),
    CHECK ((action='cancel' AND starts_at IS NULL AND ends_at IS NULL) OR (action='override' AND starts_at IS NOT NULL AND ends_at IS NOT NULL AND ends_at > starts_at))
);

CREATE INDEX IF NOT EXISTS plan_recurrence_rules_v2_plan_idx ON plan_recurrence_rules_v2(plan_id);
CREATE INDEX IF NOT EXISTS plan_recurrence_exceptions_v2_plan_idx ON plan_recurrence_exceptions_v2(plan_id, occurrence_date);
