-- ============================================================
-- SCHEMA + ROW LEVEL SECURITY (RLS) — Supabase
--
-- Запускать в Supabase Dashboard → SQL Editor.
-- Безопасно применять повторно: все операции идемпотентны (IF NOT EXISTS).
--
-- Архитектура доступа:
--   Бэкенд (Vercel Functions) → Supabase с SUPABASE_SERVICE_ROLE_KEY
--   Фронтенд → НЕ обращается к Supabase напрямую, только через API
--
-- service_role key обходит RLS автоматически.
-- RLS служит "вторым рубежом защиты": если anon key утечёт —
-- прямой доступ к данным через него всё равно будет заблокирован.
-- ============================================================

-- ── Таблица пользователей ────────────────────────────────────
CREATE TABLE IF NOT EXISTS mystic_users (
  telegram_id     TEXT PRIMARY KEY,
  data            JSONB NOT NULL DEFAULT '{}',
  oracle_messages JSONB DEFAULT '[]',   -- переписка с Персональным Оракулом (автосинхронизация из data)
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── Таблица дневника ─────────────────────────────────────────
-- entry: JSONB — принимает и зашифрованную строку (ENC:...) и сырой объект (миграция)
CREATE TABLE IF NOT EXISTS mystic_diary (
  id          BIGSERIAL PRIMARY KEY,
  telegram_id TEXT NOT NULL,
  entry       JSONB,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── Таблица истории таро ─────────────────────────────────────
-- reading: JSONB — сырой объект расклада (без шифрования)
CREATE TABLE IF NOT EXISTS mystic_tarot (
  id          BIGSERIAL PRIMARY KEY,
  telegram_id TEXT NOT NULL,
  reading     JSONB,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── Включить RLS на всех таблицах ───────────────────────────
ALTER TABLE mystic_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE mystic_diary ENABLE ROW LEVEL SECURITY;
ALTER TABLE mystic_tarot ENABLE ROW LEVEL SECURITY;

-- ── Запретить всё для anon роли ─────────────────────────────
-- Все операции через backend (service_role), не через клиент напрямую.

DROP POLICY IF EXISTS "deny_anon_users"  ON mystic_users;
DROP POLICY IF EXISTS "deny_anon_diary"  ON mystic_diary;
DROP POLICY IF EXISTS "deny_anon_tarot"  ON mystic_tarot;

CREATE POLICY "deny_anon_users"
  ON mystic_users
  FOR ALL
  TO anon
  USING (false);

CREATE POLICY "deny_anon_diary"
  ON mystic_diary
  FOR ALL
  TO anon
  USING (false);

CREATE POLICY "deny_anon_tarot"
  ON mystic_tarot
  FOR ALL
  TO anon
  USING (false);

-- ── Разрешить service_role (backend) полный доступ ──────────
-- service_role автоматически обходит RLS в Supabase,
-- явные политики здесь не нужны — оставляем для документации.

-- ── Триггер: автосинхронизация полей из data JSONB ─────────
-- При INSERT/UPDATE извлекает oracle_messages из data в выделенную колонку
CREATE OR REPLACE FUNCTION sync_user_fields()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.data ? 'oracle_messages' THEN
    NEW.oracle_messages := NEW.data -> 'oracle_messages';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_user_fields ON mystic_users;
CREATE TRIGGER trg_sync_user_fields
  BEFORE INSERT OR UPDATE ON mystic_users
  FOR EACH ROW
  EXECUTE FUNCTION sync_user_fields();

-- ── Индексы для производительности ─────────────────────────
-- Убеждаемся что индексы по telegram_id существуют (если не созданы ранее)

CREATE INDEX IF NOT EXISTS idx_mystic_users_telegram_id  ON mystic_users  (telegram_id);
CREATE INDEX IF NOT EXISTS idx_mystic_diary_telegram_id  ON mystic_diary  (telegram_id);
CREATE INDEX IF NOT EXISTS idx_mystic_tarot_telegram_id  ON mystic_tarot  (telegram_id);

-- Индекс для сортировки дневника/таро по дате
CREATE INDEX IF NOT EXISTS idx_mystic_diary_created_at   ON mystic_diary  (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mystic_tarot_created_at   ON mystic_tarot  (created_at DESC);

-- ── Таблица промокодов (кастомные, созданные администратором) ─
CREATE TABLE IF NOT EXISTS mystic_promos (
  code        TEXT PRIMARY KEY,
  tier        TEXT NOT NULL DEFAULT 'vip',
  duration    INTEGER NOT NULL DEFAULT 30,
  max_uses    INTEGER NOT NULL DEFAULT 1,   -- 0 = неограниченно
  used_count  INTEGER NOT NULL DEFAULT 0,
  created_by  TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  last_used   TIMESTAMPTZ
);

ALTER TABLE mystic_promos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "deny_anon_promos" ON mystic_promos;
CREATE POLICY "deny_anon_promos"
  ON mystic_promos
  FOR ALL
  TO anon
  USING (false);

-- ── Таблица фотографий (хиромантия + аура по фото) ───────────
-- url  — публичная ссылка из Supabase Storage (бакет mystic-photos)
-- type — 'palmistry' | 'aura'
-- reading — первые 2000 символов AI-чтения
--
-- ВАЖНО: бакет mystic-photos должен быть PUBLIC (Storage → Buckets → Edit → Public bucket ✅)
CREATE TABLE IF NOT EXISTS mystic_photos (
  id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  telegram_id BIGINT      NOT NULL,
  type        TEXT        NOT NULL CHECK (type IN ('palmistry', 'aura')),
  url         TEXT        NOT NULL,
  reading     TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE mystic_photos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "deny_anon_photos" ON mystic_photos;
CREATE POLICY "deny_anon_photos"
  ON mystic_photos
  FOR ALL
  TO anon
  USING (false);

-- Индексы для фото
CREATE INDEX IF NOT EXISTS idx_mystic_photos_telegram_id ON mystic_photos (telegram_id, type);
CREATE INDEX IF NOT EXISTS idx_mystic_photos_created_at  ON mystic_photos (created_at DESC);
-- ============================================================
