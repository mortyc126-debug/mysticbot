// ============================================================
// /api/feed — персональная мистическая лента
//
// GET  /api/feed?id=...         — получить ленту пользователя (7 дней)
// GET  /api/feed?cron=morning   — крон-генерация (защищена CRON_SECRET)
// GET  /api/feed?cron=afternoon
// GET  /api/feed?cron=evening
// POST /api/feed                — реакция { feed_id, reaction: "like"|"dislike" }
// ============================================================
import Anthropic from "@anthropic-ai/sdk";
import { getSupabase }   from "./_supabase.js";
import { resolveUserId } from "./_auth.js";
import { setCorsHeaders, setSecurityHeaders, rateLimit } from "./_security.js";

// ── Константы генерации ───────────────────────────────────
const USERS_PER_RUN = 50;
const SLOT_LABEL    = { morning: "утро", afternoon: "день", evening: "вечер" };
const CATEGORIES    = {
  morning:   ["ritual", "intention", "rune_wisdom", "astrology"],
  afternoon: ["myth", "tarot_deep", "love_magic",   "slavic"],
  evening:   ["reflection", "dream_magic", "ritual", "tarot_deep"],
};
const CATEGORY_DESC = {
  ritual:      "практический ритуал или обряд, который можно выполнить сегодня",
  intention:   "намерение или аффирмацию на день с мистическим объяснением",
  rune_wisdom: "послание одной руны и как применить её мудрость прямо сейчас",
  astrology:   "астрологический инсайт на сегодня (планеты, аспекты, возможности)",
  myth:        "короткую историю или миф (славянский, кельтский или греческий) с жизненным смыслом",
  tarot_deep:  "глубокое толкование одной карты Таро применительно к жизни пользователя",
  love_magic:  "совет или практику в сфере любви, отношений и притяжения",
  slavic:      "историю или мудрость из славянской мифологии (Лада, Велес, Морана и др.)",
  reflection:  "вечернее размышление — вопрос для медитации перед сном",
  dream_magic: "технику работы со снами или толкование символов",
};

// ── Вспомогательные функции генерации ────────────────────
const buildUserProfile = (userData, likedTags, dislikedTags) => {
  const parts = [];
  if (userData.sun_sign)        parts.push(`Знак Солнца: ${userData.sun_sign}`);
  if (userData.moon_sign)       parts.push(`Знак Луны: ${userData.moon_sign}`);
  if (userData.ascendant)       parts.push(`Асцендент: ${userData.ascendant}`);
  if (userData.birth_date)      parts.push(`Дата рождения: ${userData.birth_date}`);
  const focus = (userData.life_focus || []).join(", ");
  if (focus)                    parts.push(`Жизненные приоритеты: ${focus}`);
  if (userData.soul_archetype)  parts.push(`Архетип: ${userData.soul_archetype}`);
  if (userData.life_compass)    parts.push(`Жизненный компас: ${userData.life_compass}`);
  if (userData.element)         parts.push(`Стихия: ${userData.element}`);
  if (userData.mystic_path)     parts.push(`Мистический путь: ${userData.mystic_path}`);
  if (userData.night_theme)     parts.push(`Ночная тема: ${userData.night_theme}`);
  if (userData.feed_focus)      parts.push(`Запрос пользователя: ${userData.feed_focus}`);
  if (userData.feed_tone)       parts.push(`Тон контента: ${userData.feed_tone}`);
  if (likedTags.length)         parts.push(`Контент который нравится: ${likedTags.join(", ")}`);
  if (dislikedTags.length)      parts.push(`Контент который не нравится: ${dislikedTags.join(", ")}`);
  const cards = (userData.recent_tarot_cards || []).slice(0, 5);
  if (cards.length)             parts.push(`Последние карты таро: ${cards.join(", ")}`);
  if (userData.custom_quiz_answers) {
    const answers = Object.values(userData.custom_quiz_answers).filter(Boolean).slice(0, 3);
    if (answers.length) parts.push(`Личные ответы пользователя: ${answers.join("; ")}`);
  }
  return parts.join("\n");
};

const pickCategory = (slot, likedTags, dislikedTags) => {
  const pool = CATEGORIES[slot] || CATEGORIES.morning;
  const liked = pool.filter(c => likedTags.includes(c));
  if (liked.length > 0) return liked[Math.floor(Math.random() * liked.length)];
  const notDisliked = pool.filter(c => !dislikedTags.includes(c));
  const src = notDisliked.length > 0 ? notDisliked : pool;
  return src[Math.floor(Math.random() * src.length)];
};

