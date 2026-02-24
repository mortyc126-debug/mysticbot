// ============================================================
// VERCEL SERVERLESS FUNCTION — Push-уведомления через Telegram Bot API
//
// POST /api/notifications  — одиночное уведомление конкретному пользователю
// GET  /api/notifications  — CRON: массовая рассылка всем пользователям
//
// POST Body:
//   type:    "daily_horoscope" | "daily_card" | "streak_warning" |
//            "astro_event"     | "tarot_reminder" | "dream_reminder" |
//            "rune_reminder"   | "moon_event"     | "custom"
//   context: { sign?, streak?, card_name?, event_label?, event_ritual?, phase?, message? }
//
// POST Headers: x-telegram-init-data (обязателен в продакшене)
// GET  Headers: Authorization: Bearer <CRON_SECRET>
//
// Переменные Vercel:
//   TELEGRAM_BOT_TOKEN — токен бота от @BotFather
//   WEBAPP_URL         — URL задеплоенного приложения
//   CRON_SECRET        — секрет для защиты крон-эндпоинта
// ============================================================

import { getSupabase } from "./_supabase.js";
import { setCorsHeaders, setSecurityHeaders, rateLimit, checkBodySize } from "./_security.js";
import { resolveUserId } from "./_auth.js";

// ── Шаблоны для POST (одиночные) ────────────────────────────
const TEMPLATES = {
  daily_horoscope: ({ sign }) => ({
    text: `🔮 ${sign ? `${sign}, сегодня` : "Сегодня"} звёзды говорят особенно отчётливо.\n\nТвой персональный гороскоп ждёт. Что расскажет Оракул? ✨`,
    btn: "🌟 Читать гороскоп",
  }),
  daily_card: ({ card_name }) => ({
    text: `🃏 Карта дня ${card_name ? `— <b>${card_name}</b>` : "открыта"}.\n\nВселенная выбрала её специально для тебя сегодня. Загляни в МистикУм — послание уже ждёт 🔮`,
    btn: "🃏 Узнать послание",
  }),
  streak_warning: ({ streak }) => ({
    text: `🔥 Серия ${streak ? `${streak} дн.` : ""} — не прерывай!\n\nОракул помнит каждый твой визит. Загляни сегодня, чтобы сохранить стрик и получить бонусные 💫`,
    btn: "⚡ Продолжить серию",
  }),
  astro_event: ({ event_label, event_ritual }) => ({
    text: `✨ ${event_label || "Астрологическое событие"} — сегодня!\n\n${event_ritual ? `${event_ritual}.` : "Мощное время для ритуалов и намерений."} Открой МистикУм для персонального прогноза 🌙`,
    btn: "📅 Персональный прогноз",
  }),
  moon_event: ({ event_label, phase }) => ({
    text: `🌕 ${event_label || (phase ? `${phase} луна` : "Особое лунное событие")} сегодня.\n\nЭто мощное время для намерений и отпускания. Загляни в мистический календарь ✨`,
    btn: "🌙 Открыть календарь",
  }),
  tarot_reminder: ({ sign }) => ({
    text: `🎴 Карты${sign ? ` для ${sign}` : ""} готовы раскрыть тайное...\n\nЗадай вопрос — и Таро даст честный ответ. Расклад займёт меньше минуты 🔮`,
    btn: "🎴 Разложить карты",
  }),
  dream_reminder: () => ({
    text: "😴 Что снилось этой ночью?\n\nЗапиши сны пока они свежи — Оракул расшифрует образы и раскроет скрытые послания в твоём дневнике судьбы 📔",
    btn: "📔 Записать сон",
  }),
  rune_reminder: ({ sign }) => ({
    text: `ᚠ Руны${sign ? ` для ${sign}` : ""} говорят сегодня.\n\nБрось руны и узнай, какие силы действуют в твоей жизни прямо сейчас. Ответ — в древних символах 🌿`,
    btn: "ᚠ Бросить руны",
  }),
  custom: ({ message }) => ({
    text: message || "✨ Послание от МистикУма",
    btn: "🔮 Открыть МистикУм",
  }),
};

const DAILY_DEDUP_FIELD = {
  daily_horoscope: "notif_daily_sent",
  daily_card:      "notif_daily_sent",
  streak_warning:  "notif_streak_sent",
  astro_event:     "notif_event_sent",
  moon_event:      "notif_event_sent",
  tarot_reminder:  "notif_daily_sent",
  dream_reminder:  "notif_daily_sent",
  rune_reminder:   "notif_daily_sent",
};

