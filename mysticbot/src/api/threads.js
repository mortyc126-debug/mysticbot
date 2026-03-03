// ============================================================
// ФРОНТЕНД-КЛИЕНТ — Нити Судьбы
// Обращается к /api/threads (Vercel serverless)
// ============================================================
import TelegramSDK from "./telegram";

function getAuthHeaders() {
  const initData = TelegramSDK.getInitData();
  const headers  = { "Content-Type": "application/json" };
  if (initData) headers["x-telegram-init-data"] = initData;
  return headers;
}

/** Мои активные нити (входящие + исходящие) */
export async function fetchMyThreads() {
  try {
    const res = await fetch("/api/threads", { method: "GET", headers: getAuthHeaders() });
    if (!res.ok) return null;
    return await res.json(); // { outgoing, incoming }
  } catch (e) {
    console.warn("[Threads] fetchMyThreads:", e.message);
    return null;
  }
}

/** Совместимые пользователи для новой нити */
export async function discoverSouls() {
  try {
    const res = await fetch("/api/threads?discover=1", { method: "GET", headers: getAuthHeaders() });
    if (!res.ok) return null;
    return await res.json(); // { souls: [...] }
  } catch (e) {
    console.warn("[Threads] discoverSouls:", e.message);
    return null;
  }
}

/**
 * Протянуть нить к пользователю.
 * @param {string|number} toId  — telegram_id получателя
 * @param {string}        signal — анонимное послание (до 100 символов, необязательно)
 */
export async function createThread(toId, signal = "") {
  try {
    const res = await fetch("/api/threads", {
      method:  "POST",
      headers: getAuthHeaders(),
      body:    JSON.stringify({ to_id: toId, signal: signal || null }),
    });
    const json = await res.json();
    if (!res.ok) return { error: json.error || "Ошибка" };
    return json; // { thread, is_mutual, compatibility }
  } catch (e) {
    console.warn("[Threads] createThread:", e.message);
    return { error: "Нет соединения" };
  }
}

/**
 * Оборвать нить.
 * @param {string|number} toId — telegram_id, к которому была нить
 */
export async function deleteThread(toId) {
  try {
    const params = new URLSearchParams({ to_id: toId });
    const res    = await fetch(`/api/threads?${params}`, {
      method:  "DELETE",
      headers: getAuthHeaders(),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    console.warn("[Threads] deleteThread:", e.message);
    return null;
  }
}

/**
 * Загружает историю сообщений с пользователем.
 * @param {string|number} withId — telegram_id собеседника
 * @param {string}        after  — ISO-дата: только сообщения после этого момента
 */
export async function fetchChatMessages(withId, after = null) {
  try {
    const q = { chat: "1", with_id: withId };
    if (after) q.after = after;
    const res = await fetch(`/api/threads?${new URLSearchParams(q)}`, {
      method:  "GET",
      headers: getAuthHeaders(),
    });
    if (!res.ok) return null;
    return await res.json(); // { messages: [...] }
  } catch (e) {
    console.warn("[Chat] fetchChatMessages:", e.message);
    return null;
  }
}

/**
 * Кол-во непрочитанных сообщений во всех чатах.
 * @param {string} after — ISO-дата: считать только сообщения после этого момента
 */
export async function fetchUnreadCount(after = null) {
  try {
    const q = { unread: "1" };
    if (after) q.after = after;
    const res = await fetch(`/api/threads?${new URLSearchParams(q)}`, {
      method:  "GET",
      headers: getAuthHeaders(),
    });
    if (!res.ok) return 0;
    const json = await res.json();
    return json.count || 0;
  } catch (e) {
    console.warn("[Chat] fetchUnreadCount:", e.message);
    return 0;
  }
}

/**
 * Отправить сообщение в анонимный чат.
 * @param {string|number} toId — telegram_id получателя
 * @param {string}        text — текст (1–500 символов)
 */
export async function sendChatMessage(toId, text) {
  try {
    const res = await fetch("/api/threads", {
      method:  "POST",
      headers: getAuthHeaders(),
      body:    JSON.stringify({ action: "chat", to_id: toId, text }),
    });
    const json = await res.json();
    if (!res.ok) return { error: json.error || "Ошибка" };
    return json; // { message }
  } catch (e) {
    console.warn("[Chat] sendChatMessage:", e.message);
    return { error: "Нет соединения" };
  }
}
