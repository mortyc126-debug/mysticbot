// ============================================================
// VERCEL SERVERLESS — Мистическое сообщество
//
// Объединяет три эндпоинта (лимит Vercel Hobby: 12 функций).
// Маршрутизация через query-параметр _s (задаётся rewrite в vercel.json):
//
//   _s=posts   → /api/posts   (лента, создание, реакции)
//   _s=threads → /api/threads (нити судьбы)
//   _s=ritual  → /api/ritual  (ритуал дня)
// ============================================================

import { getSupabase }   from "./_supabase.js";
import { resolveUserId } from "./_auth.js";
import { setCorsHeaders, setSecurityHeaders, rateLimit } from "./_security.js";

// ── Общие утилиты ────────────────────────────────────────────
function simpleHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
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
  return `${icon} ${role} ${sunSign || "Неизвестный"} #${num}`;
}

function getActiveTier(d) {
  const tier  = d?.subscription_tier;
  const until = d?.subscription_until ? new Date(d.subscription_until) : null;
  if ((tier === "premium" || tier === "vip") && until && until > new Date()) return tier;
  return "free";
}

// ── Очки удачи ───────────────────────────────────────────────
async function awardLuckPoints(db, telegramId, points) {
  try {
    const { data } = await db
      .from("mystic_users")
      .select("data")
      .eq("telegram_id", telegramId)
      .maybeSingle();
    if (!data?.data) return;
    const current = data.data.luck_points ?? 0;
    await db
      .from("mystic_users")
      .update({
        data: { ...data.data, luck_points: current + points },
        updated_at: new Date().toISOString(),
      })
      .eq("telegram_id", telegramId);
  } catch (e) {
    console.warn("[awardLuckPoints]", e.message);
  }
}

// ── POSTS ────────────────────────────────────────────────────
const PAGE_SIZE = 30;
const MAX_TEXT  = 500;
const MIN_TEXT  = 10;
const VALID_TYPES     = new Set(["prophecy", "ritual", "reflection", "confession"]);
const VALID_REACTIONS = new Set(["energy", "verified", "disputed"]);

const CIRCLE_SIGNS = {
  fire:  ["Овен", "Лев", "Стрелец"],
  earth: ["Телец", "Дева", "Козерог"],
  air:   ["Близнецы", "Весы", "Водолей"],
  water: ["Рак", "Скорпион", "Рыбы"],
};

async function handleGetComments(req, res) {
  const { ok } = resolveUserId(req, req.query?.viewer_id || null);
  if (!ok) return res.status(401).json({ error: "Не авторизован" });

  const postId = req.query.post_id;
  if (!postId) return res.status(400).json({ error: "post_id обязателен" });

  const db = getSupabase();
  try {
    const { data: comments, error } = await db
      .from("mystic_post_comments")
      .select("id, alias, text, created_at")
      .eq("post_id", postId)
      .order("created_at", { ascending: true })
      .limit(50);
    if (error) throw error;
    return res.status(200).json({ comments: comments || [] });
  } catch (e) {
    console.error("[community/comments GET]", e.message);
    return res.status(500).json({ error: "Ошибка загрузки комментариев" });
  }
}

