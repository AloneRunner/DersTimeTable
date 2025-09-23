-- Migration: create tenant (school) schema
-- Run this on your Postgres (Railway) to prepare tenant tables

BEGIN;

-- Schools table
CREATE TABLE IF NOT EXISTS schools (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A join table to associate teachers (by teacher id used in the app) with schools
CREATE TABLE IF NOT EXISTS teacher_schools (
  teacher_id TEXT NOT NULL,
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  PRIMARY KEY (teacher_id, school_id)
);

-- Optional: add school_id column to classroom-like tables in a future migration
-- ALTER TABLE classrooms ADD COLUMN IF NOT EXISTS school_id INTEGER REFERENCES schools(id);

COMMIT;
