BEGIN;

-- Google ile giris: hesabin kalici Google kimligi (sub) ve son giris zamani.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS google_sub TEXT;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS users_google_sub_key
  ON users (google_sub)
  WHERE google_sub IS NOT NULL;

COMMIT;
