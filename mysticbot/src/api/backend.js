// ============================================================
// BACKEND API — Supabase через Vercel Serverless Functions
// ============================================================

import TelegramSDK from "./telegram";

// Получить или создать уникальный ID пользователя:
// — Telegram user ID (если открыто в Telegram)
// — иначе UUID из localStorage (fallback для браузера)
export const getUserId = () => {
  const tgUser = TelegramSDK.getUser();
  if (tgUser?.id) return String(tgUser.id);

  let uid = localStorage.getItem("mystic_uid");
  if (!uid) {
    // Используем crypto.randomUUID() для криптографически безопасного UUID
    uid = "browser_" + (
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID().replace(/-/g, "")
        : Math.random().toString(36).slice(2) + Date.now().toString(36)
    );
    localStorage.setItem("mystic_uid", uid);
  }
  return uid;
};

// ── Вспомогательный fetch ──────────────────────────────────
const apiFetch = async (path, method = "GET", body = null) => {
  // Прикрепляем initData для верификации на бэкенде
  const initData = TelegramSDK.getInitData();
  const headers = { "Content-Type": "application/json" };
  if (initData) headers["x-telegram-init-data"] = initData;

  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Backend ${method} ${path}: ${res.status}`);
  }
  return res.json();
};

// ── Пользователь ──────────────────────────────────────────

// Синхронизировать профиль пользователя с Supabase
export const syncUser = async (userData) => {
  try {
    const uid = getUserId();
    await apiFetch("/api/user", "POST", { telegram_id: uid, ...userData });
    return true;
  } catch (e) {
    console.warn("[Backend] syncUser fallback:", e.message);
    return null;
  }
};

// Загрузить профиль пользователя из Supabase
export const fetchUser = async () => {
  try {
    const uid = getUserId();
    const data = await apiFetch(`/api/user?id=${encodeURIComponent(uid)}`);
    return data.user || null;
  } catch (e) {
    console.warn("[Backend] fetchUser fallback:", e.message);
    return null;
  }
};

// Обновить отдельные поля пользователя
export const updateUserField = async (fields) => {
  return syncUser(fields);
};

// ── Таро ─────────────────────────────────────────────────

// Сохранить гадание в Supabase
export const saveTarotReading = async (reading) => {
  try {
    const uid = getUserId();
    await apiFetch("/api/tarot", "POST", { telegram_id: uid, ...reading });
    return true;
  } catch (e) {
    console.error("[Backend] saveTarotReading error:", e.message, "| uid:", getUserId());
    return null;
  }
};

// Загрузить историю гаданий из Supabase
export const fetchTarotHistory = async (limit = 50) => {
  try {
    const uid = getUserId();
    const data = await apiFetch(`/api/tarot?id=${encodeURIComponent(uid)}&limit=${limit}`);
    return data.history || [];
  } catch (e) {
    console.warn("[Backend] fetchTarotHistory fallback:", e.message);
    return null;
  }
};

// ── Дневник ───────────────────────────────────────────────

// Сохранить запись дневника в Supabase
export const saveDiaryEntry = async (entry) => {
  try {
    const uid = getUserId();
    await apiFetch("/api/diary", "POST", { telegram_id: uid, ...entry });
    return true;
  } catch (e) {
    console.error("[Backend] saveDiaryEntry error:", e.message, "| uid:", getUserId());
    return null;
  }
};

// Загрузить записи дневника из Supabase
export const fetchDiary = async (limit = 100) => {
  try {
    const uid = getUserId();
    const data = await apiFetch(`/api/diary?id=${encodeURIComponent(uid)}&limit=${limit}`);
    return data.entries || [];
  } catch (e) {
    console.warn("[Backend] fetchDiary fallback:", e.message);
    return null;
  }
};

// Bulk-миграция истории гаданий (только если на сервере 0 записей)
export const migrateTarotHistory = async (readings) => {
  if (!readings || readings.length === 0) return true;
  try {
    const uid = getUserId();
    await apiFetch("/api/tarot", "POST", { telegram_id: uid, readings });
    return true;
  } catch (e) {
    console.warn("[Backend] migrateTarotHistory fallback:", e.message);
    return null;
  }
};

// Bulk-миграция записей дневника (только если на сервере 0 записей)
export const migrateDiaryEntries = async (entries) => {
  if (!entries || entries.length === 0) return true;
  try {
    const uid = getUserId();
    await apiFetch("/api/diary", "POST", { telegram_id: uid, entries });
    return true;
  } catch (e) {
    console.warn("[Backend] migrateDiaryEntries fallback:", e.message);
    return null;
  }
};

// ── Промокоды ─────────────────────────────────────────────

/**
 * Проверить кастомный промокод на сервере.
 * Возвращает { tier, duration } при успехе, или null если не найден/исчерпан.
 */
export const fetchCustomPromo = async (code) => {
  try {
    const normalizedCode = code.trim().toUpperCase();
    const data = await apiFetch(`/api/promo?code=${encodeURIComponent(normalizedCode)}`);
    return data.promo || null;
  } catch (e) {
    console.warn("[Backend] fetchCustomPromo fallback:", e.message);
    return null;
  }
};

/**
 * Атомарно активировать промокод (инкрементирует used_count на сервере).
 * Возвращает { ok: true, promo } при успехе, или { ok: false, error } при ошибке.
 */
export const useCustomPromo = async (code) => {
  try {
    const normalizedCode = code.trim().toUpperCase();
    const data = await apiFetch("/api/promo", "POST", { action: "use", code: normalizedCode });
    return data;
  } catch (e) {
    console.warn("[Backend] useCustomPromo fallback:", e.message);
    return { ok: false, error: "Ошибка сети" };
  }
};

/**
 * Создать кастомный промокод (только для админа).
 */
export const createServerPromo = async (code, tier, duration, maxUses) => {
  try {
    const data = await apiFetch("/api/promo", "POST", {
      action: "create",
      code: code.trim().toUpperCase(),
      tier,
      duration,
      max_uses: maxUses,
    });
    return data;
  } catch (e) {
    console.warn("[Backend] createServerPromo fallback:", e.message);
    return { ok: false, error: e.message || "Ошибка сети" };
  }
};

/**
 * Удалить кастомный промокод (только для админа).
 */
export const deleteServerPromo = async (code) => {
  try {
    await apiFetch("/api/promo", "DELETE", { code: code.trim().toUpperCase() });
    return true;
  } catch (e) {
    console.warn("[Backend] deleteServerPromo fallback:", e.message);
    return null;
  }
};

/**
 * Получить список кастомных промокодов (только для админа).
 * Возвращает массив объектов { code, tier, duration, max_uses, used_count, created_at }.
 */
export const fetchServerPromos = async () => {
  try {
    const data = await apiFetch("/api/promo?list=1");
    return data.promos || [];
  } catch (e) {
    console.warn("[Backend] fetchServerPromos fallback:", e.message);
    return [];
  }
};

// Заглушка — оставлена для обратной совместимости
export const verifyPromoCode = async (_code) => null;

// Зачислить нового пользователя рефералу — вызывается после завершения онбординга
export const registerReferral = async (referralCode, newUserName) => {
  try {
    const uid = getUserId();
    const data = await apiFetch("/api/referral", "POST", {
      referral_code: referralCode,
      new_user_name: newUserName || "Пользователь",
      telegram_id: uid,
    });
    return data.ok ? true : null;
  } catch (e) {
    console.warn("[Backend] registerReferral fallback:", e.message);
    return null;
  }
};

// Получить статистику пользователей (только для админа)
// Доступ определяется на бэкенде: telegram_id должен быть в ADMIN_TELEGRAM_IDS (env)
// Возвращает: { total, online, free, vip, premium, ... } при успехе
//             { __error: 403 } если доступ запрещён (нет в ADMIN_TELEGRAM_IDS)
//             null при сетевой / иной ошибке
export const fetchUserStats = async () => {
  try {
    const initData = TelegramSDK.getInitData();
    const headers = { "Content-Type": "application/json" };
    if (initData) headers["x-telegram-init-data"] = initData;

    const res = await fetch("/api/admin", { method: "GET", headers });
    if (res.status === 403) return { __error: 403 };
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Status ${res.status}`);
    }
    return await res.json();
  } catch (e) {
    console.warn("[Backend] fetchUserStats fallback:", e.message);
    return null;
  }
};

