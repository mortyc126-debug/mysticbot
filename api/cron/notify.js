// ============================================================
// CRON: ежедневная рассылка уведомлений ВСЕМ пользователям
//
// Vercel Cron вызывает GET /api/cron/notify раз в сутки (9:00 МСК).
// Бот отправляет Telegram-сообщение каждому пользователю,
// НЕ зависит от того, открыто ли приложение.
//
// Защита: CRON_SECRET в заголовке Authorization.
// ============================================================

import { getSupabase } from "../_supabase.js";

const TELEGRAM_API = (token) => `https://api.telegram.org/bot${token}`;

const ALL_CARDS_COUNT = 78; // для детерминированной карты дня

// ── Шаблоны уведомлений (ротация по дням) ────────────────────
const NOTIFICATION_POOL = [
  // Гороскоп
  (ctx) => ({
    text: `🔮 ${ctx.sign || "Звёзды"}, твой гороскоп на сегодня готов.\n\nОткрой приложение — узнай, что ждёт тебя сегодня.`,
    btn: "🌟 Читать гороскоп",
  }),
  // Карта дня
  (ctx) => ({
    text: `🃏 Карта дня ждёт тебя.\n\nКаждый день — новое послание. Открой свою карту и получи +1 💫`,
    btn: "🃏 Открыть карту",
  }),
  // Таро
  (ctx) => ({
    text: `🎴 Есть вопрос? Карты готовы ответить.\n\nРасклад занимает меньше минуты, а ответ может изменить многое.`,
    btn: "🎴 Разложить карты",
  }),
  // Серия (если есть)
  (ctx) => ctx.streak >= 2
    ? { text: `🔥 Серия ${ctx.streak} дн. — не теряй!\n\nЗагляни сегодня, чтобы сохранить свою серию и получить бонус 💫`, btn: "⚡ Продолжить серию" }
    : { text: `✨ Новый день — новые знаки.\n\nОткрой МистикУм и узнай, что говорят звёзды.`, btn: "🔮 Открыть" },
  // Дневник снов
  () => ({
    text: `😴 Что снилось этой ночью?\n\nЗапиши сны пока свежи — Оракул расшифрует скрытые послания.`,
    btn: "📔 Записать сон",
  }),
  // Руны
  (ctx) => ({
    text: `ᚠ Руны${ctx.sign ? ` для ${ctx.sign}` : ""} говорят сегодня.\n\nБрось руны и узнай, какие силы действуют в твоей жизни.`,
    btn: "ᚠ Бросить руны",
  }),
  // Оракул
  () => ({
    text: `🔮 Персональный Оракул помнит тебя.\n\nЗадай вопрос — о любви, пути или сомнениях. Он ответит.`,
    btn: "🔮 Спросить Оракула",
  }),
];

// ── Отправка сообщения через Telegram Bot API ────────────────
const sendMessage = async (token, chatId, text, webappUrl) => {
  const body = {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
  };
  if (webappUrl) {
    body.reply_markup = {
      inline_keyboard: [[{ text: "🔮 Открыть МистикУм", web_app: { url: webappUrl } }]],
    };
  }

  const res = await fetch(`${TELEGRAM_API(token)}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    // 403 = бот заблокирован, 400 = чат не найден — не ошибка, пропускаем
    if (res.status === 403 || res.status === 400) return { ok: false, blocked: true };
    throw new Error(`TG ${res.status}: ${err.slice(0, 200)}`);
  }
  return { ok: true };
};

export default async function handler(req, res) {
  // Только GET (Vercel Cron)
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

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
    // Получаем всех зарегистрированных пользователей
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
    let sent = 0;
    let skipped = 0;
    let blocked = 0;
    let errors = 0;

    for (const row of users) {
      const userData = row.data || {};

      // Пропускаем незарегистрированных
      if (!userData.registered) { skipped++; continue; }

      // Дедупликация: не слать дважды в день
      if (userData.notif_cron_sent === today) { skipped++; continue; }

      const sign = userData.sun_sign || null;
      const streak = userData.streak_days || 0;
      const ctx = { sign, streak };

      // Выбираем шаблон по ротации (разные дни — разные сообщения)
      const templateFn = NOTIFICATION_POOL[dayIndex % NOTIFICATION_POOL.length];
      const { text } = templateFn(ctx);

      try {
        const result = await sendMessage(token, row.telegram_id, text, webappUrl);
        if (result.blocked) { blocked++; continue; }

        sent++;

        // Сохраняем дату отправки
        const merged = { ...userData, notif_cron_sent: today };
        await db.from("mystic_users").upsert(
          { telegram_id: row.telegram_id, data: merged, updated_at: new Date().toISOString() },
          { onConflict: "telegram_id" }
        );
      } catch (e) {
        console.warn(`[Cron] Error sending to ${row.telegram_id}:`, e.message);
        errors++;
      }

      // Пауза между сообщениями (Telegram лимит: 30 msg/sec)
      if (sent % 25 === 0) await new Promise(r => setTimeout(r, 1100));
    }

    return res.status(200).json({ ok: true, total: users.length, sent, skipped, blocked, errors });
  } catch (e) {
    console.error("[Cron notify]", e.message);
    return res.status(500).json({ error: e.message });
  }
}
