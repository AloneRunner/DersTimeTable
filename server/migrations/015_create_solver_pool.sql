-- Aylik ORTAK cozucu suresi. Kisi basi butce (solver_quota) kisiyi sinirlar;
-- bu tablo ise butun kullanicilarin o ay sunucuda harcadigi toplam arama
-- suresini tutar. Uygulama bunu "havuzun %X'i kullanildi" diye gosterir:
-- masrafi gelistirici kendi cebinden odedigi icin kullanicinin da ortak
-- siniri gormesi, bos yere deneme yapmasini azaltiyor.
CREATE TABLE IF NOT EXISTS solver_pool (
  month DATE PRIMARY KEY,
  seconds DOUBLE PRECISION NOT NULL DEFAULT 0
);
