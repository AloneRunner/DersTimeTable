BEGIN;

-- "Ayni gune gelmesin": bu dersle ayni sinifta ayni gune yerlesmeyecek ders anahtarlari.
ALTER TABLE school_subjects
  ADD COLUMN IF NOT EXISTS not_same_day_keys TEXT[] NOT NULL DEFAULT '{}';

COMMIT;