export const trackEvent = async (_name, _params) => null;

// ── Память оракула ────────────────────────────────────────
// Сохраняем oracle_memory как поле внутри mystic_users.data
// (merge-логика в /api/user гарантирует что остальные поля не затрутся)

export const saveOracleMemory = async (memory) => {
  try {
    await apiFetch("/api/user", "POST", { telegram_id: getUserId(), oracle_memory: memory });
    return true;
  } catch (e) {
    console.warn("[Backend] saveOracleMemory fallback:", e.message);
    return null;
  }
};

export const fetchOracleMemory = async () => {
  try {
    const data = await apiFetch(`/api/user?id=${encodeURIComponent(getUserId())}`);
    return data?.user?.oracle_memory || null;
  } catch (e) {
    console.warn("[Backend] fetchOracleMemory fallback:", e.message);
    return null;
  }
};

// ── Лента ─────────────────────────────────────────────────

// Загрузить персональную ленту из Supabase
export const fetchFeed = async () => {
  try {
    const uid  = getUserId();
    const data = await apiFetch(`/api/feed?id=${encodeURIComponent(uid)}`);
    return data.feed || [];
  } catch (e) {
    console.warn("[Backend] fetchFeed fallback:", e.message);
    return [];
  }
};

// Поставить реакцию на пост ленты
export const reactFeed = async (feedId, reaction) => {
  try {
    const uid = getUserId();
    await apiFetch("/api/feed", "POST", { telegram_id: uid, feed_id: feedId, reaction });
    return true;
  } catch (e) {
    console.warn("[Backend] reactFeed fallback:", e.message);
    return null;
  }
};

const BackendAPI = {
  getUserId,
  syncUser,
  fetchUser,
  updateUserField,
  saveTarotReading,
  fetchTarotHistory,
  saveDiaryEntry,
  fetchDiary,
  migrateTarotHistory,
  migrateDiaryEntries,
  fetchCustomPromo,
  useCustomPromo,
  createServerPromo,
  deleteServerPromo,
  fetchServerPromos,
  verifyPromoCode,
  registerReferral,
  fetchUserStats,
  saveOracleMemory,
  fetchOracleMemory,
  fetchFeed,
  reactFeed,
  trackEvent,
};

export default BackendAPI;
