BEGIN;

-- Destek icin: kisinin SON denemesinin ayarlari ve sonucu (sure, art arda sinir,
-- tercihler, cozucu durumu, tesihs etiketi, sinif/ogretmen SAYISI). Okul verisi
-- yazilmaz. Kullanicinin ayarlari yalniz kendi tarayicisinda durdugu icin, veriyi
-- indirsek bile hangi ayarla denedigini goremiyorduk.
ALTER TABLE solver_quota
  ADD COLUMN IF NOT EXISTS last_attempt JSONB;

COMMIT;
