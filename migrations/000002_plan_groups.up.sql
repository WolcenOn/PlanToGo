CREATE TABLE IF NOT EXISTS plan_groups (
    plan_id UUID NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
    group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (plan_id, group_id)
);

CREATE INDEX IF NOT EXISTS plan_groups_group_id_idx ON plan_groups(group_id);

INSERT INTO plan_groups(plan_id, group_id)
SELECT id, group_id
FROM plans
WHERE group_id IS NOT NULL
ON CONFLICT DO NOTHING;
