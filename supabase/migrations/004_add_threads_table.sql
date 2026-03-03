-- ============================================================
-- Нити Судьбы (Soul Threads)
--
-- Анонимные кармические связи между пользователями.
-- Система: один пользователь «тянет нить» к другому →
-- другой получает сигнал в боте (анонимно).
-- Каждый пользователь может иметь до 5 активных нитей.
-- Нить живёт 7 дней, затем исчезает (эфемерность).
-- ============================================================

-- Таблица нитей
CREATE TABLE IF NOT EXISTS mystic_threads (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_id       BIGINT NOT NULL,        -- кто посылает сигнал
  to_id         BIGINT NOT NULL,        -- кто получает
  from_alias    TEXT   NOT NULL,        -- псевдоним отправителя (снапшот)
  to_alias      TEXT   NOT NULL,        -- псевдоним получателя (снапшот)
  from_sign     TEXT,                   -- знак отправителя
  to_sign       TEXT,                   -- знак получателя
  compatibility INT    NOT NULL DEFAULT 0, -- 0-100: уровень совместимости
  signal        TEXT,                   -- короткое анонимное послание (до 100 символов, необязательно)
  is_mutual     BOOLEAN DEFAULT false,  -- стал ли взаимным (to_id тоже потянул нить)
  expires_at    TIMESTAMPTZ NOT NULL,   -- когда нить исчезает
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- Один пользователь → один уникальный получатель (можно обновить сигнал)
CREATE UNIQUE INDEX IF NOT EXISTS mystic_threads_pair_idx
  ON mystic_threads (from_id, to_id);

-- Для быстрой выборки нитей пользователя
CREATE INDEX IF NOT EXISTS mystic_threads_from_idx ON mystic_threads (from_id, expires_at);
CREATE INDEX IF NOT EXISTS mystic_threads_to_idx   ON mystic_threads (to_id,   expires_at);

-- RLS: запрещаем прямой anon-доступ
ALTER TABLE mystic_threads ENABLE ROW LEVEL SECURITY;
CREATE POLICY deny_anon_threads ON mystic_threads FOR ALL TO anon USING (false);

-- ── Совместимость знаков ──────────────────────────────────
-- Стихии: огонь (Овен, Лев, Стрелец), земля (Телец, Дева, Козерог),
--         воздух (Близнецы, Весы, Водолей), вода (Рак, Скорпион, Рыбы)
-- Комментарий для справки разработчика — сама логика в api/threads.js
