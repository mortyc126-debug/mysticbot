// ============================================================
// /api/payment — ЮKassa: создание платежа + вебхук
//
// POST /api/payment            — клиент: создать платёж
// POST /api/payment?hook=1     — вебхук ЮKassa (payment.succeeded)
//
// Env vars (Vercel): YOOKASSA_SHOP_ID, YOOKASSA_SECRET_KEY
// Вебхук URL в ЮKassa: https://<your-app>.vercel.app/api/payment?hook=1
// ============================================================
import { getSupabase }    from "./_supabase.js";
import { resolveUserId }  from "./_auth.js";
import { setCorsHeaders, setSecurityHeaders, rateLimit } from "./_security.js";

// ── Прайсы ────────────────────────────────────────────────
const SUBSCRIPTION_PRICES = {
  vip:     { amount: 249, description: "VIP подписка — 1 месяц",     tier: "vip",     days: 30 },
  premium: { amount: 499, description: "Премиум подписка — 1 месяц", tier: "premium", days: 30 },
};

const LUCK_PACKAGES = {
  luck_50:  { amount: 49,  luck: 50,  description: "50 звёзд удачи"  },
  luck_120: { amount: 99,  luck: 120, description: "120 звёзд удачи" },
  luck_300: { amount: 199, luck: 300, description: "300 звёзд удачи" },
};

// ── ЮKassa helpers ────────────────────────────────────────
const yooCredentials = () => {
  const shopId    = process.env.YOOKASSA_SHOP_ID;
  const secretKey = process.env.YOOKASSA_SECRET_KEY;
  if (!shopId || !secretKey) throw new Error("YOOKASSA_SHOP_ID или YOOKASSA_SECRET_KEY не заданы");
  return Buffer.from(`${shopId}:${secretKey}`).toString("base64");
};

