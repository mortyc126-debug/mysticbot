// ============================================================
// ФРОНТЕНД-КЛИЕНТ — Ритуал дня
// ============================================================
import TelegramSDK from "./telegram";

function getAuthHeaders() {
  const initData = TelegramSDK.getInitData();
  const headers  = { "Content-Type": "application/json" };
  if (initData) headers["x-telegram-init-data"] = initData;
  return headers;
}

/**
 * Загружает статус текущего ритуала.
 * @returns {{ ritual_id, total_count, participated, element_stats } | null}
 */
export async function fetchRitual(withStats = false) {
  try {
    const params = withStats ? "?stats=1" : "";
    const res    = await fetch(`/api/ritual${params}`, {
      method:  "GET",
      headers: getAuthHeaders(),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    console.warn("[Ritual] fetchRitual:", e.message);
    return null;
  }
}

/**
 * Принять участие в сегодняшнем ритуале.
 * @returns {{ ok: boolean, total_count: number } | { error: string }}
 */
export async function joinRitual() {
  try {
    const res = await fetch("/api/ritual", {
      method:  "POST",
      headers: getAuthHeaders(),
      body:    JSON.stringify({}),
    });
    const json = await res.json();
    if (!res.ok) return { error: json.error || "Ошибка" };
    return json;
  } catch (e) {
    console.warn("[Ritual] joinRitual:", e.message);
    return { error: "Нет соединения" };
  }
}
