// GET /api/admin/stats — статистика пользователей для админ-панели
// Возвращает агрегированные данные без персональной информации (только счётчики)
import { getSupabase } from "../_supabase.js";
import { resolveUserId } from "../_auth.js";
import { isAdminId, setCorsHeaders, setSecurityHeaders, rateLimit } from "../_security.js";

// "Онлайн сейчас" = был активен в последние 5 минут
const ONLINE_MS = 5 * 60 * 1000;

export default async function handler(req, res) {
  setCorsHeaders(res, "GET, OPTIONS");
  setSecurityHeaders(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  // Авторизация — только по Telegram ID из ADMIN_TELEGRAM_IDS (env)
  const { ok, id } = resolveUserId(req, req.query?.admin_id || null);
  if (!ok || !isAdminId(id)) {
    return res.status(403).json({ error: "Доступ запрещён" });
  }

  // Rate limit: 20 запросов в минуту — достаточно для ручного использования
  if (!rateLimit(`admin_stats_${id}`, 20, 60_000)) {
    return res.status(429).json({ error: "Слишком много запросов" });
  }

  try {
    const db = getSupabase();

    // Загружаем данные всех пользователей (агрегируем на сервере)
    const { data: rows, error } = await db
      .from("mystic_users")
      .select("telegram_id, data, updated_at");

    if (error) throw error;

    const now = Date.now();

    const stats = {
      total:   0,
      online:  0,
      free:    0,
      vip:     0,
      premium: 0,
      online_free:    0,
      online_vip:     0,
      online_premium: 0,
    };

    for (const row of rows || []) {
      if (!row.telegram_id) continue;

      const d = row.data || {};
      stats.total++;

      // Определяем реальный тариф с учётом истечения подписки
      const tier = d.subscription_tier || "free";
      const until = d.subscription_until ? new Date(d.subscription_until).getTime() : 0;
      const tierKey =
        tier === "premium" && until > now ? "premium" :
        tier === "vip"     && until > now ? "vip"     : "free";

      stats[tierKey]++;

      // Онлайн: updated_at (обновляется при каждом открытии) или last_login как fallback
      const lastActive = row.updated_at
        ? new Date(row.updated_at).getTime()
        : (d.last_login ? new Date(d.last_login).getTime() : 0);
      if (lastActive && now - lastActive < ONLINE_MS) {
        stats.online++;
        stats[`online_${tierKey}`]++;
      }
    }

    return res.status(200).json(stats);
  } catch (e) {
    console.error("[/api/admin/stats]", e.message);
    return res.status(500).json({ error: "Внутренняя ошибка сервера" });
  }
}