async function handlePostComment(req, res) {
  const { ok, id } = resolveUserId(req, req.body?.telegram_id || null);
  if (!ok) return res.status(401).json({ error: "Не авторизован" });

  if (!rateLimit(`comment_${id}`, 30, 60 * 60_000)) {
    return res.status(429).json({ error: "Слишком много комментариев — подожди" });
  }

  const { post_id, text } = req.body || {};
  if (!post_id) return res.status(400).json({ error: "post_id обязателен" });

  const trimmed = typeof text === "string" ? text.trim() : "";
  if (trimmed.length < 1 || trimmed.length > 300) {
    return res.status(400).json({ error: "Комментарий: от 1 до 300 символов" });
  }

  const db = getSupabase();
  try {
    const { data: postData } = await db
      .from("mystic_posts")
      .select("telegram_id, comments_count")
      .eq("id", post_id)
      .maybeSingle();
    if (!postData) return res.status(404).json({ error: "Пост не найден" });

    const { data: userData } = await db
      .from("mystic_users")
      .select("data")
      .eq("telegram_id", id)
      .maybeSingle();
    const d = userData?.data || {};
    const alias = buildAlias(id, d.sun_sign || null, getActiveTier(d));

    const { data: comment, error } = await db
      .from("mystic_post_comments")
      .insert({ post_id, telegram_id: id, alias, text: trimmed })
      .select("id, alias, text, created_at")
      .single();
    if (error) throw error;

    // Increment comments_count
    await db
      .from("mystic_posts")
      .update({ comments_count: (postData.comments_count || 0) + 1 })
      .eq("id", post_id);

    // Award 3 luck points to post author (not to self)
    if (String(postData.telegram_id) !== String(id)) {
      await awardLuckPoints(db, postData.telegram_id, 3);
    }

    return res.status(201).json({ comment, new_count: (postData.comments_count || 0) + 1 });
  } catch (e) {
    console.error("[community/comments POST]", e.message);
    return res.status(500).json({ error: "Не удалось добавить комментарий" });
  }
}

async function handleGetPosts(req, res) {
  // Route comments sub-action
  if (req.query.comments === "1") return handleGetComments(req, res);

  const { ok, id } = resolveUserId(req, req.query?.viewer_id || null);
  if (!ok) return res.status(401).json({ error: "Не авторизован" });

  const type   = req.query.type   || "all";
  const circle = req.query.circle || null;
  const page   = Math.max(0, parseInt(req.query.page, 10) || 0);
  const from   = page * PAGE_SIZE;
  const to     = from + PAGE_SIZE - 1;

  const db = getSupabase();

  try {
    let query = db
      .from("mystic_posts")
      .select("id, type, text, alias, tier, sun_sign, energy_count, verified_count, disputed_count, comments_count, verify_deadline, created_at")
      .order("created_at", { ascending: false })
      .range(from, to);

    if (type !== "all" && VALID_TYPES.has(type)) query = query.eq("type", type);
    if (circle && CIRCLE_SIGNS[circle]) query = query.in("sun_sign", CIRCLE_SIGNS[circle]);

    const { data: posts, error } = await query;
    if (error) throw error;

    const postIds = (posts || []).map(p => p.id);
    let myReactions = {};
    if (postIds.length > 0) {
      const { data: rxns } = await db
        .from("mystic_post_reactions")
        .select("post_id, reaction")
        .eq("telegram_id", id)
        .in("post_id", postIds);
      for (const r of rxns || []) myReactions[r.post_id] = r.reaction;
    }

    const result = (posts || []).map(p => ({ ...p, my_reaction: myReactions[p.id] || null }));
    return res.status(200).json({ posts: result, page, has_more: result.length === PAGE_SIZE });
  } catch (e) {
    console.error("[community/posts GET]", e.message);
    return res.status(500).json({ error: "Ошибка загрузки ленты" });
  }
}

async function handlePostPosts(req, res) {
  // Route comment sub-action
  if (req.body?.action === "comment") return handlePostComment(req, res);

  const { ok, id } = resolveUserId(req, req.body?.telegram_id || null);
  if (!ok) return res.status(401).json({ error: "Не авторизован" });

  if (!rateLimit(`post_create_${id}`, 5, 24 * 60 * 60_000)) {
    return res.status(429).json({ error: "Лимит: максимум 5 постов в день" });
  }

  const { type, text } = req.body || {};
  if (!type || !VALID_TYPES.has(type)) return res.status(400).json({ error: "Неверный тип поста" });

  const trimmed = typeof text === "string" ? text.trim() : "";
  if (trimmed.length < MIN_TEXT || trimmed.length > MAX_TEXT) {
    return res.status(400).json({ error: `Текст: от ${MIN_TEXT} до ${MAX_TEXT} символов` });
  }

  const db = getSupabase();

  try {
    const { data: userData } = await db.from("mystic_users").select("data").eq("telegram_id", id).maybeSingle();
    const d = userData?.data || {};
    const tier = getActiveTier(d);
    const sunSign = d.sun_sign || null;
    const alias   = buildAlias(id, sunSign, tier);
    const verifyDeadline = type === "prophecy"
      ? new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString()
      : null;

    const { data: post, error } = await db
      .from("mystic_posts")
      .insert({ telegram_id: id, type, text: trimmed, alias, tier, sun_sign: sunSign, verify_deadline: verifyDeadline })
      .select("id, type, text, alias, tier, sun_sign, energy_count, verified_count, disputed_count, comments_count, verify_deadline, created_at")
      .single();

    if (error) throw error;
    return res.status(201).json({ post: { ...post, my_reaction: null } });
  } catch (e) {
    console.error("[community/posts POST]", e.message);
    return res.status(500).json({ error: "Не удалось опубликовать" });
  }
}

