// ============================================================
// VERCEL SERVERLESS — Мистическое сообщество (публичные посты)
//
// GET  /api/posts?feed=1&type=all&page=0     — лента сообщества
// GET  /api/posts?feed=1&type=prophecy&page=0 — только пророчества
// POST /api/posts                             — создать пост
// PATCH /api/posts                            — реакция на пост
// ============================================================

import { getSupabase }        from "./_supabase.js";
import { resolveUserId }      from "./_auth.js";
import { setCorsHeaders, setSecurityHeaders, rateLimit } from "./_security.js";

const PAGE_SIZE = 30;
const MAX_TEXT  = 500;
const MIN_TEXT  = 10;
const VALID_TYPES    = new Set(["prophecy", "ritual", "reflection", "confession"]);
const VALID_REACTIONS = new Set(["energy", "verified", "disputed"]);

// ── Детерминированный хэш для номера в псевдониме ───────────
function simpleHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

const SIGN_ROLES = {
  "Овен": "Воин", "Телец": "Хранитель", "Близнецы": "Вестник",
  "Рак": "Страж", "Лев": "Властитель", "Дева": "Провидец",
  "Весы": "Судья", "Скорпион": "Тайновед", "Стрелец": "Искатель",
  "Козерог": "Мудрец", "Водолей": "Пророк", "Рыбы": "Сновидец",
};
const TIER_ICONS = { free: "🌙", vip: "⭐", premium: "👑" };

function buildAlias(telegramId, sunSign, tier) {
  const role = SIGN_ROLES[sunSign] || "Странник";
  const num  = String(simpleHash(String(telegramId)) % 9999 + 1).padStart(4, "0");
  const icon = TIER_ICONS[tier] || "🌙";
  const sign = sunSign || "Неизвестный";
  return `${icon} ${role} ${sign} #${num}`;
}

// ── GET: лента постов ────────────────────────────────────────
async function handleGet(req, res) {
  const { ok, id } = resolveUserId(req, req.query?.viewer_id || null);
  if (!ok) return res.status(401).json({ error: "Не авторизован" });

  const type = req.query.type || "all";
  const page = Math.max(0, parseInt(req.query.page, 10) || 0);
  const from = page * PAGE_SIZE;
  const to   = from + PAGE_SIZE - 1;

  const db = getSupabase();

  try {
    let query = db
      .from("mystic_posts")
      .select("id, type, text, alias, tier, sun_sign, energy_count, verified_count, disputed_count, verify_deadline, created_at")
      .order("created_at", { ascending: false })
      .range(from, to);

    if (type !== "all" && VALID_TYPES.has(type)) {
      query = query.eq("type", type);
    }

    const { data: posts, error } = await query;
    if (error) throw error;

    // Достаём реакции текущего пользователя (одним запросом)
    const postIds = (posts || []).map(p => p.id);
    let myReactions = {};
    if (postIds.length > 0) {
      const { data: rxns } = await db
        .from("mystic_post_reactions")
        .select("post_id, reaction")
        .eq("telegram_id", id)
        .in("post_id", postIds);
      for (const r of rxns || []) {
        myReactions[r.post_id] = r.reaction;
      }
    }

    const result = (posts || []).map(p => ({
      ...p,
      my_reaction: myReactions[p.id] || null,
      // telegram_id намеренно НЕ возвращается — анонимность
    }));

    return res.status(200).json({ posts: result, page, has_more: result.length === PAGE_SIZE });
  } catch (e) {
    console.error("[/api/posts GET]", e.message);
    return res.status(500).json({ error: "Ошибка загрузки ленты" });
  }
}

