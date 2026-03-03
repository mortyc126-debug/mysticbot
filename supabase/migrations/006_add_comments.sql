-- ============================================================
-- Migration 006 — Комментарии к постам сообщества
-- ============================================================

-- Счётчик комментариев на существующей таблице постов
ALTER TABLE mystic_posts
  ADD COLUMN IF NOT EXISTS comments_count INTEGER NOT NULL DEFAULT 0;

-- Таблица комментариев
CREATE TABLE IF NOT EXISTS mystic_post_comments (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id     UUID        NOT NULL REFERENCES mystic_posts(id) ON DELETE CASCADE,
  telegram_id TEXT        NOT NULL,
  alias       TEXT        NOT NULL,
  text        TEXT        NOT NULL CHECK (char_length(text) BETWEEN 1 AND 300),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_post_comments_post ON mystic_post_comments (post_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_post_comments_user ON mystic_post_comments (telegram_id);

ALTER TABLE mystic_post_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "deny anon mystic_post_comments"
  ON mystic_post_comments FOR ALL TO anon USING (false);
