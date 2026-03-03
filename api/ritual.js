// ============================================================
// VERCEL SERVERLESS — Ритуал дня
//
// GET  /api/ritual              — текущий ритуал + кол-во участников
// GET  /api/ritual?stats=1      — разбивка участников по стихиям
// POST /api/ritual              — принять участие в ритуале
// ============================================================

import { getSupabase }   from "./_supabase.js";
import { resolveUserId } from "./_auth.js";
import { setCorsHeaders, setSecurityHeaders, rateLimit } from "./_security.js";

// ── Ключ дня ─────────────────────────────────────────────────
function todayKey() {
  return new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
}

// ── Элемент пользователя (по знаку) ─────────────────────────
const SIGN_ELEMENTS = {
  "Овен": "fire", "Лев": "fire", "Стрелец": "fire",
  "Телец": "earth", "Дева": "earth", "Козерог": "earth",
  "Близнецы": "air", "Весы": "air", "Водолей": "air",
  "Рак": "water", "Скорпион": "water", "Рыбы": "water",
};

// ── GET ──────────────────────────────────────────────────────
async function handleGet(req, res) {
  const { ok, id } = resolveUserId(req, req.query?.viewer_id || null);
  if (!ok) return res.status(401).json({ error: "Не авторизован" });

  const ritualId = req.query.date || todayKey();
  const db       = getSupabase();

  try {
    // Общее число участников
    const { count: totalCount } = await db
      .from("mystic_ritual_participants")
      .select("id", { count: "exact", head: true })
      .eq("ritual_id", ritualId);

    // Участвовал ли текущий пользователь
    const { data: myRecord } = await db
      .from("mystic_ritual_participants")
      .select("id")
      .eq("ritual_id", ritualId)
      .eq("telegram_id", id)
      .maybeSingle();

    // Разбивка по стихиям (если запрошена)
    let elementStats = null;
    if (req.query.stats === "1") {
      const { data: rows } = await db
        .from("mystic_ritual_participants")
        .select("element")
        .eq("ritual_id", ritualId)
        .not("element", "is", null);

      elementStats = { fire: 0, earth: 0, air: 0, water: 0 };
      for (const r of rows || []) {
        if (elementStats[r.element] !== undefined) elementStats[r.element]++;
      }
    }

    return res.status(200).json({
      ritual_id:     ritualId,
      total_count:   totalCount || 0,
      participated:  !!myRecord,
      element_stats: elementStats,
    });
  } catch (e) {
    console.error("[/api/ritual GET]", e.message);
    return res.status(500).json({ error: "Ошибка загрузки ритуала" });
  }
}

// ── POST ─────────────────────────────────────────────────────
async function handlePost(req, res) {
  const { ok, id } = resolveUserId(req, req.body?.telegram_id || null);
  if (!ok) return res.status(401).json({ error: "Не авторизован" });

  if (!rateLimit(`ritual_join_${id}`, 2, 24 * 60 * 60_000)) {
    return res.status(429).json({ error: "Уже участвовал сегодня" });
  }

  const ritualId = req.body?.ritual_id || todayKey();
  const db       = getSupabase();

  try {
    // Берём знак пользователя для определения элемента
    const { data: userData } = await db
      .from("mystic_users")
      .select("data")
      .eq("telegram_id", id)
      .maybeSingle();

    const sunSign = userData?.data?.sun_sign || null;
    const element = sunSign ? (SIGN_ELEMENTS[sunSign] || null) : null;

    // Upsert — идемпотентно
    await db
      .from("mystic_ritual_participants")
      .upsert(
        { ritual_id: ritualId, telegram_id: Number(id), element },
        { onConflict: "ritual_id,telegram_id" }
      );

    // Возвращаем обновлённый счётчик
    const { count } = await db
      .from("mystic_ritual_participants")
      .select("id", { count: "exact", head: true })
      .eq("ritual_id", ritualId);

    return res.status(200).json({ ok: true, total_count: count || 0 });
  } catch (e) {
    console.error("[/api/ritual POST]", e.message);
    return res.status(500).json({ error: "Не удалось присоединиться к ритуалу" });
  }
}

// ── Роутинг ──────────────────────────────────────────────────
export default async function handler(req, res) {
  setCorsHeaders(res, "GET, POST, OPTIONS");
  setSecurityHeaders(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method === "GET")  return handleGet(req, res);
  if (req.method === "POST") return handlePost(req, res);

  return res.status(405).json({ error: "Method not allowed" });
}