const generateContent = async (client, slot, userProfile, category) => {
  const catDesc   = CATEGORY_DESC[category] || "мистический текст";
  const timeLabel = SLOT_LABEL[slot];
  const moonPhase = ["🌑","🌒","🌓","🌔","🌕","🌖","🌗","🌘"][
    Math.floor((Date.now() / (29.5 * 24 * 3600000)) % 8)
  ];
  const systemPrompt = `Ты — мудрый мистический наставник, который создаёт персональный контент для духовной ленты пользователя.
Пиши исключительно на русском языке. Без markdown, без звёздочек, без решёток.
Стиль: тёплый, поддерживающий, немного таинственный. Не менторский. Как письмо от мудрого друга.
Длина текста: 200-320 слов. Заголовок: 5-9 слов, интригующий и личный.
Отвечай ТОЛЬКО в формате JSON: { "title": "...", "content": "..." }`;
  const userPrompt = `Профиль пользователя:\n${userProfile}\n\nВремя: ${timeLabel} (${moonPhase} лунная фаза)\nСоздай: ${catDesc}\n\nТекст должен ощущаться написанным именно для этого человека, опираясь на его профиль. Если пользователь ищет поддержки — дай её тепло. Если ищет знания — дай глубину.`;
  const message = await client.messages.create({
    model: "claude-haiku-4-5-20251001", max_tokens: 600,
    messages: [{ role: "user", content: userPrompt }], system: systemPrompt,
  });
  const raw   = message.content?.[0]?.text || "";
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`Не удалось извлечь JSON: ${raw.slice(0, 100)}`);
  return JSON.parse(match[0]);
};

const getUserReactionTags = async (db, telegramId) => {
  const { data } = await db
    .from("mystic_feed_reactions")
    .select("reaction, mystic_feed(tags, category)")
    .eq("telegram_id", telegramId)
    .order("created_at", { ascending: false })
    .limit(30);
  const liked = [], disliked = [];
  (data || []).forEach(r => {
    const tags = r.mystic_feed?.tags || [];
    const cat  = r.mystic_feed?.category;
    const target = r.reaction === "like" ? liked : disliked;
    if (cat) target.push(cat);
    tags.forEach(t => target.push(t));
  });
  return { likedTags: [...new Set(liked)].slice(0, 10), dislikedTags: [...new Set(disliked)].slice(0, 10) };
};

// ── Крон-генерация ────────────────────────────────────────
const runCronGeneration = async (slot, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(503).json({ error: "ANTHROPIC_API_KEY не задан" });

  const client = new Anthropic({ apiKey });
  const db     = getSupabase();
  const today  = new Date().toISOString().slice(0, 10);

  const { data: existingPosts } = await db
    .from("mystic_feed").select("telegram_id").eq("slot", slot).eq("feed_date", today);
  const alreadyGenerated = new Set((existingPosts || []).map(p => p.telegram_id));

  const { data: users, error: usersError } = await db
    .from("mystic_users").select("telegram_id, data")
    .order("updated_at", { ascending: false })
    .limit(USERS_PER_RUN + alreadyGenerated.size);

  if (usersError) return res.status(500).json({ error: "Ошибка БД" });

  const pending = (users || []).filter(u => !alreadyGenerated.has(u.telegram_id)).slice(0, USERS_PER_RUN);
  if (pending.length === 0) return res.status(200).json({ ok: true, generated: 0, slot, message: "Все посты уже созданы" });

  let generated = 0, errors = 0;
  for (const user of pending) {
    try {
      const userData = user.data || {};
      const { likedTags, dislikedTags } = await getUserReactionTags(db, user.telegram_id);
      const category    = pickCategory(slot, likedTags, dislikedTags);
      const userProfile = buildUserProfile(userData, likedTags, dislikedTags);
      const result      = await generateContent(client, slot, userProfile, category);
      if (!result.title || !result.content) throw new Error("Пустой ответ от Claude");
      await db.from("mystic_feed").upsert(
        { telegram_id: user.telegram_id, slot, feed_date: today, title: result.title,
          content: result.content, category, tags: [category, ...(likedTags.slice(0, 2))],
          created_at: new Date().toISOString() },
        { onConflict: "telegram_id,slot,feed_date" }
      );
      generated++;
      console.log(`[cron-feed] ✓ ${user.telegram_id} | ${slot} | ${category}`);
      await new Promise(r => setTimeout(r, 300));
    } catch (e) {
      errors++;
      console.error(`[cron-feed] ✗ ${user.telegram_id}:`, e.message);
    }
  }
  return res.status(200).json({ ok: true, slot, generated, errors, total: pending.length });
};

