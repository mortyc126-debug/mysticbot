// ============================================================
// /api/cron-feed — генерация персональной ленты (Vercel Cron)
//
// Запускается 3 раза в день:
//   06:00 UTC → slot=morning   (09:00 МСК)
//   10:00 UTC → slot=afternoon (13:00 МСК)
//   16:00 UTC → slot=evening   (19:00 МСК)
//
// Env vars: ANTHROPIC_API_KEY, CRON_SECRET
// ============================================================
import Anthropic from "@anthropic-ai/sdk";
import { getSupabase } from "./_supabase.js";

const SLOT_BY_UTC_HOUR = { 6: "morning", 10: "afternoon", 16: "evening" };
const SLOT_LABEL       = { morning: "утро", afternoon: "день", evening: "вечер" };

// Лимит пользователей за один запуск (защита от перерасхода токенов)
const USERS_PER_RUN = 50;

// ── Определяем текущий слот по UTC-часу ──────────────────
const getCurrentSlot = () => {
  const h = req => req; // заглушка — используем Date
  const utcH = new Date().getUTCHours();
  return SLOT_BY_UTC_HOUR[utcH] || "morning";
};

// ── Категории контента ────────────────────────────────────
const CATEGORIES = {
  morning:   ["ritual", "intention", "rune_wisdom", "astrology"],
  afternoon: ["myth", "tarot_deep", "love_magic",   "slavic"],
  evening:   ["reflection", "dream_magic", "ritual", "tarot_deep"],
};

// ── Строим профиль пользователя для промпта ───────────────
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

  // Теги из реакций — что нравится/не нравится
  if (likedTags.length)    parts.push(`Контент который нравится: ${likedTags.join(", ")}`);
  if (dislikedTags.length) parts.push(`Контент который не нравится: ${dislikedTags.join(", ")}`);

  // История таро — топ карты
  const cards = (userData.recent_tarot_cards || []).slice(0, 5);
  if (cards.length)             parts.push(`Последние карты таро: ${cards.join(", ")}`);

  // Пользовательские ответы (свой вариант)
  if (userData.custom_quiz_answers) {
    const answers = Object.values(userData.custom_quiz_answers).filter(Boolean).slice(0, 3);
    if (answers.length) parts.push(`Личные ответы пользователя: ${answers.join("; ")}`);
  }

  return parts.join("\n");
};

// ── Выбрать категорию контента ────────────────────────────
const pickCategory = (slot, likedTags, dislikedTags) => {
  const pool = CATEGORIES[slot] || CATEGORIES.morning;
  // Если есть предпочтения — стараемся выбрать понравившуюся категорию
  const liked = pool.filter(c => likedTags.includes(c));
  if (liked.length > 0) return liked[Math.floor(Math.random() * liked.length)];
  const notDisliked = pool.filter(c => !dislikedTags.includes(c));
  const src = notDisliked.length > 0 ? notDisliked : pool;
  return src[Math.floor(Math.random() * src.length)];
};

// ── Описания категорий для промпта ───────────────────────
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

// ── Генерация контента через Claude Haiku ────────────────
const generateContent = async (client, slot, userProfile, category) => {
  const catDesc  = CATEGORY_DESC[category] || "мистический текст";
  const timeLabel = SLOT_LABEL[slot];
  const moonPhase = ["🌑","🌒","🌓","🌔","🌕","🌖","🌗","🌘"][
    Math.floor((Date.now() / (29.5 * 24 * 3600000)) % 8)
  ];

  const systemPrompt = `Ты — мудрый мистический наставник, который создаёт персональный контент для духовной ленты пользователя.
Пиши исключительно на русском языке. Без markdown, без звёздочек, без решёток.
Стиль: тёплый, поддерживающий, немного таинственный. Не менторский. Как письмо от мудрого друга.
Длина текста: 200-320 слов. Заголовок: 5-9 слов, интригующий и личный.
Отвечай ТОЛЬКО в формате JSON: { "title": "...", "content": "..." }`;

  const userPrompt = `Профиль пользователя:
${userProfile}

Время: ${timeLabel} (${moonPhase} лунная фаза)
Создай: ${catDesc}

Текст должен ощущаться написанным именно для этого человека, опираясь на его профиль.
Если пользователь ищет поддержки — дай её тепло. Если ищет знания — дай глубину.`;

  const message = await client.messages.create({
    model:      "claude-haiku-4-5-20251001",
    max_tokens: 600,
    messages:   [{ role: "user", content: userPrompt }],
    system:     systemPrompt,
  });

  const raw = message.content?.[0]?.text || "";
  // Извлекаем JSON из ответа
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`Не удалось извлечь JSON: ${raw.slice(0, 100)}`);
  return JSON.parse(match[0]);
};

