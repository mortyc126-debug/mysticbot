// ============================================================
// VERCEL SERVERLESS FUNCTION — Telegram Bot Webhook + Setup
// Переменные в Vercel:
//   TELEGRAM_BOT_TOKEN — токен бота от @BotFather
//   WEBAPP_URL         — URL задеплоенного приложения (например https://mysticbot.vercel.app)
//   WEBHOOK_SECRET     — секрет для верификации (задать при регистрации вебхука)
//
// Webhook setup: GET /api/telegram?setup=1&secret=<WEBHOOK_SECRET>
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

// ── Одноразовый setup вебхука (бывший /api/setup) ────────
const runSetup = async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  const token     = process.env.TELEGRAM_BOT_TOKEN;
  const webappUrl = process.env.WEBAPP_URL;
  const secret    = process.env.WEBHOOK_SECRET;

  if (secret && req.query.secret !== secret) return res.status(403).json({ error: "Forbidden: неверный secret" });
  if (!token)     return res.status(500).json({ error: "TELEGRAM_BOT_TOKEN не задан в env" });
  if (!webappUrl) return res.status(500).json({ error: "WEBAPP_URL не задан в env" });

  const webhookUrl = `${webappUrl.replace(/\/$/, "")}/api/telegram`;
  const results    = {};

  // 1. Вебхук
  try {
    const body = { url: webhookUrl, allowed_updates: ["message"] };
    if (secret) body.secret_token = secret;
    const r = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    results.webhook = await r.json();
  } catch (e) { results.webhook = { ok: false, error: e.message }; }

  // 2. Кнопка меню ☰ (глобально)
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/setChatMenuButton`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ menu_button: { type: "web_app", text: "🔮 МистикУм", web_app: { url: webappUrl } } }),
    });
    results.menuButton = await r.json();
  } catch (e) { results.menuButton = { ok: false, error: e.message }; }

  // 3. Команды
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/setMyCommands`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commands: [{ command: "start", description: "Открыть МистикУм" }] }),
    });
    results.commands = await r.json();
  } catch (e) { results.commands = { ok: false, error: e.message }; }

  // 4. Состояние вебхука
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`);
    results.webhookInfo = await r.json();
  } catch (e) { results.webhookInfo = { ok: false, error: e.message }; }

  return res.status(200).json({ ok: Object.values(results).every(r => r?.ok), webhookUrl, webappUrl, results });
};

export default async function handler(req, res) {
  // Setup маршрут: GET /api/telegram?setup=1
  if (req.method === "GET" && req.query.setup === "1") return runSetup(req, res);

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

  // /start — установить кнопку меню и показать inline-кнопку прямо в сообщении
  if (text.startsWith("/start")) {
    // Устанавливаем кнопку ☰ → «МистикУм» — после этого приложение открывается одним касанием
    if (webappUrl) await setMenuButton(token, chatId, webappUrl);

    // InlineKeyboardMarkup: кнопка прямо внутри сообщения — заметнее и кликается без лишних шагов
    const inlineMarkup = webappUrl
      ? {
          inline_keyboard: [[{ text: "🔮 Открыть МистикУм", web_app: { url: webappUrl } }]],
        }
      : null;

    await sendMessage(
      token,
      chatId,
      `✨ Привет, <b>${firstName}</b>! Добро пожаловать в <b>МистикУм</b> — твой персональный оракул.\n\n🔮 Нажми кнопку ниже — приложение откроется мгновенно 👇`,
      inlineMarkup
    );
    return res.status(200).end();
  }

  // Любое другое сообщение — напомнить про кнопку (inline, прямо в сообщении)
  const hintMarkup = webappUrl
    ? { inline_keyboard: [[{ text: "🔮 Открыть МистикУм", web_app: { url: webappUrl } }]] }
    : null;
  await sendMessage(
    token,
    chatId,
    `🔮 Нажми кнопку ниже или используй кнопку меню ☰, чтобы открыть <b>МистикУм</b>`,
    hintMarkup
  );
  return res.status(200).end();
}
