BEGIN;

-- Son gorulme: oturum acikken uygulamanin son acilisi ya da son giris.
-- /api/auth/me ve giris uclarinda en fazla 5 dakikada bir guncellenir.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;

COMMIT;
