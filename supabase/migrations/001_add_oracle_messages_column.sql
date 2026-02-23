-- ============================================================
-- Миграция: добавить колонку oracle_messages в mystic_users
--
-- Цель: дать прямой доступ к переписке с Персональным Оракулом
-- через Supabase Dashboard (Table Editor / SQL Editor)
-- для модерации, отладки и мониторинга ошибок.
--
-- Безопасно запускать повторно (идемпотентно).
-- Запускать в Supabase Dashboard → SQL Editor.
-- ============================================================

-- 1. Добавить колонку oracle_messages (JSONB массив сообщений)
ALTER TABLE mystic_users
  ADD COLUMN IF NOT EXISTS oracle_messages JSONB DEFAULT '[]';

-- 2. Создать/обновить триггерную функцию sync_user_fields()
--    Автоматически извлекает ключевые поля из data JSONB
--    при каждом INSERT/UPDATE на mystic_users.
CREATE OR REPLACE FUNCTION sync_user_fields()
RETURNS TRIGGER AS $$
BEGIN
  -- Синхронизируем oracle_messages из data JSONB в выделенную колонку
  IF NEW.data ? 'oracle_messages' THEN
    NEW.oracle_messages := NEW.data -> 'oracle_messages';
  END IF;

  -- Синхронизируем другие полезные поля (если колонки существуют)
  -- luck_points
  BEGIN
    IF NEW.data ? 'luck_points' THEN
      NEW.luck_points := (NEW.data ->> 'luck_points')::INTEGER;
    END IF;
  EXCEPTION WHEN undefined_column THEN NULL;
  END;

  -- subscription_tier
  BEGIN
    IF NEW.data ? 'subscription_tier' THEN
      NEW.subscription_tier := NEW.data ->> 'subscription_tier';
    END IF;
  EXCEPTION WHEN undefined_column THEN NULL;
  END;

  -- subscription_until
  BEGIN
    IF NEW.data ? 'subscription_until' THEN
      NEW.subscription_until := NEW.data ->> 'subscription_until';
    END IF;
  EXCEPTION WHEN undefined_column THEN NULL;
  END;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3. Привязать триггер (удалить старый если был, создать заново)
DROP TRIGGER IF EXISTS trg_sync_user_fields ON mystic_users;

CREATE TRIGGER trg_sync_user_fields
  BEFORE INSERT OR UPDATE ON mystic_users
  FOR EACH ROW
  EXECUTE FUNCTION sync_user_fields();

-- 4. Бэкфилл: заполнить oracle_messages из существующих data
UPDATE mystic_users
SET oracle_messages = data -> 'oracle_messages'
WHERE data ? 'oracle_messages'
  AND (oracle_messages IS NULL OR oracle_messages = '[]'::JSONB);

-- 5. Комментарий для документации
COMMENT ON COLUMN mystic_users.oracle_messages IS
  'Переписка с Персональным Оракулом (автосинхронизация из data JSONB). Массив объектов: [{role, text, ts}, ...]';
