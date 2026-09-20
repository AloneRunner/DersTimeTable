BEGIN;

-- Kota deneme SAYISINDAN cozucu SURESINE gecti (server/solve_quota.py).
-- Olculdu (20 Eylul 2026): bir kullanicinin 52 denemesi toplam 1-2 dakika,
-- bir baskasinin TEK denemesi 74 saniye tutuyordu; aylik islemci masrafinin
-- neredeyse tamami tek kisiden geliyordu. Sayiyla kisitlamak ucuz kullaniciyi
-- cezalandirip pahaliyi durdurmuyordu.
--   seconds_used : temel butceden harcanan cozucu saniyesi (ek sureden harcanan yazilmaz)
--   bonus        : ARTIK SANIYE. Eskiden "deneme hakki"ydi; verilmis haklar
--                  1 deneme = 60 sn sayilarak cevrilir ki verilen soz kucultulmesin.
--   name_hashes  : 'school:' satirlarinda ogretmen adlarindan uretilen, geri
--                  dondurulemeyen parmak izi. Ayni veriyi yeni bir hesaba yukleyip
--                  butceyi sifirlamayi onler. Ad saklanmaz.
ALTER TABLE solver_quota
  ADD COLUMN IF NOT EXISTS seconds_used DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS name_hashes TEXT[];

UPDATE solver_quota SET bonus = bonus * 60 WHERE bonus > 0;

-- Eski duzende baslangic hakkini (100 deneme) bitirmis olanlar yeni baslangic
-- butcesini de harcamis sayilir; yoksa en cok harcayan hesap sifirdan butce alirdi.
UPDATE solver_quota SET seconds_used = 1500 WHERE total >= 100;

CREATE INDEX IF NOT EXISTS solver_quota_name_hashes_idx ON solver_quota USING GIN (name_hashes);

COMMIT;
