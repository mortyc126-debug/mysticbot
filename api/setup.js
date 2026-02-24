// ============================================================
// ОДНОРАЗОВЫЙ SETUP — регистрация вебхука и глобальной кнопки меню
//
// Вызвать один раз после деплоя:
//   GET https://<your-domain>/api/setup?secret=<WEBHOOK_SECRET>
//
// Что делает:
//   1. Регистрирует вебхук в Telegram (setWebhook)
//   2. Устанавливает глобальную кнопку меню ☰ для ВСЕХ пользователей
//   3. Задаёт команды бота (/start)
// ============================================================

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");

  const token     = process.env.TELEGRAM_BOT_TOKEN;
  const webappUrl = process.env.WEBAPP_URL;
  const secret    = process.env.WEBHOOK_SECRET;

  // Защита: запрос должен содержать WEBHOOK_SECRET в query-параметре
  if (secret) {
    if (req.query.secret !== secret) {
      return res.status(403).json({ error: "Forbidden: неверный secret" });
    }
  }

  if (!token) {
    return res.status(500).json({ error: "TELEGRAM_BOT_TOKEN не задан в env" });
  }
  if (!webappUrl) {
    return res.status(500).json({ error: "WEBAPP_URL не задан в env" });
  }

  const webhookUrl = `${webappUrl}/api/telegram`;
  const results    = {};

  // 1. Регистрация вебхука
  try {
    const body = {
      url: webhookUrl,
      allowed_updates: ["message"],
    };
    // Если задан секрет — передаём его в Telegram, чтобы он подписывал запросы
    if (secret) body.secret_token = secret;

    const r = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(body),
    });
    results.webhook = await r.json();
  } catch (e) {
    results.webhook = { ok: false, error: e.message };
  }

  // 2. Глобальная кнопка меню ☰ (без chat_id = для всех пользователей)
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/setChatMenuButton`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        // chat_id намеренно не передаётся — устанавливается глобально
        menu_button: {
          type:    "web_app",
          text:    "🔮 МистикУм",
          web_app: { url: webappUrl },
        },
      }),
    });
    results.menuButton = await r.json();
  } catch (e) {
    results.menuButton = { ok: false, error: e.message };
  }

  // 3. Команды бота
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/setMyCommands`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        commands: [
          { command: "start", description: "Открыть МистикУм" },
        ],
      }),
    });
    results.commands = await r.json();
  } catch (e) {
    results.commands = { ok: false, error: e.message };
  }

  const allOk = Object.values(results).every(r => r?.ok);
  return res.status(200).json({
    ok:         allOk,
    webhookUrl,
    webappUrl,
    results,
  });
}
