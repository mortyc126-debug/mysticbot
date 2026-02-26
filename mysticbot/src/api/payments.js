// ============================================================
// TELEGRAM PAYMENTS — ИНТЕГРАЦИЯ С ЮKASSA
// ============================================================
//
// СХЕМА РАБОТЫ:
// 1. Клиент вызывает openSubscriptionPayment / openLuckPayment
// 2. Фронт шлёт POST /api/payment → бэкенд создаёт платёж в ЮKassa
// 3. Бэкенд возвращает confirmation_url → фронт открывает его через openLink()
// 4. Пользователь оплачивает на странице ЮKassa
// 5. ЮKassa вызывает POST /api/payment-webhook → бэкенд активирует подписку/удачу
// 6. Пользователь возвращается в приложение; данные обновятся при следующей загрузке
//
// НАСТРОЙКА:
//   Vercel env vars: YOOKASSA_SHOP_ID, YOOKASSA_SECRET_KEY
//   ЮKassa личный кабинет → Интеграция → Уведомления → URL: https://<your-app>.vercel.app/api/payment?hook=1
// ============================================================

import TelegramSDK from "./telegram.js";

// ── Прайсы (отображение на UI) ─────────────────────────────

export const SUBSCRIPTION_PRICES = {
  vip: {
    amount: 249,
    currency: "RUB",
    label: "VIP",
    description: "VIP подписка на 1 месяц",
    emoji: "⭐",
    features: ["Расклад на 3 карты · Расклад Отношения", "✨ Аура · ᚠ Руны (1 руна)", "Совместимость знаков · Лунный календарь", "2× очки удачи · VIP гороскоп"],
  },
  premium: {
    amount: 499,
    currency: "RUB",
    label: "Премиум",
    description: "Премиум подписка на 1 месяц",
    emoji: "👑",
    features: ["Все расклады Таро (Кельтский крест, Звезда)", "🖐 Хиромантия · 📸 Аура по фото", "⭐ Натальная карта · 🌙 Расшифровка снов", "🔮 Персональный оракул (чат) · Руны×3"],
  },
};

export const LUCK_PACKAGES = [
  { id: "luck_50",  luck: 50,  price: 49,  description: "50 звёзд удачи",  emoji: "💫" },
  { id: "luck_120", luck: 120, price: 99,  description: "120 звёзд удачи", emoji: "🌟" },
  { id: "luck_300", luck: 300, price: 199, description: "300 звёзд удачи", emoji: "✨" },
];

export const REWRITE_PRICES = [99, 199, 399]; // 1-й, 2-й, 3-й перезапрос к Таро

// ── Внутренний вызов бэкенда ───────────────────────────────

const PENDING_PAYMENT_KEY = "mystic_pending_payment";

