-- Ortak havuz sayaci 5 Ekim 2026'da kuruldu, ama fatura donemi 15 Eylul'de
-- basliyor. Sayac sifirdan baslayinca uygulamada "bu ay %0 kullanildi" yaziyor
-- ve donemin basindan beri harcanmis sure gorunmuyordu.
--
-- Donem icinde harcanan sure zaten solver_quota.seconds_used icinde kayitli
-- (20 Eylul'de baslatildi, yani bu donemin icinde). Yalniz 'user:' satirlari
-- toplanir: ayni saniye hesap, cihaz ve parmak izi satirlarina birden
-- yazildigi icin hepsini toplamak uc kat sayardi. Hesapsiz kullanimin payi
-- disarida kalir; tahminin eksik tarafta kalmasi fazla saymasindan iyidir.
--
-- Tek seferlik: migration tablosu ayni dosyayi tekrar calistirmaz.
INSERT INTO solver_pool (month, seconds)
SELECT
  CASE
    WHEN EXTRACT(DAY FROM now()) >= 15
      THEN (date_trunc('month', now()) + INTERVAL '14 days')::date
    ELSE (date_trunc('month', now()) - INTERVAL '1 month' + INTERVAL '14 days')::date
  END,
  COALESCE((SELECT SUM(seconds_used) FROM solver_quota WHERE key LIKE 'user:%'), 0)
ON CONFLICT (month) DO UPDATE
  -- Kurulustan beri gercekten olculen sure zaten EXCLUDED'in icinde; buyuk olani
  -- birakmak iki kere saymayi onler.
  SET seconds = GREATEST(solver_pool.seconds, EXCLUDED.seconds);