async function handlePatchPosts(req, res) {
  const { ok, id } = resolveUserId(req, req.body?.telegram_id || null);
  if (!ok) return res.status(401).json({ error: "Не авторизован" });

  if (!rateLimit(`post_react_${id}`, 120, 60 * 60_000)) {
    return res.status(429).json({ error: "Слишком много реакций" });
  }

  const { post_id, reaction } = req.body || {};
  if (!post_id || !reaction || !VALID_REACTIONS.has(reaction)) {
    return res.status(400).json({ error: "Неверные параметры реакции" });
  }

  const db = getSupabase();

  try {
    const { data: post } = await db
      .from("mystic_posts")
      .select("id, type, telegram_id, energy_count, verified_count, disputed_count")
      .eq("id", post_id)
      .maybeSingle();

    if (!post) return res.status(404).json({ error: "Пост не найден" });
    if (post.telegram_id === id) return res.status(403).json({ error: "Нельзя реагировать на свой пост" });

    if ((reaction === "verified" || reaction === "disputed") && post.type !== "prophecy") {
      return res.status(400).json({ error: "Верификация — только для пророчеств" });
    }

    const { data: existing } = await db
      .from("mystic_post_reactions")
      .select("id, reaction")
      .eq("post_id", post_id)
      .eq("telegram_id", id)
      .maybeSingle();

    if (existing) {
      await db.from("mystic_post_reactions").delete().eq("id", existing.id);
      const dec = { [`${existing.reaction}_count`]: Math.max(0, post[`${existing.reaction}_count`] - 1) };
      await db.from("mystic_posts").update(dec).eq("id", post_id);
      return res.status(200).json({ ok: true, toggled: "off", reaction: existing.reaction });
    }

    await db.from("mystic_post_reactions").insert({ post_id, telegram_id: id, reaction });
    const inc = { [`${reaction}_count`]: post[`${reaction}_count`] + 1 };
    await db.from("mystic_posts").update(inc).eq("id", post_id);

    // Award 1 luck point to post author for "energy" reaction
    if (reaction === "energy") {
      await awardLuckPoints(db, post.telegram_id, 1);
    }

    return res.status(200).json({ ok: true, toggled: "on", reaction });
  } catch (e) {
    console.error("[community/posts PATCH]", e.message);
    return res.status(500).json({ error: "Ошибка реакции" });
  }
}

// ── THREADS ──────────────────────────────────────────────────
const THREAD_TTL_DAYS = 7;
const MAX_THREADS     = 5;

const ELEMENTS = {
  "Овен": "fire", "Лев": "fire", "Стрелец": "fire",
  "Телец": "earth", "Дева": "earth", "Козерог": "earth",
  "Близнецы": "air", "Весы": "air", "Водолей": "air",
  "Рак": "water", "Скорпион": "water", "Рыбы": "water",
};

const ELEMENT_COMPAT = {
  fire:  { fire: 70, earth: 45, air: 90, water: 50 },
  earth: { fire: 45, earth: 75, air: 55, water: 85 },
  air:   { fire: 90, air: 70,   earth: 55, water: 60 },
  water: { fire: 50, earth: 85, air: 60, water: 80 },
};

const SIGN_BONUS = {
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
  if (signA === signB) score += 5;
  return Math.min(99, Math.max(1, score));
}

