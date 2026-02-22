// ============================================================
// TELEGRAM WEBAPP SDK WRAPPER
// ============================================================
//
// ШАГ 1: Раскомментировать строку в index.html:
//   <script src="https://telegram.org/js/telegram-web-app.js"></script>
//
// ШАГ 2: TelegramSDK.init() уже вызывается в App.jsx —
//   ничего больше делать не нужно, SDK подхватится автоматически.
//
// ============================================================

const getTg = () => window.Telegram?.WebApp || null;

// Хранилище последних callback'ов кнопок — без использования приватных свойств SDK
let _mainBtnCallback = null;
let _backBtnCallbacks = [];

const TelegramSDK = {
  // ── Инициализация ──────────────────────────────────────────
  init() {
    const tg = getTg();
    if (!tg) return false;
    tg.ready();
    tg.expand();
    try { tg.setHeaderColor("#0a0a0f"); } catch {}
    try { tg.setBackgroundColor("#0a0a0f"); } catch {}
    return true;
  },

  // ── Доступность SDK ────────────────────────────────────────
  isAvailable: () => !!getTg(),

  // ── Данные пользователя Telegram ───────────────────────────
  getUser: () => getTg()?.initDataUnsafe?.user || null,
  getInitData: () => getTg()?.initData || "",

  // ── Haptic feedback ────────────────────────────────────────
  haptic: {
    // style: "light" | "medium" | "heavy" | "rigid" | "soft"
    impact(style = "medium") {
      try { getTg()?.HapticFeedback?.impactOccurred(style); } catch {}
    },
    // type: "error" | "success" | "warning"
    notification(type = "success") {
      try { getTg()?.HapticFeedback?.notificationOccurred(type); } catch {}
    },
    selection() {
      try { getTg()?.HapticFeedback?.selectionChanged(); } catch {}
    },
  },

  // ── MainButton (нижняя кнопка Telegram) ────────────────────
  mainButton: {
    show(text, callback) {
      const btn = getTg()?.MainButton;
      if (!btn) return;
      // Снимаем предыдущий listener перед добавлением нового
      if (_mainBtnCallback) {
        btn.offClick(_mainBtnCallback);
      }
      _mainBtnCallback = callback;
      btn.setText(text);
      btn.onClick(callback);
      btn.show();
    },
    hide() {
      const btn = getTg()?.MainButton;
      if (!btn) return;
      if (_mainBtnCallback) {
        btn.offClick(_mainBtnCallback);
        _mainBtnCallback = null;
      }
      btn.hide();
    },
    setLoading(loading) {
      const btn = getTg()?.MainButton;
      if (!btn) return;
      loading ? btn.showProgress(false) : btn.hideProgress();
    },
    setColor(color) { try { getTg()?.MainButton?.setParams({ color }); } catch {} },
  },

  // ── BackButton ─────────────────────────────────────────────
  backButton: {
    show(callback) {
      const btn = getTg()?.BackButton;
      if (!btn) return;
      // Снимаем все предыдущие listeners (каждый show() регистрировал новый)
      _backBtnCallbacks.forEach(cb => btn.offClick(cb));
      _backBtnCallbacks = [callback];
      btn.onClick(callback);
      btn.show();
    },
    hide() {
      const btn = getTg()?.BackButton;
      if (!btn) return;
      _backBtnCallbacks.forEach(cb => btn.offClick(cb));
      _backBtnCallbacks = [];
      btn.hide();
    },
  },

  // ── Диалоги ────────────────────────────────────────────────
  showAlert(message, callback) {
    const tg = getTg();
    if (tg) { tg.showAlert(message, callback); }
    else { alert(message); if (callback) callback(); }
  },
  showConfirm(message, callback) {
    const tg = getTg();
    if (tg) { tg.showConfirm(message, callback); }
    else { callback(window.confirm(message)); }
  },
  showPopup(params, callback) {
    const tg = getTg();
    if (tg) { tg.showPopup(params, callback); }
    else { callback(null); }
  },

  // ── Ссылки и шаринг ────────────────────────────────────────
  openLink(url, options = {}) {
    const tg = getTg();
    if (tg) { tg.openLink(url, options); }
    else { window.open(url, "_blank"); }
  },
  openTelegramLink(url) {
    const tg = getTg();
    if (tg) { tg.openTelegramLink(url); }
    else { window.open(url, "_blank"); }
  },

  // ── Push-уведомления через Bot API ────────────────────────
  // Бэкенд: POST /api/notifications
  // Telegram не даёт WebApp запрашивать разрешение — бот сам шлёт сообщения.
  // Условие: пользователь должен был хоть раз написать боту /start.
  notifications: {
    // Отправить уведомление через бэкенд (POST /api/notifications)
    // type:    "daily_horoscope" | "daily_card" | "streak_warning" |
    //          "astro_event"     | "tarot_reminder" | "dream_reminder" |
    //          "rune_reminder"   | "moon_event"     | "custom"
    // context: { sign?, streak?, card_name?, event_label?, event_ritual?, phase?, message? }
    async send({ type = "daily_horoscope", context = {} } = {}) {
      const tg = getTg();
      const initData = tg?.initData || "";
      const userId = tg?.initDataUnsafe?.user?.id;
      if (!userId) {
        console.warn("[Notifications] userId недоступен — пропускаем");
        return false;
      }
      try {
        const headers = { "Content-Type": "application/json" };
        if (initData) headers["x-telegram-init-data"] = initData;
        const res = await fetch("/api/notifications", {
          method: "POST",
          headers,
          body: JSON.stringify({ telegram_id: String(userId), type, context }),
        });
        if (!res.ok) return false;
        const data = await res.json();
        return data.ok === true;
      } catch (e) {
        console.warn("[Notifications] Ошибка отправки:", e.message);
        return false;
      }
    },
  },

  // ── Платёжный попап (вызывается с invoice_link от BotFather/бэкенда) ──
  openInvoice(invoiceLink, callback) {
    const tg = getTg();
    if (tg) {
      tg.openInvoice(invoiceLink, callback);
    } else {
      console.log("[Payments] openInvoice:", invoiceLink);
      callback && callback("cancelled");
    }
  },

  // ── Закрыть приложение ─────────────────────────────────────
  close() { getTg()?.close(); },

  // ── Цвет темы ─────────────────────────────────────────────
  colorScheme: () => getTg()?.colorScheme || "dark",
  themeParams: () => getTg()?.themeParams || {},
};

export default TelegramSDK;
