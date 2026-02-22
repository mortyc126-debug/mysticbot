// POST /api/user  — сохранить/обновить пользователя
// GET  /api/user?id=<telegram_id>  — загрузить пользователя
import { getSupabase } from "./_supabase.js";
import { resolveUserId } from "./_auth.js";
import { encryptField, decryptObject } from "./_crypto.js";
import { setCorsHeaders, setSecurityHeaders, sanitizeUserData, checkBodySize, rateLimit } from "./_security.js";

export default async function handler(req, res) {
  setCorsHeaders(res, "GET, POST, OPTIONS");
  setSecurityHeaders(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const db = getSupabase();

    // GET — загрузить профиль
    if (req.method === "GET") {
      const { id: rawId } = req.query;
      const { ok, id, warn } = resolveUserId(req, rawId);
      if (!ok) return res.status(401).json({ error: warn || "id обязателен" });
      if (warn) console.warn("[/api/user GET]", warn, id);

      const { data, error } = await db
        .from("mystic_users")
        .select("data")
        .eq("telegram_id", id)
        .single();

      if (error && error.code !== "PGRST116") throw error; // PGRST116 = not found

      const rawData = data?.data || null;

      // Создаём копию чтобы не мутировать объект из ответа Supabase
      const userData = rawData ? { ...rawData } : null;

      // Расшифровываем oracle_memory и парсим обратно в объект
      // decryptObject обрабатывает все форматы: объект (legacy), зашифрованная строка, plain JSON-строка
      if (userData?.oracle_memory != null) {
        userData.oracle_memory = decryptObject(userData.oracle_memory);
      }

      return res.status(200).json({ user: userData });
    }

    // POST — создать или обновить
    if (req.method === "POST") {
      // Проверка размера тела
      if (!checkBodySize(req.body, 32_000)) {
        return res.status(413).json({ error: "Слишком большой запрос" });
      }

      const { telegram_id: rawId, ...rawData } = req.body || {};
      const { ok, id, warn } = resolveUserId(req, rawId);
      if (!ok) return res.status(401).json({ error: warn || "telegram_id обязателен" });
      if (warn) console.warn("[/api/user POST]", warn, id);

      // Rate limit: 30 запросов в минуту на пользователя
      if (!rateLimit(`user_post_${id}`, 30, 60_000)) {
        return res.status(429).json({ error: "Слишком много запросов" });
      }

      // Удаляем защищённые поля — клиент не может менять тарифы, рефералы и т.д.
      const userData = sanitizeUserData(rawData);

      // Шифруем oracle_memory перед сохранением (чувствительные данные памяти оракула)
      if (userData.oracle_memory != null) {
        const raw = typeof userData.oracle_memory === "string"
          ? userData.oracle_memory
          : JSON.stringify(userData.oracle_memory);
        userData.oracle_memory = encryptField(raw);
      }

      // Читаем текущие данные чтобы смержить (не перезаписывать) поля
      const { data: existing } = await db
        .from("mystic_users")
        .select("data")
        .eq("telegram_id", id)
        .single();

      const mergedData = { ...(existing?.data || {}), ...userData };

      // Защита от потери очков удачи: клиент не может понизить значение ниже серверного.
      // Race condition: дебаунс luckSyncRef может отправить устаревший локальный баланс
      // уже ПОСЛЕ того как вебхук ЮKassa начислил очки в БД — без этой защиты
      // merge { ...serverData, luck_points: oldLocalValue } тихо затирал платёж.
      const serverLuck = existing?.data?.luck_points;
      if (typeof userData.luck_points === "number" && typeof serverLuck === "number") {
        mergedData.luck_points = Math.max(serverLuck, userData.luck_points);
      }

      const { error } = await db
        .from("mystic_users")
        .upsert(
          { telegram_id: id, data: mergedData, updated_at: new Date().toISOString() },
          { onConflict: "telegram_id" }
        );

      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (e) {
    console.error("[/api/user]", e.message);
    return res.status(500).json({ error: "Внутренняя ошибка сервера" });
  }
}