async function handleGetThreads(req, res) {
  const { ok, id } = resolveUserId(req, req.query?.viewer_id || null);
  if (!ok) return res.status(401).json({ error: "Не авторизован" });

  const db  = getSupabase();
  const now = new Date().toISOString();

  if (req.query.discover === "1") {
    try {
      const { data: me } = await db.from("mystic_users").select("data").eq("telegram_id", id).maybeSingle();
      const mySign = me?.data?.sun_sign || null;

      const { data: candidates } = await db
        .from("mystic_users")
        .select("telegram_id, data")
        .neq("telegram_id", id)
        .order("updated_at", { ascending: false })
        .limit(50);

      const { data: existing } = await db
        .from("mystic_threads")
        .select("to_id")
        .eq("from_id", id)
        .gt("expires_at", now);

      const alreadyLinked = new Set((existing || []).map(t => String(t.to_id)));

      const scored = (candidates || [])
        .filter(c => !alreadyLinked.has(String(c.telegram_id)))
        .map(c => {
          const d = c.data || {};
          const sign  = d.sun_sign || null;
          const tier  = getActiveTier(d);
          const alias = buildAlias(c.telegram_id, sign, tier);
          return { telegram_id: c.telegram_id, alias, sign, tier, compatibility: computeCompatibility(mySign, sign) };
        })
        .sort((a, b) => b.compatibility - a.compatibility)
        .slice(0, 5);

      return res.status(200).json({ souls: scored });
    } catch (e) {
      console.error("[community/threads GET discover]", e.message);
      return res.status(500).json({ error: "Ошибка поиска душ" });
    }
  }

  try {
    const [{ data: outgoing }, { data: incoming }] = await Promise.all([
      db.from("mystic_threads")
        .select("id, to_id, to_alias, to_sign, compatibility, signal, is_mutual, expires_at, created_at")
        .eq("from_id", id).gt("expires_at", now).order("compatibility", { ascending: false }),
      db.from("mystic_threads")
        .select("id, from_id, from_alias, from_sign, compatibility, is_mutual, expires_at, created_at")
        .eq("to_id", id).gt("expires_at", now).order("compatibility", { ascending: false }),
    ]);
    return res.status(200).json({ outgoing: outgoing || [], incoming: incoming || [] });
  } catch (e) {
    console.error("[community/threads GET]", e.message);
    return res.status(500).json({ error: "Ошибка загрузки нитей" });
  }
}

async function handlePostThreads(req, res) {
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
    const { count } = await db
      .from("mystic_threads")
      .select("id", { count: "exact", head: true })
      .eq("from_id", id)
      .gt("expires_at", now.toISOString());

    if ((count || 0) >= MAX_THREADS) {
      return res.status(400).json({ error: `Максимум ${MAX_THREADS} активных нитей` });
    }

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
    const expires   = new Date(now.getTime() + THREAD_TTL_DAYS * 24 * 60 * 60_000);
    const trimSignal = typeof signal === "string" ? signal.trim().slice(0, 100) : null;

    const { data: reverseThread } = await db
      .from("mystic_threads")
      .select("id")
      .eq("from_id", to_id)
      .eq("to_id", id)
      .gt("expires_at", now.toISOString())
      .maybeSingle();

    const isMutual = !!reverseThread;

    const { data: thread, error } = await db
      .from("mystic_threads")
      .upsert({
        from_id: Number(id), to_id: Number(to_id),
        from_alias: fromAlias, to_alias: toAlias,
        from_sign: fromSign, to_sign: toSign,
        compatibility: compat, signal: trimSignal,
        is_mutual: isMutual, expires_at: expires.toISOString(),
      }, { onConflict: "from_id,to_id" })
      .select()
      .single();

    if (error) throw error;

    if (isMutual) {
      await db.from("mystic_threads").update({ is_mutual: true }).eq("from_id", to_id).eq("to_id", id);
    }

    return res.status(201).json({ thread, is_mutual: isMutual, compatibility: compat });
  } catch (e) {
    console.error("[community/threads POST]", e.message);
    return res.status(500).json({ error: "Не удалось протянуть нить" });
  }
}