// ── Шаблоны для CRON (ротация по дням — фоллбэк) ────────────
const CRON_ROTATION = [
  (ctx) => ({
    text: `🔮 ${ctx.sign || "Звёзды"}, твой гороскоп на сегодня готов.\n\nОткрой приложение — узнай, что ждёт тебя сегодня.`,
    btn: "🌟 Читать гороскоп",
  }),
  () => ({
    text: `🃏 Карта дня ждёт тебя.\n\nКаждый день — новое послание. Открой свою карту и получи +1 💫`,
    btn: "🃏 Открыть карту",
  }),
  () => ({
    text: `🎴 Есть вопрос? Карты готовы ответить.\n\nРасклад занимает меньше минуты, а ответ может изменить многое.`,
    btn: "🎴 Разложить карты",
  }),
  () => ({
    text: `😴 Что снилось этой ночью?\n\nЗапиши сны пока свежи — Оракул расшифрует скрытые послания.`,
    btn: "📔 Записать сон",
  }),
  (ctx) => ({
    text: `ᚠ Руны${ctx.sign ? ` для ${ctx.sign}` : ""} говорят сегодня.\n\nБрось руны и узнай, какие силы действуют в твоей жизни.`,
    btn: "ᚠ Бросить руны",
  }),
  () => ({
    text: `🔮 Персональный Оракул помнит тебя.\n\nЗадай вопрос — о любви, пути или сомнениях. Он ответит.`,
    btn: "🔮 Спросить Оракула",
  }),
];

// ── Мистический календарь 2026: ключевые даты для уведомлений ──
const ASTRO_EVENTS_2026 = [
  { date: "01-03", type: "new_moon",  label: "🌑 Новолуние в Козероге",     ritual: "Ставь финансовые намерения" },
  { date: "01-18", type: "full_moon", label: "🌕 Полнолуние в Раке",        ritual: "Отпусти старые обиды" },
  { date: "02-01", type: "new_moon",  label: "🌑 Новолуние в Водолее",      ritual: "Загадай желания на дружбу и свободу" },
  { date: "02-17", type: "full_moon", label: "🌕 Полнолуние во Льве",       ritual: "Прояви себя, покажи миру свой свет" },
  { date: "03-03", type: "new_moon",  label: "🌑 Новолуние в Рыбах",        ritual: "Доверься интуиции, загадай духовное" },
  { date: "03-14", type: "eclipse",   label: "🌑✨ Полное лунное затмение", ritual: "Мощнейший день: отпусти всё лишнее" },
  { date: "03-20", type: "equinox",   label: "🌿 Весеннее равноденствие",    ritual: "Очисти пространство, начни новый цикл" },
  { date: "03-29", type: "eclipse",   label: "☀️✨ Частичное солнечное затмение", ritual: "Новые начинания обретают силу" },
  { date: "04-02", type: "new_moon",  label: "🌑 Новолуние в Овне",         ritual: "Смелые намерения и новые проекты" },
  { date: "04-16", type: "full_moon", label: "🌕 Полнолуние в Весах",       ritual: "Гармонизируй отношения" },
  { date: "05-01", type: "new_moon",  label: "🌑 Новолуние в Тельце",       ritual: "Намерения на достаток и красоту" },
  { date: "05-16", type: "full_moon", label: "🌕 Полнолуние в Скорпионе",   ritual: "Трансформация и глубокие перемены" },
  { date: "06-14", type: "full_moon", label: "🌕 Полнолуние в Стрельце",    ritual: "Расширяй горизонты" },
  { date: "06-21", type: "solstice",  label: "☀️ Летнее солнцестояние",      ritual: "Разожги костёр намерений" },
  { date: "07-14", type: "full_moon", label: "🌕 Полнолуние в Козероге",     ritual: "Подведи итоги полугодия" },
  { date: "08-12", type: "full_moon", label: "🌕 Полнолуние в Водолее",     ritual: "Освободись от ограничений" },
  { date: "09-07", type: "eclipse",   label: "🌑✨ Полное лунное затмение", ritual: "Переломный момент — прислушайся к знакам" },
  { date: "09-22", type: "equinox",   label: "🍂 Осеннее равноденствие",     ritual: "Благодарность и завершение циклов" },
  { date: "09-22", type: "eclipse",   label: "☀️✨ Частичное солнечное затмение", ritual: "Мощный портал перемен" },
  { date: "10-10", type: "full_moon", label: "🌕 Полнолуние в Овне",        ritual: "Действуй! Энергия на пике" },
  { date: "11-09", type: "full_moon", label: "🌕 Полнолуние в Тельце",      ritual: "Укрепи то, что ценно" },
  { date: "12-08", type: "full_moon", label: "🌕 Полнолуние в Близнецах",   ritual: "Подведи итоги года" },
  { date: "12-21", type: "solstice",  label: "❄️ Зимнее солнцестояние",      ritual: "Самая длинная ночь — медитируй" },
];

