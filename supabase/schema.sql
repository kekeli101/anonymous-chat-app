-- Run this in the Supabase SQL Editor (Dashboard → SQL → New query)

CREATE TABLE IF NOT EXISTS rooms (
  room_key TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('public', 'private')),
  name TEXT,
  delete_code TEXT NOT NULL,
  messages JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_activity TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  empty_since TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_rooms_type ON rooms (type);
CREATE INDEX IF NOT EXISTS idx_rooms_last_activity ON rooms (last_activity);

-- Optional: enable RLS and deny public access (server uses service role key)
ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;
