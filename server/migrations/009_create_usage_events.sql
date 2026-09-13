BEGIN;

-- Anonim kullanim sayimi. IP, okul/ogretmen verisi, isim veya e-posta tutulmaz.
-- user_id yalniz oturum acik bir istekte doldurulur; cihazin gecmis anonim
-- olaylari da o kullaniciya baglanir (hesaba donusum takibi icin).
CREATE TABLE IF NOT EXISTS usage_events (
  id BIGSERIAL PRIMARY KEY,
  device_id TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  event TEXT NOT NULL,
  platform TEXT,
  app_version TEXT,
  detail JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS usage_events_created_at_idx
  ON usage_events (created_at);

CREATE INDEX IF NOT EXISTS usage_events_device_event_idx
  ON usage_events (device_id, event, created_at);

CREATE INDEX IF NOT EXISTS usage_events_user_idx
  ON usage_events (user_id)
  WHERE user_id IS NOT NULL;

COMMIT;
