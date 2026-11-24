CREATE TABLE IF NOT EXISTS users (
  user_id BIGSERIAL PRIMARY KEY,
  full_name VARCHAR(200) NOT NULL,
  email VARCHAR(254) NOT NULL UNIQUE,
  phone_number VARCHAR(32),
  password_hash TEXT NOT NULL,
  is_email_verified BOOLEAN NOT NULL DEFAULT false,
  verification_token_hash TEXT,
  verification_token_expires TIMESTAMPTZ,
  reset_token_hash TEXT,
  reset_token_expires TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Support existing users tables without changing primary keys or removing data.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS phone_number VARCHAR(32),
  ADD COLUMN IF NOT EXISTS is_email_verified BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS verification_token_hash TEXT,
  ADD COLUMN IF NOT EXISTS verification_token_expires TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reset_token_hash TEXT,
  ADD COLUMN IF NOT EXISTS reset_token_expires TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
CREATE UNIQUE INDEX IF NOT EXISTS users_email_normalized_unique ON users (LOWER(email));
CREATE INDEX IF NOT EXISTS users_verification_token_idx ON users (verification_token_hash)
  WHERE verification_token_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS users_reset_token_idx ON users (reset_token_hash)
  WHERE reset_token_hash IS NOT NULL;
