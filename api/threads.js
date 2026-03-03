// ============================================================
// VERCEL SERVERLESS — Нити Судьбы (Soul Threads)
//
// GET  /api/threads               — мои нити (входящие + исходящие)
// GET  /api/threads?discover=1    — случайные совместимые души для нити
// POST /api/threads               — потянуть нить к пользователю
// DELETE /api/threads?to_id=X     — оборвать нить
// ============================================================

import { getSupabase }        from "./_supabase.js";
import { resolveUserId }      from "./_auth.js";
import { setCorsHeaders, setSecurityHeaders, rateLimit } from "./_security.js";

const THREAD_TTL_DAYS = 7;
const MAX_THREADS     = 5;  // максимум активных нитей

// ── Совместимость знаков ─────────────────────────────────────
const ELEMENTS = {
  "Овен":     "fire",  "Лев":     "fire",  "Стрелец": "fire",
  "Телец":    "earth", "Дева":    "earth", "Козерог": "earth",
  "Близнецы": "air",   "Весы":    "air",   "Водолей": "air",
  "Рак":      "water", "Скорпион":"water", "Рыбы":    "water",
};

// Совместимость стихий (базовая)
const ELEMENT_COMPAT = {
  fire:  { fire: 70, earth: 45, air: 90, water: 50 },
  earth: { fire: 45, earth: 75, air: 55, water: 85 },
  air:   { fire: 90, air: 70,   earth: 55, water: 60 },
  water: { fire: 50, earth: 85, air: 60, water: 80 },
};

// Бонус за один знак
const SIGN_BONUS = {
  // Классические кармические пары (оппозиция — полярное притяжение)
  "Овен-Весы": 15, "Весы-Овен": 15,
  "Телец-Скорпион": 15, "Скорпион-Телец": 15,
  "Близнецы-Стрелец": 15, "Стрелец-Близнецы": 15,
  "Рак-Козерог": 15, "Козерог-Рак": 15,
  "Лев-Водолей": 15, "Водолей-Лев": 15,
  "Дева-Рыбы": 15, "Рыбы-Дева": 15,
};

function computeCompatibility(signA, signB) {
  if (!signA || !signB) return 50;
  const elA = ELEMENTS[signA];
  const elB = ELEMENTS[signB];
  let score = ELEMENT_COMPAT[elA]?.[elB] ?? 55;
  score += (SIGN_BONUS[`${signA}-${signB}`] || 0);
  if (signA === signB) score += 5; // одинаковый знак — слабая связь (зеркало)
  return Math.min(99, Math.max(1, score));
}

// ── Хэш для псевдонима (идентичен alias.js) ─────────────────
const SIGN_ROLES = {
  "Овен": "Воин", "Телец": "Хранитель", "Близнецы": "Вестник",
  "Рак": "Страж", "Лев": "Властитель", "Дева": "Провидец",
  "Весы": "Судья", "Скорпион": "Тайновед", "Стрелец": "Искатель",
  "Козерог": "Мудрец", "Водолей": "Пророк", "Рыбы": "Сновидец",
};
const TIER_ICONS = { free: "🌙", vip: "⭐", premium: "👑" };

function simpleHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}
function buildAlias(telegramId, sunSign, tier) {
  const role = SIGN_ROLES[sunSign] || "Странник";
  const num  = String(simpleHash(String(telegramId)) % 9999 + 1).padStart(4, "0");
  const icon = TIER_ICONS[tier] || "🌙";
  return `${icon} ${role} ${sunSign || "Неизвестный"} #${num}`;
}

function getActiveTier(d) {
  const tier  = d?.subscription_tier;
  const until = d?.subscription_until ? new Date(d.subscription_until) : null;
  if ((tier === "premium" || tier === "vip") && until && until > new Date()) return tier;
  return "free";
}

// ── GET: мои нити ────────────────────────────────────────────
async function handleGet(req, res) {
  const { ok, id } = resolveUserId(req, req.query?.viewer_id || null);
  if (!ok) return res.status(401).json({ error: "Не авторизован" });

  const db  = getSupabase();
  const now = new Date().toISOString();

  if (req.query.discover === "1") {
    // Находим совместимых пользователей с которыми ещё нет нити
    try {
      // Берём подпись текущего пользователя
      const { data: me } = await db
        .from("mystic_users")
        .select("data")
        .eq("telegram_id", id)
        .maybeSingle();

      const myData    = me?.data || {};
      const mySign    = myData.sun_sign || null;
      const myElement = ELEMENTS[mySign];

      // Берём до 50 последних активных пользователей (исключая себя)
      const { data: candidates } = await db
        .from("mystic_users")
        .select("telegram_id, data")
        .neq("telegram_id", id)
        .order("updated_at", { ascending: false })
        .limit(50);

      // Берём уже существующие нити
      const { data: existing } = await db
        .from("mystic_threads")
        .select("to_id")
        .eq("from_id", id)
        .gt("expires_at", now);

      const alreadyLinked = new Set((existing || []).map(t => String(t.to_id)));

      // Вычисляем совместимость и фильтруем
      const scored = (candidates || [])
        .filter(c => !alreadyLinked.has(String(c.telegram_id)))
        .map(c => {
          const d     = c.data || {};
          const sign  = d.sun_sign || null;
          const tier  = getActiveTier(d);
          const alias = buildAlias(c.telegram_id, sign, tier);
          const compat = computeCompatibility(mySign, sign);
          return { telegram_id: c.telegram_id, alias, sign, tier, compatibility: compat };
        })
        .sort((a, b) => b.compatibility - a.compatibility)
        .slice(0, 5); // возвращаем топ-5

      return res.status(200).json({ souls: scored });
    } catch (e) {
      console.error("[/api/threads GET discover]", e.message);
      return res.status(500).json({ error: "Ошибка поиска душ" });
    }
  }

  // Мои нити (исходящие + входящие)
  try {
    const [{ data: outgoing }, { data: incoming }] = await Promise.all([
      db.from("mystic_threads")
        .select("id, to_id, to_alias, to_sign, compatibility, signal, is_mutual, expires_at, created_at")
        .eq("from_id", id)
        .gt("expires_at", now)
        .order("compatibility", { ascending: false }),
      db.from("mystic_threads")
        .select("id, from_id, from_alias, from_sign, compatibility, is_mutual, expires_at, created_at")
        .eq("to_id", id)
        .gt("expires_at", now)
        .order("compatibility", { ascending: false }),
    ]);

    return res.status(200).json({
      outgoing: outgoing || [],
      incoming: incoming || [],
    });
  } catch (e) {
    console.error("[/api/threads GET]", e.message);
    return res.status(500).json({ error: "Ошибка загрузки нитей" });
  }
}

