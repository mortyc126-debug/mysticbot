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

// ── Шаблоны для CRON (ротация по дням) ──────────────────────
const CRON_POOL = [
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
  (ctx) => ctx.streak >= 2
    ? { text: `🔥 Серия ${ctx.streak} дн. — не теряй!\n\nЗагляни сегодня, чтобы сохранить свою серию и получить бонус 💫`, btn: "⚡ Продолжить серию" }
    : { text: `✨ Новый день — новые знаки.\n\nОткрой МистикУм и узнай, что говорят звёзды.`, btn: "🔮 Открыть" },
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

// ── HTML-экранирование для Telegram parse_mode: HTML ────────
const escapeHtml = (str) =>
  String(str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

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

// ── Астро-события 2026 (для персонализированных уведомлений) ─
const ASTRO_EVENTS_2026 = [
  { date: "2026-01-17", type: "full_moon",    label: "🌕 Полнолуние в Раке" },
  { date: "2026-01-29", type: "new_moon",     label: "🌑 Новолуние в Водолее" },
  { date: "2026-02-12", type: "full_moon",    label: "🌕 Полнолуние во Льве" },
  { date: "2026-02-17", type: "eclipse",      label: "🌑 Лунное затмение" },
  { date: "2026-02-28", type: "new_moon",     label: "🌑 Новолуние в Рыбах" },
  { date: "2026-03-03", type: "eclipse",      label: "☀️ Солнечное затмение" },
  { date: "2026-03-14", type: "full_moon",    label: "🌕 Полнолуние в Деве" },
  { date: "2026-03-20", type: "equinox",      label: "🌸 Весеннее равноденствие" },
  { date: "2026-03-29", type: "new_moon",     label: "🌑 Новолуние в Овне" },
  { date: "2026-04-12", type: "full_moon",    label: "🌕 Полнолуние в Весах" },
  { date: "2026-04-27", type: "new_moon",     label: "🌑 Новолуние в Тельце" },
  { date: "2026-05-11", type: "full_moon",    label: "🌕 Полнолуние в Скорпионе" },
  { date: "2026-05-27", type: "new_moon",     label: "🌑 Новолуние в Близнецах" },
  { date: "2026-06-09", type: "full_moon",    label: "🌕 Полнолуние в Стрельце" },
  { date: "2026-06-21", type: "solstice",     label: "☀️ Летнее солнцестояние" },
  { date: "2026-06-25", type: "new_moon",     label: "🌑 Новолуние в Раке" },
  { date: "2026-07-09", type: "full_moon",    label: "🌕 Полнолуние в Козероге" },
  { date: "2026-07-25", type: "new_moon",     label: "🌑 Новолуние во Льве" },
  { date: "2026-08-07", type: "full_moon",    label: "🌕 Полнолуние в Водолее" },
  { date: "2026-08-12", type: "eclipse",      label: "🌑 Лунное затмение" },
  { date: "2026-08-23", type: "new_moon",     label: "🌑 Новолуние в Деве" },
  { date: "2026-08-28", type: "eclipse",      label: "☀️ Солнечное затмение" },
  { date: "2026-09-05", type: "full_moon",    label: "🌕 Полнолуние в Рыбах" },
  { date: "2026-09-21", type: "new_moon",     label: "🌑 Новолуние в Весах" },
  { date: "2026-09-22", type: "equinox",      label: "🍂 Осеннее равноденствие" },
  { date: "2026-10-05", type: "full_moon",    label: "🌕 Полнолуние в Овне" },
  { date: "2026-10-21", type: "new_moon",     label: "🌑 Новолуние в Скорпионе" },
  { date: "2026-11-03", type: "full_moon",    label: "🌕 Полнолуние в Тельце" },
  { date: "2026-11-20", type: "new_moon",     label: "🌑 Новолуние в Стрельце" },
  { date: "2026-12-03", type: "full_moon",    label: "🌕 Полнолуние в Близнецах" },
  { date: "2026-12-19", type: "new_moon",     label: "🌑 Новолуние в Козероге" },
  { date: "2026-12-21", type: "solstice",     label: "❄️ Зимнее солнцестояние" },
];

// Умный выбор типа уведомления для каждого пользователя
function chooseNotificationType(userData, dayIndex) {
  const streak = userData.streak_days || 0;
  const sign = userData.sun_sign || null;
  const todayISO = new Date().toISOString().slice(0, 10);

  // 1. Приоритет: астрологическое событие сегодня
  const todayEvent = ASTRO_EVENTS_2026.find(e => e.date === todayISO);
  if (todayEvent) {
    const isMoon = todayEvent.type === "full_moon" || todayEvent.type === "new_moon";
    return {
      type: isMoon ? "moon_event" : "astro_event",
      context: { sign, streak, event_label: todayEvent.label, event_ritual: todayEvent.ritual || "" },
    };
  }

  // 2. Если есть активная серия ≥ 2 — каждый второй день напоминаем
  if (streak >= 2 && dayIndex % 2 === 0) {
    return {
      type: "streak_warning",
      context: { sign, streak },
    };
  }

  // 3. Ротация: персонализированный шаблон из CRON_POOL
  return {
    type: "cron_rotation",
    context: { sign, streak },
  };
}

// ── GET: CRON — массовая рассылка всем пользователям ────────
// Все уведомления отправляются через бота (Telegram Bot API).
// Фронтенд НЕ отправляет уведомления — вся логика здесь.
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

    for (const row of users) {
      const userData = row.data || {};

      // Пропускаем незарегистрированных и уже получивших уведомление сегодня
      if (!userData.registered) { skipped++; continue; }
      if (userData.notif_cron_sent === today) { skipped++; continue; }

      // Умный выбор типа уведомления на основе профиля пользователя
      const { type, context: ctx } = chooseNotificationType(userData, dayIndex);

      let text, btn;
      if (type === "cron_rotation") {
        // Стандартная ротация по дням из пула шаблонов
        const templateFn = CRON_POOL[dayIndex % CRON_POOL.length];
        ({ text, btn } = templateFn(ctx));
      } else {
        // Персонализированный шаблон (астро-событие, стрик, и т.д.)
        const templateFn = TEMPLATES[type] || TEMPLATES.custom;
        ({ text, btn } = templateFn(ctx));
      }

      const replyMarkup = webappUrl
        ? { inline_keyboard: [[{ text: btn, web_app: { url: webappUrl } }]] }
        : null;

      try {
        await sendTelegramMessage(token, row.telegram_id, text, replyMarkup);
        sent++;

        // Обновляем дедупликацию: сегодня уведомление уже отправлено
        const dedupField = DAILY_DEDUP_FIELD[type] || "notif_cron_sent";
        const merged = { ...userData, notif_cron_sent: today, [dedupField]: today };
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