const createPayment = async (type, params = {}) => {
  const initData = TelegramSDK.getInitData();
  const headers = { "Content-Type": "application/json" };
  if (initData) headers["x-telegram-init-data"] = initData;

  const res = await fetch("/api/payment", {
    method: "POST",
    headers,
    body: JSON.stringify({ type, ...params }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Ошибка сервера: ${res.status}`);
  return data; // { ok, payment_id, confirmation_url }
};

// Сохранить ожидающий платёж — чтобы после возврата проверить его статус
const savePendingPayment = (paymentId, type, extra = {}) => {
  try {
    localStorage.setItem(PENDING_PAYMENT_KEY, JSON.stringify({
      payment_id:  paymentId,
      type,
      created_at:  Date.now(),
      ...extra,
    }));
  } catch (_) { /* localStorage может быть недоступен */ }
};

// Очистить ожидающий платёж
export const clearPendingPayment = () => {
  try { localStorage.removeItem(PENDING_PAYMENT_KEY); } catch (_) {}
};

// Проверить статус ожидающего платежа.
// Возвращает: { succeeded: true, type, metadata } | { canceled: true } | { pending: true } | null
export const checkPendingPayment = async () => {
  let raw;
  try { raw = localStorage.getItem(PENDING_PAYMENT_KEY); } catch (_) { return null; }
  if (!raw) return null;

  let pending;
  try { pending = JSON.parse(raw); } catch (_) { clearPendingPayment(); return null; }

  // Срок жизни — 2 часа
  if (!pending.payment_id || Date.now() - (pending.created_at || 0) > 2 * 60 * 60 * 1000) {
    clearPendingPayment();
    return null;
  }

  try {
    const initData = TelegramSDK.getInitData();
    const headers = {};
    if (initData) headers["x-telegram-init-data"] = initData;

    const res = await fetch(`/api/payment?status=${encodeURIComponent(pending.payment_id)}`, { headers });
    if (!res.ok) return null;

    const data = await res.json().catch(() => ({}));

    if (data.status === "succeeded") {
      clearPendingPayment();
      return { succeeded: true, type: pending.type, metadata: data.metadata || {} };
    }
    if (data.status === "canceled") {
      clearPendingPayment();
      return { canceled: true };
    }
    return { pending: true };
  } catch (_) {
    return null;
  }
};

// ── Оплата подписки ───────────────────────────────────────
// paymentMethod: "bank_card" | "sbp" | "yoo_money" | null (все методы)
// Возвращает: { success: true, pending: true, payment_id } если ссылка открыта
//             { success: false, error } при ошибке
export const openSubscriptionPayment = async (tier, _onSuccess, paymentMethod = null) => {
  try {
    const data = await createPayment("subscription", { tier, payment_method: paymentMethod });
    if (!data.confirmation_url) return { success: false, error: "Нет ссылки на оплату" };

    // Сохраняем платёж — после возврата пользователя проверим статус
    savePendingPayment(data.payment_id, "subscription", { tier });

    // Открываем страницу оплаты ЮKassa в браузере/Telegram
    TelegramSDK.openLink(data.confirmation_url, { try_instant_view: false });

    return { success: true, pending: true, payment_id: data.payment_id };

  } catch (e) {
    console.error("[Payments] subscription error:", e.message);
    return { success: false, error: e.message };
  }
};

// ── Оплата очков удачи ────────────────────────────────────
// paymentMethod: "bank_card" | "sbp" | "yoo_money" | null (все методы)
export const openLuckPayment = async (packageId, _onSuccess, paymentMethod = null) => {
  const pkg = LUCK_PACKAGES.find(p => p.id === packageId);
  if (!pkg) return { success: false, error: "Пакет не найден" };

  try {
    const data = await createPayment("luck", { packageId, payment_method: paymentMethod });
    if (!data.confirmation_url) return { success: false, error: "Нет ссылки на оплату" };

    // Сохраняем платёж — после возврата пользователя проверим статус
    savePendingPayment(data.payment_id, "luck", { packageId, luck: pkg.luck });

    TelegramSDK.openLink(data.confirmation_url, { try_instant_view: false });

    return { success: true, pending: true, payment_id: data.payment_id };

  } catch (e) {
    console.error("[Payments] luck error:", e.message);
    return { success: false, error: e.message };
  }
};

// ── Оплата перезаписи гадания ─────────────────────────────
// rewriteIndex: 0 (99₽), 1 (199₽), 2 (399₽)
// Перезапись — разовый платёж, пока реализован как пакет удачи-заменитель.
// TODO: добавить отдельный type="rewrite" в /api/payment если нужна отдельная логика.
export const openRewritePayment = async (rewriteIndex, _onSuccess) => {
  const price = REWRITE_PRICES[rewriteIndex] ?? 99;
  console.log(`[Payments] Перезапись гадания: ${price}₽ — функция ещё не подключена к бэкенду`);
  return { success: false, pending: true };
};

const PaymentsAPI = {
  openSubscriptionPayment,
  openLuckPayment,
  openRewritePayment,
  checkPendingPayment,
  clearPendingPayment,
  SUBSCRIPTION_PRICES,
  LUCK_PACKAGES,
  REWRITE_PRICES,
};

export default PaymentsAPI;