// ── POST: потянуть нить ──────────────────────────────────────
async function handlePost(req, res) {
  const { ok, id } = resolveUserId(req, req.body?.telegram_id || null);
  if (!ok) return res.status(401).json({ error: "Не авторизован" });

  if (!rateLimit(`thread_create_${id}`, 10, 60 * 60_000)) {
    return res.status(429).json({ error: "Слишком много нитей — подожди" });
  }

  const { to_id, signal } = req.body || {};
  if (!to_id) return res.status(400).json({ error: "to_id обязателен" });
  if (String(to_id) === String(id)) return res.status(400).json({ error: "Нельзя тянуть нить к себе" });

  const db  = getSupabase();
  const now = new Date();

  try {
    // Проверяем лимит активных нитей
    const { count } = await db
      .from("mystic_threads")
      .select("id", { count: "exact", head: true })
      .eq("from_id", id)
      .gt("expires_at", now.toISOString());

    if ((count || 0) >= MAX_THREADS) {
      return res.status(400).json({ error: `Максимум ${MAX_THREADS} активных нитей` });
    }

    // Берём данные обоих пользователей
    const [{ data: fromData }, { data: toData }] = await Promise.all([
      db.from("mystic_users").select("data").eq("telegram_id", id).maybeSingle(),
      db.from("mystic_users").select("data, telegram_id").eq("telegram_id", to_id).maybeSingle(),
    ]);

    if (!toData) return res.status(404).json({ error: "Пользователь не найден" });

    const fd = fromData?.data || {};
    const td = toData.data   || {};

    const fromSign  = fd.sun_sign || null;
    const toSign    = td.sun_sign || null;
    const fromAlias = buildAlias(id,    fromSign, getActiveTier(fd));
    const toAlias   = buildAlias(to_id, toSign,   getActiveTier(td));
    const compat    = computeCompatibility(fromSign, toSign);

    const expires = new Date(now.getTime() + THREAD_TTL_DAYS * 24 * 60 * 60_000);

    const trimSignal = typeof signal === "string" ? signal.trim().slice(0, 100) : null;

    // Проверяем взаимность (существует ли нить в обратную сторону?)
    const { data: reverseThread } = await db
      .from("mystic_threads")
      .select("id")
      .eq("from_id", to_id)
      .eq("to_id", id)
      .gt("expires_at", now.toISOString())
      .maybeSingle();

    const isMutual = !!reverseThread;

    // Upsert нити (обновить если уже есть — продлить срок)
    const { data: thread, error } = await db
      .from("mystic_threads")
      .upsert({
        from_id:       Number(id),
        to_id:         Number(to_id),
        from_alias:    fromAlias,
        to_alias:      toAlias,
        from_sign:     fromSign,
        to_sign:       toSign,
        compatibility: compat,
        signal:        trimSignal,
        is_mutual:     isMutual,
        expires_at:    expires.toISOString(),
      }, { onConflict: "from_id,to_id" })
      .select()
      .single();

    if (error) throw error;

    // Если взаимная — помечаем обратную тоже
    if (isMutual) {
      await db.from("mystic_threads")
        .update({ is_mutual: true })
        .eq("from_id", to_id)
        .eq("to_id", id);
    }

    return res.status(201).json({ thread, is_mutual: isMutual, compatibility: compat });
  } catch (e) {
    console.error("[/api/threads POST]", e.message);
    return res.status(500).json({ error: "Не удалось протянуть нить" });
  }
}

// ── DELETE: оборвать нить ────────────────────────────────────
async function handleDelete(req, res) {
  const { ok, id } = resolveUserId(req, req.query?.viewer_id || null);
  if (!ok) return res.status(401).json({ error: "Не авторизован" });

  const to_id = req.query.to_id;
  if (!to_id) return res.status(400).json({ error: "to_id обязателен" });

  const db = getSupabase();

  try {
    await db.from("mystic_threads")
      .delete()
      .eq("from_id", id)
      .eq("to_id", to_id);

    // Если была взаимная — снимаем флаг с обратной
    await db.from("mystic_threads")
      .update({ is_mutual: false })
      .eq("from_id", to_id)
      .eq("to_id", id);

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("[/api/threads DELETE]", e.message);
    return res.status(500).json({ error: "Ошибка удаления нити" });
  }
}

// ── Роутинг ──────────────────────────────────────────────────
export default async function handler(req, res) {
  setCorsHeaders(res, "GET, POST, DELETE, OPTIONS");
  setSecurityHeaders(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method === "GET")    return handleGet(req, res);
  if (req.method === "POST")   return handlePost(req, res);
  if (req.method === "DELETE") return handleDelete(req, res);

  return res.status(405).json({ error: "Method not allowed" });
}
