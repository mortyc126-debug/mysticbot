// ============================================================
// VERCEL SERVERLESS FUNCTION — Push-уведомления через Telegram Bot API
//
// POST /api/notifications
// Body:
//   type:    "daily_horoscope" | "daily_card" | "streak_warning" |
//            "astro_event"     | "tarot_reminder" | "dream_reminder" |
//            "rune_reminder"   | "moon_event"     | "custom"
//   context: { sign?, streak?, card_name?, event_label?, event_ritual?, phase?, message? }
//
// Headers: x-telegram-init-data (обязателен в продакшене)
//
// Переменные Vercel:
//   TELEGRAM_BOT_TOKEN — токен бота от @BotFather
//   WEBAPP_URL         — URL задеплоенного приложения
// ============================================================

import { getSupabase } from "./_supabase.js";
import { setCorsHeaders, setSecurityHeaders, rateLimit, checkBodySize } from "./_security.js";
import { resolveUserId } from "./_auth.js";

// ── Шаблоны уведомлений ─────────────────────────────────────
// Каждый шаблон получает { context, webappUrl } и возвращает { text, btn }
const TEMPLATES = {
  // Ежедневный гороскоп
  daily_horoscope: ({ sign }) => ({
    text: `🔮 ${sign ? `${sign}, сегодня` : "Сегодня"} звёзды говорят особенно отчётливо.\n\nТвой персональный гороскоп ждёт. Что расскажет Оракул? ✨`,
    btn: "🌟 Читать гороскоп",
  }),

  // Карта дня (название карты известно — детерминированный выбор)
  daily_card: ({ card_name }) => ({
    text: `🃏 Карта дня ${card_name ? `— <b>${card_name}</b>` : "открыта"}.\n\nВселенная выбрала её специально для тебя сегодня. Загляни в МистикУм — послание уже ждёт 🔮`,
    btn: "🃏 Узнать послание",
  }),

  // Угроза серии (только если streak ≥ 2)
  streak_warning: ({ streak }) => ({
    text: `🔥 Серия ${streak ? `${streak} дн.` : ""} — не прерывай!\n\nОракул помнит каждый твой визит. Загляни сегодня, чтобы сохранить стрик и получить бонусные 💫`,
    btn: "⚡ Продолжить серию",
  }),

  // Астрологическое событие из календаря
  astro_event: ({ event_label, event_ritual }) => ({
    text: `✨ ${event_label || "Астрологическое событие"} — сегодня!\n\n${event_ritual ? `${event_ritual}.` : "Мощное время для ритуалов и намерений."} Открой МистикУм для персонального прогноза 🌙`,
    btn: "📅 Персональный прогноз",
  }),

  // Лунная фаза (новолуние, полнолуние и т.д.)
  moon_event: ({ event_label, phase }) => ({
    text: `🌕 ${event_label || (phase ? `${phase} луна` : "Особое лунное событие")} сегодня.\n\nЭто мощное время для намерений и отпускания. Загляни в мистический календарь ✨`,
    btn: "🌙 Открыть календарь",
  }),

  // Напоминание о таро
  tarot_reminder: ({ sign }) => ({
    text: `🎴 Карты${sign ? ` для ${sign}` : ""} готовы раскрыть тайное...\n\nЗадай вопрос — и Таро даст честный ответ. Расклад займёт меньше минуты 🔮`,
    btn: "🎴 Разложить карты",
  }),

  // Напоминание о дневнике снов
  dream_reminder: () => ({
    text: "😴 Что снилось этой ночью?\n\nЗапиши сны пока они свежи — Оракул расшифрует образы и раскроет скрытые послания в твоём дневнике судьбы 📔",
    btn: "📔 Записать сон",
  }),

  // Напоминание о рунах
  rune_reminder: ({ sign }) => ({
    text: `ᚠ Руны${sign ? ` для ${sign}` : ""} говорят сегодня.\n\nБрось руны и узнай, какие силы действуют в твоей жизни прямо сейчас. Ответ — в древних символах 🌿`,
    btn: "ᚠ Бросить руны",
  }),

  // Произвольное сообщение
  custom: ({ message }) => ({
    text: message || "✨ Послание от МистикУма",
    btn: "🔮 Открыть МистикУм",
  }),
};

// Типы, которые дедуплицируются по дате (1 раз в сутки)
// custom — всегда отправляем
const DAILY_DEDUP_FIELD = {
  daily_horoscope: "notif_daily_sent",
  daily_card:      "notif_daily_sent", // те же сутки — один тип из группы "daily"
  streak_warning:  "notif_streak_sent",
  astro_event:     "notif_event_sent",
  moon_event:      "notif_event_sent",
  tarot_reminder:  "notif_daily_sent",
  dream_reminder:  "notif_daily_sent",
  rune_reminder:   "notif_daily_sent",
};

const sendTelegramMessage = async (token, chatId, text, replyMarkup) => {
  const body = { chat_id: chatId, text, parse_mode: "HTML" };
  if (replyMarkup) body.reply_markup = replyMarkup;

  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`TG ${res.status}: ${err.slice(0, 200)}`);
  }
  return res.json();
};

export default async function handler(req, res) {
  setCorsHeaders(res, "POST, OPTIONS");
  setSecurityHeaders(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  if (!checkBodySize(req.body, 8_000)) {
    return res.status(413).json({ error: "Слишком большой запрос" });
  }

  const { telegram_id: rawId, type = "daily_horoscope", context: ctx = {} } = req.body || {};
  const { ok, id, warn } = resolveUserId(req, rawId);
  if (!ok) return res.status(401).json({ error: warn || "telegram_id обязателен" });
  if (warn) console.warn("[/api/notifications]", warn, id);

  // Rate limit: 10 уведомлений в минуту на пользователя
  if (!rateLimit(`notif_${id}`, 10, 60_000)) {
    return res.status(429).json({ error: "Слишком много запросов" });
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.error("[Notifications] TELEGRAM_BOT_TOKEN не задан");
    return res.status(503).json({ error: "Сервис временно недоступен" });
  }

  const webappUrl = process.env.WEBAPP_URL || null;

  // Один клиент на весь запрос — переиспользуется и в dedup-check, и в dedup-save
  const db = getSupabase();

  // Дедупликация: не шлём один и тот же "слот" дважды за сутки
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

  // Формируем текст по шаблону
  const templateFn = TEMPLATES[type] || TEMPLATES.custom;
  const { text: notifText, btn: btnLabel } = templateFn(ctx);

  const replyMarkup = webappUrl
    ? { inline_keyboard: [[{ text: btnLabel, web_app: { url: webappUrl } }]] }
    : null;

  try {
    await sendTelegramMessage(token, id, notifText, replyMarkup);
  } catch (e) {
    console.error("[Notifications] send error:", e.message);
    // Бот заблокирован или чат не существует — не критично
    if (e.message.match(/403|blocked|chat not found/i)) {
      return res.status(200).json({ ok: false, reason: "bot_blocked_or_no_chat" });
    }
    return res.status(502).json({ error: "Не удалось отправить уведомление" });
  }

  // Сохраняем дату отправки, чтобы не дублировать
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
