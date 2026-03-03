-- ============================================================
-- Migration 007 — Анонимный чат Нитей Судьбы
-- ============================================================

CREATE TABLE IF NOT EXISTS mystic_chat_messages (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_key     TEXT        NOT NULL,  -- LEAST(id_a,id_b) || '_' || GREATEST(id_a,id_b)
  sender_id    TEXT        NOT NULL,
  sender_alias TEXT        NOT NULL,
  text         TEXT        NOT NULL CHECK (char_length(text) BETWEEN 1 AND 500),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Быстрая выборка истории чата по ключу пары
CREATE INDEX IF NOT EXISTS idx_chat_messages_key
  ON mystic_chat_messages (chat_key, created_at ASC);

-- Индекс для поиска всех чатов пользователя
CREATE INDEX IF NOT EXISTS idx_chat_messages_sender
  ON mystic_chat_messages (sender_id, created_at DESC);

ALTER TABLE mystic_chat_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "deny anon mystic_chat_messages"
  ON mystic_chat_messages FOR ALL TO anon USING (false);