// ── Основной хэндлер ──────────────────────────────────────
export default async function handler(req, res) {
  setSecurityHeaders(res);
  setCorsHeaders(res, "GET, POST, OPTIONS");

  if (req.method === "OPTIONS") return res.status(204).end();

  // ── Крон-маршрут: GET /api/feed?cron=morning|afternoon|evening ──
  if (req.method === "GET" && req.query.cron) {
    const authHeader = req.headers.authorization || "";
    const cronSecret = process.env.CRON_SECRET || "";
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const slot = req.query.cron;
    if (!["morning", "afternoon", "evening"].includes(slot)) {
      return res.status(400).json({ error: "Неверный slot" });
    }
    return runCronGeneration(slot, res);
  }

  // ── Пользовательские маршруты — требуют авторизации ──────
  const { ok, id } = resolveUserId(req, req.body?.telegram_id ?? req.query?.id ?? null);
  if (!ok) return res.status(401).json({ error: "Не авторизован" });

  const db = getSupabase();

  // ── GET: вернуть ленту (с ленивой генерацией при пустом фиде) ───────────
  if (req.method === "GET") {
    const since = new Date();
    since.setDate(since.getDate() - 7);
    const { data: posts, error } = await db
      .from("mystic_feed")
      .select("id, slot, feed_date, title, content, category, tags, created_at")
      .eq("telegram_id", id)
      .gte("feed_date", since.toISOString().slice(0, 10))
      .order("feed_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(30);
    if (error) { console.error("[feed GET]", error.message); return res.status(500).json({ error: "Ошибка загрузки ленты" }); }

    // ── Ленивая генерация: если лента пуста — создаём один пост прямо сейчас ──
    let lazyPost = null;
    if ((!posts || posts.length === 0) && process.env.ANTHROPIC_API_KEY) {
      // Rate-limit: не чаще одного раза в час на пользователя
      if (rateLimit(`feed_lazy_${id}`, 1, 3600_000)) {
        try {
          const utcH  = new Date().getUTCHours();
          const slot  = utcH < 9 ? "morning" : utcH < 15 ? "afternoon" : "evening";
          const today = new Date().toISOString().slice(0, 10);

          // Загружаем профиль пользователя
          const { data: userRow } = await db
            .from("mystic_users").select("data").eq("telegram_id", id).maybeSingle();
          const userData = userRow?.data || {};

          const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
          const { likedTags, dislikedTags } = await getUserReactionTags(db, id);
          const category    = pickCategory(slot, likedTags, dislikedTags);
          const userProfile = buildUserProfile(userData, likedTags, dislikedTags);
          const result      = await generateContent(client, slot, userProfile, category);

          if (result.title && result.content) {
            const { data: saved } = await db.from("mystic_feed")
              .upsert(
                { telegram_id: id, slot, feed_date: today, title: result.title,
                  content: result.content, category, tags: [category],
                  created_at: new Date().toISOString() },
                { onConflict: "telegram_id,slot,feed_date" }
              )
              .select("id, slot, feed_date, title, content, category, tags, created_at")
              .single();
            if (saved) lazyPost = { ...saved, my_reaction: null };
          }
        } catch (e) {
          console.warn("[feed lazy-gen]", e.message); // не ломаем — вернём пустую ленту
        }
      }
    }

    if (lazyPost) return res.status(200).json({ feed: [lazyPost] });

    const ids = (posts || []).map(p => p.id);
    let reactionsMap = {};
    if (ids.length > 0) {
      const { data: reactions } = await db.from("mystic_feed_reactions")
        .select("feed_id, reaction").eq("telegram_id", id).in("feed_id", ids);
      (reactions || []).forEach(r => { reactionsMap[r.feed_id] = r.reaction; });
    }
    const feed = (posts || []).map(p => ({ ...p, my_reaction: reactionsMap[p.id] || null }));
    return res.status(200).json({ feed });
  }

  // ── POST: реакция ────────────────────────────────────────
  if (req.method === "POST") {
    if (!rateLimit(`feed_react_${id}`, 60, 60_000)) return res.status(429).json({ error: "Слишком много запросов" });
    const { feed_id, reaction } = req.body || {};
    if (!feed_id || !["like", "dislike", "remove"].includes(reaction)) return res.status(400).json({ error: "feed_id и reaction обязательны" });
    const { data: post } = await db.from("mystic_feed").select("id").eq("id", feed_id).eq("telegram_id", id).single();
    if (!post) return res.status(404).json({ error: "Пост не найден" });

    if (reaction === "remove") {
      // Удаляем реакцию (toggle off)
      const { error } = await db.from("mystic_feed_reactions")
        .delete().eq("telegram_id", id).eq("feed_id", feed_id);
      if (error) { console.error("[feed DELETE reaction]", error.message); return res.status(500).json({ error: "Ошибка удаления реакции" }); }
    } else {
      const { error } = await db.from("mystic_feed_reactions")
        .upsert({ telegram_id: id, feed_id, reaction, created_at: new Date().toISOString() }, { onConflict: "telegram_id,feed_id" });
      if (error) { console.error("[feed POST reaction]", error.message); return res.status(500).json({ error: "Ошибка сохранения реакции" }); }
    }
    return res.status(200).json({ ok: true });
  }

  return res.status(405).end();
}