// ── POST: создать пост ───────────────────────────────────────
async function handlePost(req, res) {
  const { ok, id } = resolveUserId(req, req.body?.telegram_id || null);
  if (!ok) return res.status(401).json({ error: "Не авторизован" });

  // Лимит: 5 постов в 24 часа
  if (!rateLimit(`post_create_${id}`, 5, 24 * 60 * 60_000)) {
    return res.status(429).json({ error: "Лимит: максимум 5 постов в день" });
  }

  const { type, text } = req.body || {};

  if (!type || !VALID_TYPES.has(type)) {
    return res.status(400).json({ error: "Неверный тип поста" });
  }

  const trimmed = typeof text === "string" ? text.trim() : "";
  if (trimmed.length < MIN_TEXT || trimmed.length > MAX_TEXT) {
    return res.status(400).json({ error: `Текст: от ${MIN_TEXT} до ${MAX_TEXT} символов` });
  }

  const db = getSupabase();

  try {
    // Берём данные пользователя для псевдонима
    const { data: userData } = await db
      .from("mystic_users")
      .select("data")
      .eq("telegram_id", id)
      .maybeSingle();

    const d    = userData?.data || {};
    const tier = (d.subscription_tier === "premium" || d.subscription_tier === "vip")
      ? (d.subscription_until && new Date(d.subscription_until) > new Date()
          ? d.subscription_tier : "free")
      : "free";
    const sunSign = d.sun_sign || null;
    const alias   = buildAlias(id, sunSign, tier);

    // Для пророчеств — ставим дедлайн верификации (+30 дней)
    const verifyDeadline = type === "prophecy"
      ? new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString()
      : null;

    const { data: post, error } = await db
      .from("mystic_posts")
      .insert({
        telegram_id:     id,
        type,
        text:            trimmed,
        alias,
        tier,
        sun_sign:        sunSign,
        verify_deadline: verifyDeadline,
      })
      .select("id, type, text, alias, tier, sun_sign, energy_count, verified_count, disputed_count, verify_deadline, created_at")
      .single();

    if (error) throw error;
    return res.status(201).json({ post: { ...post, my_reaction: null } });
  } catch (e) {
    console.error("[/api/posts POST]", e.message);
    return res.status(500).json({ error: "Не удалось опубликовать" });
  }
}

// ── PATCH: реакция на пост ───────────────────────────────────
async function handlePatch(req, res) {
  const { ok, id } = resolveUserId(req, req.body?.telegram_id || null);
  if (!ok) return res.status(401).json({ error: "Не авторизован" });

  // Лимит: 120 реакций в час (защита от спама)
  if (!rateLimit(`post_react_${id}`, 120, 60 * 60_000)) {
    return res.status(429).json({ error: "Слишком много реакций" });
  }

  const { post_id, reaction } = req.body || {};
  if (!post_id || !reaction || !VALID_REACTIONS.has(reaction)) {
    return res.status(400).json({ error: "Неверные параметры реакции" });
  }

  const db = getSupabase();

  try {
    // Проверяем что пост существует и не принадлежит самому пользователю
    const { data: post } = await db
      .from("mystic_posts")
      .select("id, type, telegram_id, energy_count, verified_count, disputed_count")
      .eq("id", post_id)
      .maybeSingle();

    if (!post) return res.status(404).json({ error: "Пост не найден" });
    if (post.telegram_id === id) return res.status(403).json({ error: "Нельзя реагировать на свой пост" });

    // verified/disputed только для пророчеств
    if ((reaction === "verified" || reaction === "disputed") && post.type !== "prophecy") {
      return res.status(400).json({ error: "Верификация — только для пророчеств" });
    }

    // Проверяем: уже реагировал?
    const { data: existing } = await db
      .from("mystic_post_reactions")
      .select("id, reaction")
      .eq("post_id", post_id)
      .eq("telegram_id", id)
      .maybeSingle();

    if (existing) {
      // Убираем реакцию (toggling off)
      await db.from("mystic_post_reactions").delete().eq("id", existing.id);
      // Декрементируем счётчик
      const dec = { [`${existing.reaction}_count`]: Math.max(0, post[`${existing.reaction}_count`] - 1) };
      await db.from("mystic_posts").update(dec).eq("id", post_id);
      return res.status(200).json({ ok: true, toggled: "off", reaction: existing.reaction });
    }

    // Новая реакция
    await db.from("mystic_post_reactions").insert({ post_id, telegram_id: id, reaction });
    const inc = { [`${reaction}_count`]: post[`${reaction}_count`] + 1 };
    await db.from("mystic_posts").update(inc).eq("id", post_id);

    return res.status(200).json({ ok: true, toggled: "on", reaction });
  } catch (e) {
    console.error("[/api/posts PATCH]", e.message);
    return res.status(500).json({ error: "Ошибка реакции" });
  }
}

// ── Роутинг ─────────────────────────────────────────────────
export default async function handler(req, res) {
  setCorsHeaders(res, "GET, POST, PATCH, OPTIONS");
  setSecurityHeaders(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method === "GET")   return handleGet(req, res);
  if (req.method === "POST")  return handlePost(req, res);
  if (req.method === "PATCH") return handlePatch(req, res);

  return res.status(405).json({ error: "Method not allowed" });
}
