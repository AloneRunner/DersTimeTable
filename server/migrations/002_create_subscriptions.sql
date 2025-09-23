-- Migration: subscriptions and students (basic)
BEGIN;

CREATE TABLE IF NOT EXISTS subscriptions (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  product_id TEXT,
  purchase_token TEXT,
  start_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  trial_expires_at TIMESTAMPTZ,
  status TEXT,
  raw_receipt JSONB,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Optional students and attendance tables (for future online rollcall)
CREATE TABLE IF NOT EXISTS students (
  id SERIAL PRIMARY KEY,
  school_id INTEGER REFERENCES schools(id),
  external_id TEXT,
  name TEXT,
  metadata JSONB
);

CREATE TABLE IF NOT EXISTS attendance (
  id SERIAL PRIMARY KEY,
  student_id INTEGER REFERENCES students(id),
  classroom_id TEXT,
  teacher_id TEXT,
  day TIMESTAMPTZ,
  status TEXT,
  metadata JSONB
);

COMMIT;
