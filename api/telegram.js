// ============================================================
// VERCEL SERVERLESS FUNCTION — Telegram Bot Webhook
// Переменные в Vercel:
//   TELEGRAM_BOT_TOKEN — токен бота от @BotFather
//   WEBAPP_URL         — URL задеплоенного приложения (например https://mysticbot.vercel.app)
//   WEBHOOK_SECRET     — секрет для верификации (задать при регистрации вебхука)
// ============================================================

import { createHmac } from "node:crypto";
import { safeStringEqual } from "./_security.js";

// Устанавливает кнопку меню (☰) в чате пользователя, которая сразу открывает приложение.
const setMenuButton = async (token, chatId, webappUrl) => {
  if (!webappUrl) return;
  await fetch(`https://api.telegram.org/bot${token}/setChatMenuButton`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      menu_button: { type: "web_app", text: "🔮 МистикУм", web_app: { url: webappUrl } },
    }),
  }).catch(() => {});
};

const sendMessage = async (token, chatId, text, replyMarkup = null) => {
  const body = {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
  };
  if (replyMarkup) body.reply_markup = replyMarkup;

  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
};

/**
 * Верифицирует подпись вебхука от Telegram.
 * Telegram шлёт заголовок X-Telegram-Bot-Api-Secret-Token,
 * который должен совпадать со значением, заданным при setWebhook.
 *
 * Если WEBHOOK_SECRET не задан — верификация пропускается (dev mode).
 */
const verifyWebhookSecret = (req) => {
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret) return true; // dev mode — не требуем секрет

  const incoming = req.headers["x-telegram-bot-api-secret-token"] || "";
  // Постоянное время сравнения строк (защита от timing attack)
  return safeStringEqual(incoming, secret);
};

export default async function handler(req, res) {
  // Telegram шлёт только POST
  if (req.method !== "POST") return res.status(200).send("MysticBot webhook OK");

  // Верификация подписи
  if (!verifyWebhookSecret(req)) {
    console.warn("[Webhook] Неверный секрет запроса");
    return res.status(200).end(); // всегда 200 для Telegram, чтобы не ретраить
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const webappUrl = process.env.WEBAPP_URL;

  if (!token) {
    console.error("TELEGRAM_BOT_TOKEN не задан");
    return res.status(200).end(); // всегда 200 для Telegram
  }

  const update = req.body;

  // Обрабатываем только обычные сообщения
  const message = update?.message;
  if (!message) return res.status(200).end();

  const chatId = message.chat.id;
  const text = message.text || "";
  const firstName = message.from?.first_name || "друг";

  // /start — установить кнопку меню и показать клавишу для мгновенного открытия приложения
  if (text.startsWith("/start")) {
    // Устанавливаем кнопку ☰ → «МистикУм» — после этого приложение открывается одним касанием
    if (webappUrl) await setMenuButton(token, chatId, webappUrl);

    // ReplyKeyboardMarkup: постоянная кнопка-клавиша внизу чата, открывает WebApp сразу при нажатии
    const replyKeyboard = webappUrl
      ? {
          keyboard: [[{ text: "🔮 Открыть МистикУм", web_app: { url: webappUrl } }]],
          resize_keyboard: true,
          is_persistent: true,
        }
      : null;

    await sendMessage(
      token,
      chatId,
      `✨ Привет, <b>${firstName}</b>! Добро пожаловать в <b>МистикУм</b> — твой персональный оракул.\n\n🔮 Нажми кнопку ниже — приложение откроется мгновенно 👇`,
      replyKeyboard
    );
    return res.status(200).end();
  }

  // Любое другое сообщение — напомнить про кнопку
  const hintMarkup = webappUrl
    ? { keyboard: [[{ text: "🔮 Открыть МистикУм", web_app: { url: webappUrl } }]], resize_keyboard: true, is_persistent: true }
    : null;
  await sendMessage(
    token,
    chatId,
    `🔮 Нажми кнопку <b>«Открыть МистикУм»</b> внизу экрана или используй кнопку меню ☰`,
    hintMarkup
  );
  return res.status(200).end();
}
