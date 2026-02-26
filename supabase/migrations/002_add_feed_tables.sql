-- ============================================================
-- МистикУм — персональная лента
-- ============================================================

-- Сгенерированные посты для каждого пользователя
CREATE TABLE IF NOT EXISTS mystic_feed (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_id TEXT        NOT NULL,
  slot        TEXT        NOT NULL CHECK (slot IN ('morning', 'afternoon', 'evening')),
  feed_date   DATE        NOT NULL DEFAULT CURRENT_DATE,
  title       TEXT        NOT NULL,
  content     TEXT        NOT NULL,
  category    TEXT        NOT NULL DEFAULT 'ritual',
  tags        TEXT[]      DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (telegram_id, slot, feed_date)
);

-- Реакции пользователей (лайк / дизлайк)
CREATE TABLE IF NOT EXISTS mystic_feed_reactions (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_id TEXT        NOT NULL,
  feed_id     UUID        NOT NULL REFERENCES mystic_feed(id) ON DELETE CASCADE,
  reaction    TEXT        NOT NULL CHECK (reaction IN ('like', 'dislike')),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (telegram_id, feed_id)
);

-- Индексы
CREATE INDEX IF NOT EXISTS idx_mystic_feed_user_date
  ON mystic_feed (telegram_id, feed_date DESC);

CREATE INDEX IF NOT EXISTS idx_mystic_feed_reactions_user
  ON mystic_feed_reactions (telegram_id);

-- RLS
ALTER TABLE mystic_feed          ENABLE ROW LEVEL SECURITY;
ALTER TABLE mystic_feed_reactions ENABLE ROW LEVEL SECURITY;

-- Серверный сервис (service_role) имеет полный доступ
-- Клиенты не обращаются к Supabase напрямую — только через /api/*
