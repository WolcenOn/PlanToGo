CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE group_role AS ENUM ('admin', 'member');
CREATE TYPE plan_type AS ENUM ('flexible', 'fixed');
CREATE TYPE plan_status AS ENUM ('voting', 'confirmed', 'cancelled');
CREATE TYPE availability_vote AS ENUM ('yes', 'no', 'maybe');
CREATE TYPE task_status AS ENUM ('pending', 'completed');
CREATE TYPE token_purpose AS ENUM ('plan_access', 'group_join', 'guest_session');

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
    email TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
    description TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE group_members (
    group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role group_role NOT NULL DEFAULT 'member',
    joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (group_id, user_id)
);

CREATE TABLE plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id UUID REFERENCES groups(id) ON DELETE SET NULL,
    title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 160),
    description TEXT NOT NULL DEFAULT '',
    type plan_type NOT NULL,
    status plan_status NOT NULL DEFAULT 'voting',
    confirmed_date TIMESTAMPTZ,
    location_name TEXT,
    address TEXT,
    latitude NUMERIC(9,6) CHECK (latitude BETWEEN -90 AND 90),
    longitude NUMERIC(9,6) CHECK (longitude BETWEEN -180 AND 180),
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK ((type = 'flexible') OR confirmed_date IS NOT NULL),
    CHECK ((latitude IS NULL AND longitude IS NULL) OR (latitude IS NOT NULL AND longitude IS NOT NULL))
);

CREATE TABLE plan_date_options (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id UUID NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    CHECK (end_time > start_time)
);

CREATE TABLE plan_date_votes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    option_id UUID NOT NULL REFERENCES plan_date_options(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    guest_name TEXT,
    guest_session_id UUID,
    vote availability_vote NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (
        (user_id IS NOT NULL AND guest_name IS NULL AND guest_session_id IS NULL)
        OR
        (user_id IS NULL AND guest_name IS NOT NULL AND guest_session_id IS NOT NULL)
    )
);

CREATE UNIQUE INDEX plan_date_votes_registered_unique
    ON plan_date_votes(option_id, user_id)
    WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX plan_date_votes_guest_unique
    ON plan_date_votes(option_id, guest_session_id)
    WHERE guest_session_id IS NOT NULL;

CREATE TABLE tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id UUID NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
    title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 160),
    assigned_to_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    assigned_to_guest_name TEXT,
    assigned_to_guest_session_id UUID,
    status task_status NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (NOT (assigned_to_user_id IS NOT NULL AND assigned_to_guest_name IS NOT NULL)),
    CHECK ((assigned_to_guest_name IS NULL) = (assigned_to_guest_session_id IS NULL))
);

CREATE TABLE plan_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
    category TEXT NOT NULL CHECK (char_length(category) BETWEEN 1 AND 80),
    default_tasks JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (jsonb_typeof(default_tasks) = 'array')
);

CREATE TABLE access_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    purpose token_purpose NOT NULL,
    token_hash BYTEA NOT NULL UNIQUE,
    plan_id UUID REFERENCES plans(id) ON DELETE CASCADE,
    group_id UUID REFERENCES groups(id) ON DELETE CASCADE,
    guest_session_id UUID,
    expires_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (
        (purpose = 'plan_access' AND plan_id IS NOT NULL AND group_id IS NULL)
        OR (purpose = 'group_join' AND group_id IS NOT NULL AND plan_id IS NULL)
        OR (purpose = 'guest_session' AND guest_session_id IS NOT NULL)
    )
);

CREATE INDEX group_members_user_id_idx ON group_members(user_id);
CREATE INDEX plans_group_id_idx ON plans(group_id);
CREATE INDEX plans_created_by_idx ON plans(created_by);
CREATE INDEX plan_date_options_plan_id_idx ON plan_date_options(plan_id);
CREATE INDEX tasks_plan_id_idx ON tasks(plan_id);
CREATE INDEX access_tokens_plan_id_idx ON access_tokens(plan_id) WHERE plan_id IS NOT NULL;
CREATE INDEX access_tokens_group_id_idx ON access_tokens(group_id) WHERE group_id IS NOT NULL;

INSERT INTO plan_templates (name, category, default_tasks) VALUES
('Barbacoa', 'Barbacoa', '["Comprar carbón", "Comprar carne", "Comprar hielo", "Comprar bebidas"]'::jsonb),
('Camping', 'Camping', '["Revisar tiendas", "Preparar sacos", "Comprar comida", "Llevar linternas"]'::jsonb),
('Pádel', 'Pádel', '["Reservar pista", "Llevar pelotas", "Confirmar parejas", "Preparar agua"]'::jsonb);
