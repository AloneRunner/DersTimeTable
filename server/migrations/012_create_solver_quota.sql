BEGIN;

-- Sunucu cozucusu icin kisi basina kalici sayac (server/solve_quota.py).
-- key: 'user:<id>' ya da 'device:<cihaz kimligi>'. Saatlik/gunluk pencere
-- bellekte tutulur; burada yalnizca kalici olmasi gerekenler var:
--   total        : toplam sunucu denemesi (ilk N deneme sinirsiz)
--   bonus        : yoneticinin verdigi ek hak; kota doluyken birer birer harcanir
--   requested_at : kullanici "limitimi artirin" dugmesine bastiysa zamani
CREATE TABLE IF NOT EXISTS solver_quota (
  key           TEXT PRIMARY KEY,
  user_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  total         INTEGER NOT NULL DEFAULT 0,
  bonus         INTEGER NOT NULL DEFAULT 0,
  requested_at  TIMESTAMPTZ,
  last_solve_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Gecmis denemeler sayilsin: baslangic hakkini zaten kullanmis olanlar
-- (ornegin 450+ deneme yapan hesap) sifirdan 100 hak daha almasin.
INSERT INTO solver_quota (key, user_id, total, last_solve_at)
SELECT 'user:' || user_id, user_id, COUNT(*), MAX(created_at)
FROM usage_events
WHERE event = 'solve' AND user_id IS NOT NULL
GROUP BY user_id
ON CONFLICT (key) DO NOTHING;

INSERT INTO solver_quota (key, total, last_solve_at)
SELECT 'device:' || device_id, COUNT(*), MAX(created_at)
FROM usage_events
WHERE event = 'solve'
GROUP BY device_id
HAVING bool_and(user_id IS NULL)
ON CONFLICT (key) DO NOTHING;

COMMIT;