async function handleDeleteThreads(req, res) {
  const { ok, id } = resolveUserId(req, req.query?.viewer_id || null);
  if (!ok) return res.status(401).json({ error: "Не авторизован" });

  const to_id = req.query.to_id;
  if (!to_id) return res.status(400).json({ error: "to_id обязателен" });

  const db = getSupabase();

  try {
    await db.from("mystic_threads").delete().eq("from_id", id).eq("to_id", to_id);
    await db.from("mystic_threads").update({ is_mutual: false }).eq("from_id", to_id).eq("to_id", id);
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("[community/threads DELETE]", e.message);
    return res.status(500).json({ error: "Ошибка удаления нити" });
  }
}

// ── RITUAL ───────────────────────────────────────────────────
const SIGN_ELEMENTS = {
  "Овен": "fire", "Лев": "fire", "Стрелец": "fire",
  "Телец": "earth", "Дева": "earth", "Козерог": "earth",
  "Близнецы": "air", "Весы": "air", "Водолей": "air",
  "Рак": "water", "Скорпион": "water", "Рыбы": "water",
};

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

async function handleGetRitual(req, res) {
  const { ok, id } = resolveUserId(req, req.query?.viewer_id || null);
  if (!ok) return res.status(401).json({ error: "Не авторизован" });

  const ritualId = req.query.date || todayKey();
  const db       = getSupabase();

  try {
    const { count: totalCount } = await db
      .from("mystic_ritual_participants")
      .select("id", { count: "exact", head: true })
      .eq("ritual_id", ritualId);

    const { data: myRecord } = await db
      .from("mystic_ritual_participants")
      .select("id")
      .eq("ritual_id", ritualId)
      .eq("telegram_id", id)
      .maybeSingle();

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
    console.error("[community/ritual GET]", e.message);
    return res.status(500).json({ error: "Ошибка загрузки ритуала" });
  }
}

async function handlePostRitual(req, res) {
  const { ok, id } = resolveUserId(req, req.body?.telegram_id || null);
  if (!ok) return res.status(401).json({ error: "Не авторизован" });

  if (!rateLimit(`ritual_join_${id}`, 2, 24 * 60 * 60_000)) {
    return res.status(429).json({ error: "Уже участвовал сегодня" });
  }

  const ritualId = req.body?.ritual_id || todayKey();
  const db       = getSupabase();

  try {
    const { data: userData } = await db.from("mystic_users").select("data").eq("telegram_id", id).maybeSingle();
    const sunSign = userData?.data?.sun_sign || null;
    const element = sunSign ? (SIGN_ELEMENTS[sunSign] || null) : null;

    await db
      .from("mystic_ritual_participants")
      .upsert(
        { ritual_id: ritualId, telegram_id: Number(id), element },
        { onConflict: "ritual_id,telegram_id" }
      );

    const { count } = await db
      .from("mystic_ritual_participants")
      .select("id", { count: "exact", head: true })
      .eq("ritual_id", ritualId);

    return res.status(200).json({ ok: true, total_count: count || 0 });
  } catch (e) {
    console.error("[community/ritual POST]", e.message);
    return res.status(500).json({ error: "Не удалось присоединиться к ритуалу" });
  }
}

// ── Главный роутер ───────────────────────────────────────────
export default async function handler(req, res) {
  setCorsHeaders(res, "GET, POST, PATCH, DELETE, OPTIONS");
  setSecurityHeaders(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  const section = req.query._s;

  if (section === "posts") {
    if (req.method === "GET")   return handleGetPosts(req, res);
    if (req.method === "POST")  return handlePostPosts(req, res);
    if (req.method === "PATCH") return handlePatchPosts(req, res);
  }

  if (section === "threads") {
    if (req.method === "GET")    return handleGetThreads(req, res);
    if (req.method === "POST")   return handlePostThreads(req, res);
    if (req.method === "DELETE") return handleDeleteThreads(req, res);
  }

  if (section === "ritual") {
    if (req.method === "GET")  return handleGetRitual(req, res);
    if (req.method === "POST") return handlePostRitual(req, res);
  }

  return res.status(405).json({ error: "Method not allowed" });
}
