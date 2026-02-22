// ============================================================
// VERCEL SERVERLESS FUNCTION — Telegram Bot Webhook
// Переменные в Vercel:
//   TELEGRAM_BOT_TOKEN — токен бота от @BotFather
//   WEBAPP_URL         — URL задеплоенного приложения (например https://mysticbot.vercel.app)
//   WEBHOOK_SECRET     — секрет для верификации (задать при регистрации вебхука)
// ============================================================

import { createHmac } from "node:crypto";
import { safeStringEqual } from "./_security.js";

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

  // /start — открыть WebApp
  if (text.startsWith("/start")) {
    const markup = webappUrl
      ? {
          inline_keyboard: [
            [
              {
                text: "🔮 Открыть MysticBot",
                web_app: { url: webappUrl },
              },
            ],
          ],
        }
      : null;

    await sendMessage(
      token,
      chatId,
      `✨ Привет, <b>${firstName}</b>!\n\nДобро пожаловать в <b>MysticBot</b> — твой личный мистический оракул.\n\nНажми кнопку ниже, чтобы открыть приложение 👇`,
      markup
    );
    return res.status(200).end();
  }

  // Любое другое сообщение — подсказка
  await sendMessage(
    token,
    chatId,
    `🔮 Нажми /start или кнопку <b>«Открыть MysticBot»</b>, чтобы начать.`
  );
  return res.status(200).end();
}