// Выбрать тип уведомления для конкретного пользователя (умная логика)
function chooseNotificationType(ctx, dayIndex) {
  // 1. Приоритет: астрологическое событие сегодня
  if (ctx.todayEvent) {
    const ev = ctx.todayEvent;
    const isMoon = ev.type === "full_moon" || ev.type === "new_moon";
    const type = isMoon ? "moon_event" : "astro_event";
    return {
      type,
      context: { ...ctx, event_label: ev.label, event_ritual: ev.ritual, phase: isMoon ? ev.label.split(" ")[0] : undefined },
    };
  }

  // 2. Если есть активная серия >= 2 дней — напомнить не терять (через день чередуем)
  if (ctx.streak >= 2 && dayIndex % 2 === 0) {
    return { type: "streak_warning", context: ctx };
  }

  // 3. Ротация по функциям
  const templateFn = CRON_ROTATION[dayIndex % CRON_ROTATION.length];
  const { text, btn } = templateFn(ctx);
  return { type: "__raw", text, btn };
}

// ── Общая функция отправки в Telegram ───────────────────────
const sendTelegramMessage = async (token, chatId, text, replyMarkup) => {
  const body = { chat_id: chatId, text, parse_mode: "HTML" };
  if (replyMarkup) body.reply_markup = replyMarkup;

  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const err = await r.text();
    throw new Error(`TG ${r.status}: ${err.slice(0, 200)}`);
  }
  return r.json();
};

// ── GET: CRON — массовая рассылка всем пользователям ────────
async function handleCron(req, res) {
  // Проверка авторизации крона
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = req.headers.authorization;
    if (authHeader !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ error: "Unauthorized" });
    }
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return res.status(503).json({ error: "TELEGRAM_BOT_TOKEN не задан" });

  const webappUrl = process.env.WEBAPP_URL || null;
  const db = getSupabase();

  try {
    const { data: users, error } = await db
      .from("mystic_users")
      .select("telegram_id, data")
      .not("data", "is", null);

    if (error) throw error;
    if (!users || users.length === 0) {
      return res.status(200).json({ ok: true, sent: 0, message: "No users" });
    }

    const today = new Date().toDateString();
    const dayIndex = Math.floor(Date.now() / 86400000);
    let sent = 0, skipped = 0, blocked = 0, errors = 0;

    // Проверяем астро-событие на сегодня (MM-DD формат)
    const nowDate = new Date();
    const mmdd = `${String(nowDate.getMonth() + 1).padStart(2, "0")}-${String(nowDate.getDate()).padStart(2, "0")}`;
    const todayEvent = ASTRO_EVENTS_2026.find(e => e.date === mmdd) || null;

    for (const row of users) {
      const userData = row.data || {};

      if (!userData.registered) { skipped++; continue; }
      if (userData.notif_cron_sent === today) { skipped++; continue; }

      const sign = userData.sun_sign || null;
      const streak = userData.streak_days || 0;
      const ctx = { sign, streak, todayEvent };

      // Умный выбор типа уведомления для каждого пользователя
      const chosen = chooseNotificationType(ctx, dayIndex);

      let notifText, btnLabel;
      if (chosen.type === "__raw") {
        // Прямой шаблон из ротации
        notifText = chosen.text;
        btnLabel = chosen.btn;
      } else {
        // Шаблон из TEMPLATES
        const templateFn = TEMPLATES[chosen.type] || TEMPLATES.custom;
        const result = templateFn(chosen.context || ctx);
        notifText = result.text;
        btnLabel = result.btn;
      }

      const replyMarkup = webappUrl
        ? { inline_keyboard: [[{ text: btnLabel, web_app: { url: webappUrl } }]] }
        : null;

      try {
        await sendTelegramMessage(token, row.telegram_id, notifText, replyMarkup);
        sent++;

        const merged = { ...userData, notif_cron_sent: today };
        await db.from("mystic_users").upsert(
          { telegram_id: row.telegram_id, data: merged, updated_at: new Date().toISOString() },
          { onConflict: "telegram_id" }
        );
      } catch (e) {
        if (e.message.match(/403|400|blocked|chat not found/i)) { blocked++; continue; }
        console.warn(`[Cron] Error sending to ${row.telegram_id}:`, e.message);
        errors++;
      }

      // Telegram лимит: 30 msg/sec
      if (sent % 25 === 0) await new Promise(r => setTimeout(r, 1100));
    }

    return res.status(200).json({ ok: true, total: users.length, sent, skipped, blocked, errors });
  } catch (e) {
    console.error("[Cron notify]", e.message);
    return res.status(500).json({ error: e.message });
  }
}

