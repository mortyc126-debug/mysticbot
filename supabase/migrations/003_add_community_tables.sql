-- ============================================================
-- Migration 003 — Мистическое сообщество
--
-- Публичные анонимные посты (пророчества, ритуалы, размышления)
-- и реакции на них (передача энергии, верификация пророчеств).
-- ============================================================

-- ── Публичные посты ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mystic_posts (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_id     TEXT        NOT NULL,
  type            TEXT        NOT NULL CHECK (type IN ('prophecy','ritual','reflection','confession')),
  text            TEXT        NOT NULL CHECK (char_length(text) BETWEEN 10 AND 500),
  alias           TEXT        NOT NULL,          -- «⭐ Искатель Стрелец #4821»
  tier            TEXT        NOT NULL DEFAULT 'free' CHECK (tier IN ('free','vip','premium')),
  sun_sign        TEXT,
  energy_count    INTEGER     NOT NULL DEFAULT 0,
  verified_count  INTEGER     NOT NULL DEFAULT 0,
  disputed_count  INTEGER     NOT NULL DEFAULT 0,
  verify_deadline TIMESTAMPTZ,                   -- для пророчеств: +30 дней
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Индексы для быстрой пагинации ленты
CREATE INDEX IF NOT EXISTS idx_mystic_posts_created   ON mystic_posts (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mystic_posts_type      ON mystic_posts (type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mystic_posts_author    ON mystic_posts (telegram_id, created_at DESC);

-- ── Реакции ─────────────────────────────────────────────────
-- reaction:
--   'energy'   — передать энергию (любой пост)
--   'verified' — «пророчество сбылось» (только тип prophecy)
--   'disputed' — «не сбылось»          (только тип prophecy)
CREATE TABLE IF NOT EXISTS mystic_post_reactions (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id     UUID        NOT NULL REFERENCES mystic_posts(id) ON DELETE CASCADE,
  telegram_id TEXT        NOT NULL,
  reaction    TEXT        NOT NULL CHECK (reaction IN ('energy','verified','disputed')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Один пользователь — одна реакция любого типа на один пост
  UNIQUE (post_id, telegram_id)
);

CREATE INDEX IF NOT EXISTS idx_post_reactions_post ON mystic_post_reactions (post_id);
CREATE INDEX IF NOT EXISTS idx_post_reactions_user ON mystic_post_reactions (telegram_id);

-- ── RLS: блокируем анонимный доступ ─────────────────────────
ALTER TABLE mystic_posts          ENABLE ROW LEVEL SECURITY;
ALTER TABLE mystic_post_reactions ENABLE ROW LEVEL SECURITY;

-- Service role имеет полный доступ (бэкенд)
-- Anon role — запрещён явно (deny-by-default)
CREATE POLICY "deny anon mystic_posts"
  ON mystic_posts FOR ALL TO anon USING (false);

CREATE POLICY "deny anon mystic_post_reactions"
  ON mystic_post_reactions FOR ALL TO anon USING (false);
