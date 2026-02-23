// ============================================================
// GET /api/setup-webhook — регистрирует Telegram вебхук и меню бота.
//
// Вызвать ОДИН РАЗ после каждого деплоя на новый URL:
//   https://your-domain.vercel.app/api/setup-webhook?secret=<CRON_SECRET>
//
// Переменные Vercel:
//   TELEGRAM_BOT_TOKEN — токен бота от @BotFather
//   WEBAPP_URL         — URL задеплоенного приложения
//   WEBHOOK_SECRET     — секрет, с которым бот будет подписывать запросы
//   CRON_SECRET        — используется для защиты этого endpoint
// ============================================================

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Простая защита: требуем CRON_SECRET в query-параметре ?secret=
  const adminSecret = process.env.CRON_SECRET;
  if (adminSecret) {
    const provided = req.query.secret || "";
    if (provided !== adminSecret) {
      return res.status(401).json({ error: "Unauthorized. Pass ?secret=<CRON_SECRET>" });
    }
  }

  const token      = process.env.TELEGRAM_BOT_TOKEN;
  const webappUrl  = process.env.WEBAPP_URL;
  const hookSecret = process.env.WEBHOOK_SECRET;

  if (!token)     return res.status(503).json({ error: "TELEGRAM_BOT_TOKEN не задан" });
  if (!webappUrl) return res.status(503).json({ error: "WEBAPP_URL не задан" });

  const webhookUrl = `${webappUrl.replace(/\/$/, "")}/api/telegram`;
  const results = {};

  // ── 1. Регистрируем вебхук ─────────────────────────────────
  const webhookBody = {
    url: webhookUrl,
    allowed_updates: ["message", "callback_query"],
    drop_pending_updates: true,
  };
  if (hookSecret) webhookBody.secret_token = hookSecret;

  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(webhookBody),
    });
    results.webhook = await r.json();
  } catch (e) {
    results.webhook = { ok: false, error: e.message };
  }

  // ── 2. Устанавливаем команды бота ─────────────────────────
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/setMyCommands`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        commands: [{ command: "start", description: "Открыть MysticBot 🔮" }],
      }),
    });
    results.commands = await r.json();
  } catch (e) {
    results.commands = { ok: false, error: e.message };
  }

  // ── 3. Кнопка-меню для открытия WebApp ────────────────────
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/setChatMenuButton`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        menu_button: {
          type: "web_app",
          text: "🔮 MysticBot",
          web_app: { url: webappUrl },
        },
      }),
    });
    results.menu_button = await r.json();
  } catch (e) {
    results.menu_button = { ok: false, error: e.message };
  }

  // ── 4. Получаем текущий статус вебхука ────────────────────
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`);
    results.webhook_info = await r.json();
  } catch (e) {
    results.webhook_info = { ok: false, error: e.message };
  }

  const allOk = results.webhook?.ok && results.commands?.ok;
  return res.status(200).json({
    ok: allOk,
    webhook_url: webhookUrl,
    ...results,
  });
}
