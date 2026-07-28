CREATE TABLE login_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash BYTEA NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT login_tokens_expiry_after_creation CHECK (expires_at > created_at)
);

CREATE INDEX login_tokens_user_id_created_at_idx
    ON login_tokens(user_id, created_at DESC);

CREATE INDEX login_tokens_active_expiry_idx
    ON login_tokens(expires_at)
    WHERE used_at IS NULL;

CREATE TABLE sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash BYTEA NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT sessions_expiry_after_creation CHECK (expires_at > created_at)
);

CREATE INDEX sessions_user_id_created_at_idx
    ON sessions(user_id, created_at DESC);

CREATE INDEX sessions_active_expiry_idx
    ON sessions(expires_at)
    WHERE revoked_at IS NULL;