// paymentMethod: "bank_card" | "sbp" | "yoo_money" | "sberbank" | null (все методы)
const createYooPayment = async (amount, description, metadata, returnUrl, paymentMethod) => {
  const credentials    = yooCredentials();
  // Включаем tier/package_id в ключ: разные тарифы/пакеты в одну минуту должны
  // создавать разные платежи — иначе ЮKassa вернёт кешированный первый платёж.
  const pkgOrTier = metadata.package_id || metadata.tier || "";
  const idempotenceKey = `${metadata.telegram_id}_${metadata.type}_${pkgOrTier}_${Math.floor(Date.now() / 60000)}`;

  const body = {
    amount:       { value: amount.toFixed(2), currency: "RUB" },
    confirmation: { type: "redirect", return_url: returnUrl || "https://t.me" },
    capture:      true,
    description,
    metadata,
  };

  // Если указан конкретный метод — направляем сразу на него (минуя страницу выбора)
  if (paymentMethod) body.payment_method_data = { type: paymentMethod };

  const res = await fetch("https://api.yookassa.ru/v3/payments", {
    method:  "POST",
    headers: {
      "Content-Type":    "application/json",
      "Authorization":   `Basic ${credentials}`,
      "Idempotence-Key": idempotenceKey,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.description || `ЮKassa ${res.status}`);
  return data;
};

const verifyYooPayment = async (paymentId) => {
  try {
    const res = await fetch(`https://api.yookassa.ru/v3/payments/${paymentId}`, {
      headers: { "Authorization": `Basic ${yooCredentials()}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
};

// ── DB helpers ────────────────────────────────────────────
const upsertUser = async (db, telegramId, updater) => {
  const { data: existing } = await db
    .from("mystic_users").select("data").eq("telegram_id", telegramId).single();
  const merged = updater(existing?.data || {});
  const { error } = await db.from("mystic_users").upsert(
    { telegram_id: telegramId, data: merged, updated_at: new Date().toISOString() },
    { onConflict: "telegram_id" }
  );
  if (error) throw error;
};

const activateSubscription = async (db, telegramId, tier, days) => {
  await upsertUser(db, telegramId, (cur) => {
    const now  = Date.now();
    const base = Math.max(cur.subscription_until ? new Date(cur.subscription_until).getTime() : now, now);
    return { ...cur, subscription_tier: tier, subscription_until: new Date(base + days * 86400000).toISOString() };
  });
  console.log(`[payment] ${tier} активирован для ${telegramId}`);
};

const addLuck = async (db, telegramId, luck) => {
  await upsertUser(db, telegramId, (cur) => ({ ...cur, luck_points: (cur.luck_points || 0) + luck }));
  console.log(`[payment] +${luck} удачи для ${telegramId}`);
};

// Списываем удачу при возврате средств (не уходим в минус)
const removeLuck = async (db, telegramId, luck) => {
  await upsertUser(db, telegramId, (cur) => ({
    ...cur,
    luck_points: Math.max(0, (cur.luck_points || 0) - luck),
  }));
  console.log(`[payment] -${luck} удачи для ${telegramId} (возврат)`);
};

// Валидация метаданных: не доверяем webhook-данным, сверяем с серверными прайсами.
// Если metadata.package_id / metadata.tier не совпадают ни с одним прайсом — отклоняем.
const resolvePaymentValues = (meta) => {
  if (meta.type === "subscription") {
    const plan = SUBSCRIPTION_PRICES[meta.tier];
    if (!plan) return null; // неизвестный тариф
    return { type: "subscription", tier: plan.tier, days: plan.days };
  }
  if (meta.type === "luck") {
    const pkg = LUCK_PACKAGES[meta.package_id];
    if (!pkg) return null; // неизвестный пакет
    return { type: "luck", luck: pkg.luck };
  }
  return null;
};

// Идемпотентная активация платежа: проверяет processed_payments чтобы
// не начислять повторно. Вызывается и из вебхука, и из GET ?status=
// (фоллбэк на случай если вебхук ЮKassa не дошёл или упал).
const ensurePaymentApplied = async (db, paymentId, telegramId, meta) => {
  // Валидируем метаданные по серверным прайсам (а не доверяем webhook)
  const resolved = resolvePaymentValues(meta);
  if (!resolved) {
    console.warn(`[payment] отклонены неизвестные metadata: type=${meta.type} tier=${meta.tier} pkg=${meta.package_id} (${paymentId})`);
    return;
  }

  await upsertUser(db, telegramId, (cur) => {
    const processed = cur.processed_payments || [];
    if (processed.includes(paymentId)) return cur; // уже обработан

    const updates = { ...cur, processed_payments: [...processed, paymentId].slice(-50) };

    if (resolved.type === "subscription") {
      const now  = Date.now();
      const base = Math.max(cur.subscription_until ? new Date(cur.subscription_until).getTime() : now, now);
      updates.subscription_tier  = resolved.tier;
      updates.subscription_until = new Date(base + resolved.days * 86400000).toISOString();
      console.log(`[payment] ${resolved.tier} активирован для ${telegramId} (${paymentId})`);
    } else if (resolved.type === "luck") {
      updates.luck_points = (cur.luck_points || 0) + resolved.luck;
      console.log(`[payment] +${resolved.luck} удачи для ${telegramId} (${paymentId})`);
    }

    return updates;
  });
};

// ── Проверка IP вебхука (только production) ───────────────
const isAllowedWebhookIp = (req) => {
  const isProd = process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production";
  if (!isProd) return true;
  const ip = (req.headers["x-forwarded-for"] || "").split(",")[0]?.trim() || "";
  return ip.startsWith("185.71.76.") || ip.startsWith("185.71.77.") ||
         ip.startsWith("77.75.153.") || ip.startsWith("77.75.154.") ||
         ip === "77.75.156.11"       || ip === "77.75.156.35";
};

// ── Основной хэндлер ──────────────────────────────────────
export default async function handler(req, res) {
  setSecurityHeaders(res);

  // ── Ветка: GET ?status=<payment_id> — проверка статуса платежа ──
  if (req.method === "GET") {
    setCorsHeaders(res, "GET, OPTIONS");
    const paymentId = req.query.status;
    if (!paymentId || typeof paymentId !== "string" || paymentId.length > 64) {
      return res.status(400).json({ error: "Нет или неверный payment_id" });
    }
    const payment = await verifyYooPayment(paymentId);
    if (!payment) return res.status(200).json({ status: "unknown" });

    // Если платёж успешен — активируем серверно как фоллбэк (вебхук мог не сработать).
    // ensurePaymentApplied идемпотентна: повторный вызов для того же paymentId — no-op.
    if (payment.status === "succeeded") {
      const meta       = payment.metadata || {};
      const telegramId = String(meta.telegram_id || "");
      if (telegramId) {
        try {
          const db = getSupabase();
          await ensurePaymentApplied(db, payment.id, telegramId, meta);
        } catch (e) {
          console.error("[payment-status] ensurePaymentApplied:", e.message);
        }
      }
    }

    return res.status(200).json({
      status:     payment.status,   // "pending" | "waiting_for_capture" | "succeeded" | "canceled"
      payment_id: payment.id,
      metadata:   payment.metadata || {},
    });
  }

  if (req.method === "OPTIONS") {
    setCorsHeaders(res, "GET, POST, OPTIONS");
    return res.status(204).end();
  }

  if (req.method !== "POST") return res.status(405).end();

  // ── Ветка: вебхук ЮKassa ──────────────────────────────
  if (req.query.hook === "1") {
    if (!isAllowedWebhookIp(req)) {
      console.warn("[payment-webhook] Неизвестный IP");
      return res.status(403).end();
    }

    const event = req.body;
    if (!event) return res.status(200).json({ ok: true });

    // ── Ветка: возврат средств ──────────────────────────────
    // ЮKassa присылает refund.succeeded при успешном возврате.
    // Списываем очки удачи чтобы пользователь не получил деньги и очки одновременно.
    if (event.type === "refund.succeeded") {
      const paymentId = event.object?.payment_id; // refund содержит payment_id оригинала
      if (!paymentId) return res.status(200).json({ ok: true });

      try {
        const payment = await verifyYooPayment(paymentId);
        const meta       = payment?.metadata || {};
        const telegramId = String(meta.telegram_id || "");

        if (telegramId && meta.type === "luck") {
          const luckAmount = parseInt(meta.luck || "0", 10);
          if (luckAmount > 0) {
            const db = getSupabase();
            await removeLuck(db, telegramId, luckAmount);
          }
        }
        // Подписку при возврате не откатываем автоматически — требует ручного решения
        return res.status(200).json({ ok: true });

      } catch (e) {
        console.error("[payment-webhook refund]", e.message);
        return res.status(200).json({ ok: false, error: "internal" });
      }
    }

    if (event.type !== "payment.succeeded") return res.status(200).json({ ok: true });

    const paymentId = event.object?.id;
    if (!paymentId) return res.status(400).json({ error: "Нет payment id" });

    try {
      const payment = await verifyYooPayment(paymentId);
      if (!payment || payment.status !== "succeeded") {
        return res.status(200).json({ ok: false, reason: "not_succeeded" });
      }

      const meta       = payment.metadata || {};
      const telegramId = String(meta.telegram_id || "");
      if (!telegramId) return res.status(200).json({ ok: false, reason: "no_telegram_id" });

      const db = getSupabase();
      await ensurePaymentApplied(db, paymentId, telegramId, meta);

      return res.status(200).json({ ok: true });

    } catch (e) {
      console.error("[payment-webhook]", e.message);
      return res.status(200).json({ ok: false, error: "internal" }); // 200 чтобы ЮKassa не ретраила
    }
  }

  // ── Ветка: создание платежа (клиент) ─────────────────
  setCorsHeaders(res, "POST, OPTIONS");

  const { ok, id, warn } = resolveUserId(req, req.body?.telegram_id);
  if (!ok) return res.status(401).json({ error: warn || "Не авторизован" });
  if (warn) console.warn("[payment]", warn, id);

  if (!rateLimit(`payment_${id}`, 5, 60_000)) {
    return res.status(429).json({ error: "Слишком много запросов" });
  }

  const { type, tier, packageId, return_url, payment_method } = req.body || {};

  // Допустимые методы (пустая строка = показать все)
  const ALLOWED_METHODS = new Set(["", "bank_card", "sbp", "yoo_money", "sberbank"]);
  const paymentMethod = ALLOWED_METHODS.has(payment_method || "") ? (payment_method || null) : null;

  let amount, description, metadata;

  if (type === "subscription") {
    const plan = SUBSCRIPTION_PRICES[tier];
    if (!plan) return res.status(400).json({ error: "Неверный тариф" });
    amount = plan.amount; description = plan.description;
    metadata = { telegram_id: id, type: "subscription", tier: plan.tier, days: String(plan.days) };

  } else if (type === "luck") {
    const pkg = LUCK_PACKAGES[packageId];
    if (!pkg) return res.status(400).json({ error: "Неверный пакет" });
    amount = pkg.amount; description = pkg.description;
    // luck передаём строкой: YooKassa требует строковые значения в metadata
    metadata = { telegram_id: id, type: "luck", package_id: packageId, luck: String(pkg.luck) };

  } else {
    return res.status(400).json({ error: "Неверный тип платежа" });
  }

  try {
    const payment = await createYooPayment(amount, description, metadata, return_url, paymentMethod);
    return res.status(200).json({
      ok: true,
      payment_id:       payment.id,
      confirmation_url: payment.confirmation?.confirmation_url,
    });
  } catch (e) {
    console.error("[payment]", e.message);
    return res.status(500).json({ error: "Ошибка при создании платежа. Попробуйте позже." });
  }
}