// ── POST: одиночное уведомление ─────────────────────────────
async function handlePost(req, res) {
  if (!checkBodySize(req.body, 8_000)) {
    return res.status(413).json({ error: "Слишком большой запрос" });
  }

  const { telegram_id: rawId, type = "daily_horoscope", context: ctx = {} } = req.body || {};
  const { ok, id, warn } = resolveUserId(req, rawId);
  if (!ok) return res.status(401).json({ error: warn || "telegram_id обязателен" });
  if (warn) console.warn("[/api/notifications]", warn, id);

  if (!rateLimit(`notif_${id}`, 10, 60_000)) {
    return res.status(429).json({ error: "Слишком много запросов" });
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.error("[Notifications] TELEGRAM_BOT_TOKEN не задан");
    return res.status(503).json({ error: "Сервис временно недоступен" });
  }

  const webappUrl = process.env.WEBAPP_URL || null;
  const db = getSupabase();

  // Дедупликация
  const dedupField = DAILY_DEDUP_FIELD[type];
  if (dedupField) {
    try {
      const { data: userRow } = await db
        .from("mystic_users")
        .select("data")
        .eq("telegram_id", id)
        .maybeSingle();

      if (userRow?.data) {
        const today = new Date().toDateString();
        if (userRow.data[dedupField] === today) {
          return res.status(200).json({ ok: true, skipped: true, reason: "already_sent_today" });
        }
      }
    } catch (e) {
      console.warn("[Notifications] dedup check failed:", e.message);
    }
  }

  const templateFn = TEMPLATES[type] || TEMPLATES.custom;
  const { text: notifText, btn: btnLabel } = templateFn(ctx);

  const replyMarkup = webappUrl
    ? { inline_keyboard: [[{ text: btnLabel, web_app: { url: webappUrl } }]] }
    : null;

  try {
    await sendTelegramMessage(token, id, notifText, replyMarkup);
  } catch (e) {
    console.error("[Notifications] send error:", e.message);
    if (e.message.match(/403|blocked|chat not found/i)) {
      return res.status(200).json({ ok: false, reason: "bot_blocked_or_no_chat" });
    }
    return res.status(502).json({ error: "Не удалось отправить уведомление" });
  }

  if (dedupField) {
    try {
      const today = new Date().toDateString();
      const { data: existing } = await db
        .from("mystic_users")
        .select("data")
        .eq("telegram_id", id)
        .maybeSingle();

      const merged = { ...(existing?.data || {}), [dedupField]: today };
      await db.from("mystic_users").upsert(
        { telegram_id: id, data: merged, updated_at: new Date().toISOString() },
        { onConflict: "telegram_id" }
      );
    } catch (e) {
      console.warn("[Notifications] failed to save dedup date:", e.message);
    }
  }

  return res.status(200).json({ ok: true });
}

// ── Роутинг по методу ───────────────────────────────────────
export default async function handler(req, res) {
  setCorsHeaders(res, "GET, POST, OPTIONS");
  setSecurityHeaders(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method === "GET")  return handleCron(req, res);
  if (req.method === "POST") return handlePost(req, res);

  return res.status(405).json({ error: "Method not allowed" });
}