// ── Получить теги из реакций пользователя ────────────────
const getUserReactionTags = async (db, telegramId) => {
  const { data } = await db
    .from("mystic_feed_reactions")
    .select("reaction, mystic_feed(tags, category)")
    .eq("telegram_id", telegramId)
    .order("created_at", { ascending: false })
    .limit(30);

  const liked    = [];
  const disliked = [];
  (data || []).forEach(r => {
    const tags = r.mystic_feed?.tags || [];
    const cat  = r.mystic_feed?.category;
    const target = r.reaction === "like" ? liked : disliked;
    if (cat) target.push(cat);
    tags.forEach(t => target.push(t));
  });

  return {
    likedTags:    [...new Set(liked)].slice(0, 10),
    dislikedTags: [...new Set(disliked)].slice(0, 10),
  };
};

// ── Основной хэндлер ──────────────────────────────────────
export default async function handler(req, res) {
  // Защита: только Vercel Cron или запросы с CRON_SECRET
  const authHeader = req.headers.authorization || "";
  const cronSecret = process.env.CRON_SECRET || "";
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const slot = req.query.slot || getCurrentSlot();
  if (!["morning", "afternoon", "evening"].includes(slot)) {
    return res.status(400).json({ error: "Неверный slot" });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(503).json({ error: "ANTHROPIC_API_KEY не задан" });

  const client = new Anthropic({ apiKey });
  const db     = getSupabase();
  const today  = new Date().toISOString().slice(0, 10);

  // Берём активных пользователей у которых нет поста на этот слот сегодня
  const { data: existingPosts } = await db
    .from("mystic_feed")
    .select("telegram_id")
    .eq("slot", slot)
    .eq("feed_date", today);

  const alreadyGenerated = new Set((existingPosts || []).map(p => p.telegram_id));

  const { data: users, error: usersError } = await db
    .from("mystic_users")
    .select("telegram_id, data")
    .order("updated_at", { ascending: false })
    .limit(USERS_PER_RUN + alreadyGenerated.size);

  if (usersError) {
    console.error("[cron-feed] Ошибка загрузки пользователей:", usersError.message);
    return res.status(500).json({ error: "Ошибка БД" });
  }

  const pending = (users || [])
    .filter(u => !alreadyGenerated.has(u.telegram_id))
    .slice(0, USERS_PER_RUN);

  if (pending.length === 0) {
    return res.status(200).json({ ok: true, generated: 0, slot, message: "Все посты уже созданы" });
  }

  let generated = 0;
  let errors    = 0;

  for (const user of pending) {
    try {
      const userData = user.data || {};
      const { likedTags, dislikedTags } = await getUserReactionTags(db, user.telegram_id);

      const category    = pickCategory(slot, likedTags, dislikedTags);
      const userProfile = buildUserProfile(userData, likedTags, dislikedTags);
      const result      = await generateContent(client, slot, userProfile, category);

      if (!result.title || !result.content) throw new Error("Пустой ответ от Claude");

      await db.from("mystic_feed").upsert(
        {
          telegram_id: user.telegram_id,
          slot,
          feed_date:   today,
          title:       result.title,
          content:     result.content,
          category,
          tags:        [category, ...(likedTags.slice(0, 2))],
          created_at:  new Date().toISOString(),
        },
        { onConflict: "telegram_id,slot,feed_date" }
      );

      generated++;
      console.log(`[cron-feed] ✓ ${user.telegram_id} | ${slot} | ${category}`);

      // Небольшая пауза чтобы не превысить rate limit Claude Haiku
      await new Promise(r => setTimeout(r, 300));
    } catch (e) {
      errors++;
      console.error(`[cron-feed] ✗ ${user.telegram_id}:`, e.message);
    }
  }

  return res.status(200).json({ ok: true, slot, generated, errors, total: pending.length });
}
