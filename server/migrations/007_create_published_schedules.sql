BEGIN;

CREATE TABLE IF NOT EXISTS published_schedules (
  school_id INTEGER PRIMARY KEY REFERENCES schools(id) ON DELETE CASCADE,
  schedule JSONB NOT NULL,
  data JSONB NOT NULL,
  substitution_assignments JSONB NOT NULL DEFAULT '[]'::jsonb,
  published_by JSONB,
  published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMIT;
