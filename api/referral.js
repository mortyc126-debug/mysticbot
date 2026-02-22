// POST /api/referral — зачислить нового пользователя рефералу
// Вызывается когда новый пользователь завершает онбординг после перехода по реферальной ссылке
// Body: { referral_code, new_user_name, telegram_id? }
import { getSupabase } from "./_supabase.js";
import { resolveUserId } from "./_auth.js";
import { setCorsHeaders, setSecurityHeaders, rateLimit, checkBodySize, validateString } from "./_security.js";

export default async function handler(req, res) {
  setCorsHeaders(res, "POST, OPTIONS");
  setSecurityHeaders(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    if (!checkBodySize(req.body, 4_000)) {
      return res.status(413).json({ error: "Слишком большой запрос" });
    }

    const { referral_code, new_user_name, telegram_id: rawId } = req.body || {};
    if (!referral_code) return res.status(400).json({ error: "referral_code обязателен" });

    // Валидация входных данных
    if (!validateString(referral_code, 32) || !validateString(new_user_name, 100)) {
      return res.status(400).json({ error: "Некорректные данные" });
    }

    // Получаем telegram_id нового пользователя (опционально — для дедупликации)
    const { ok, id: newUserId } = resolveUserId(req, rawId);

    // Rate limit по IP: не более 5 реферальных активаций в час
    const ip = req.headers["x-forwarded-for"] || "unknown";
    if (!rateLimit(`referral_${ip}`, 5, 60 * 60_000)) {
      return res.status(429).json({ error: "Слишком много запросов" });
    }

    const db = getSupabase();

    // Ищем владельца реферального кода в Supabase
    const { data: rows, error: findErr } = await db
      .from("mystic_users")
      .select("telegram_id, data")
      .filter("data->>referral_code", "eq", referral_code)
      .limit(1);

    if (findErr) throw findErr;
    if (!rows || rows.length === 0) {
      return res.status(200).json({ ok: false, reason: "code_not_found" });
    }

    const referrer = rows[0];

    // Нельзя пригласить самого себя
    if (ok && newUserId && referrer.telegram_id === newUserId) {
      return res.status(200).json({ ok: false, reason: "self_referral" });
    }

    const existingFriends = referrer.data?.referral_friends || [];

    // Дедупликация: один пользователь не может быть засчитан дважды
    if (ok && newUserId && existingFriends.some(f => f.telegram_id === newUserId)) {
      return res.status(200).json({ ok: true, already: true });
    }

    const newFriend = {
      telegram_id: ok && newUserId ? newUserId : null,
      name: (new_user_name || "Пользователь").slice(0, 50),
      date: new Date().toISOString(),
    };

    const updatedData = {
      ...referrer.data,
      referral_friends: [...existingFriends, newFriend],
    };

    const { error: updateErr } = await db
      .from("mystic_users")
      .update({ data: updatedData, updated_at: new Date().toISOString() })
      .eq("telegram_id", referrer.telegram_id);

    if (updateErr) throw updateErr;

    console.log("[/api/referral] новый реферал зарегистрирован");
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("[/api/referral]", e.message);
    return res.status(500).json({ error: "Внутренняя ошибка сервера" });
  }
}
