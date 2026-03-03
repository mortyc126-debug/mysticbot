-- ============================================================
-- Коллективные Ритуалы
--
-- Каждый день — новый ритуал (контент фиксирован во фронтенде,
-- ID ритуала = ключ дня: YYYY-MM-DD).
-- Пользователи нажимают «Провести ритуал» — запись в participants.
-- Счётчик участников виден всем, вдохновляет на участие.
-- ============================================================

-- Таблица участников ритуала
CREATE TABLE IF NOT EXISTS mystic_ritual_participants (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ritual_id   TEXT    NOT NULL,        -- ключ дня: "2026-03-03"
  telegram_id BIGINT  NOT NULL,
  element     TEXT,                    -- стихия участника (для статистики)
  created_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE (ritual_id, telegram_id)      -- один участник — одна запись в день
);

CREATE INDEX IF NOT EXISTS mystic_ritual_ritual_idx
  ON mystic_ritual_participants (ritual_id, created_at);

-- RLS
ALTER TABLE mystic_ritual_participants ENABLE ROW LEVEL SECURITY;
CREATE POLICY deny_anon_ritual ON mystic_ritual_participants FOR ALL TO anon USING (false);
