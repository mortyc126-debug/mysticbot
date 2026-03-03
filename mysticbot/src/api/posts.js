// ============================================================
// ФРОНТЕНД-КЛИЕНТ — Мистическое сообщество
// Обращается к /api/posts (Vercel serverless)
// ============================================================
import TelegramSDK from "./telegram";

function getAuthHeaders() {
  const initData = TelegramSDK.getInitData();
  const headers  = { "Content-Type": "application/json" };
  if (initData) headers["x-telegram-init-data"] = initData;
  return headers;
}

/**
 * Загружает ленту постов сообщества.
 * @param {string} type   — "all" | "prophecy" | "ritual" | "reflection" | "confession"
 * @param {number} page   — страница (0-based)
 * @param {string} circle — "fire"|"earth"|"air"|"water"|null (фильтр по стихии)
 * @returns {{ posts: Array, page: number, has_more: boolean } | null}
 */
export async function fetchPosts(type = "all", page = 0, circle = null) {
  try {
    const q = { feed: "1", type, page };
    if (circle) q.circle = circle;
    const params = new URLSearchParams(q);
    const res    = await fetch(`/api/posts?${params}`, {
      method:  "GET",
      headers: getAuthHeaders(),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    console.warn("[Posts] fetchPosts error:", e.message);
    return null;
  }
}

/**
 * Публикует новый мистический пост.
 * @param {string} type — "prophecy" | "ritual" | "reflection" | "confession"
 * @param {string} text — текст поста (10–500 символов)
 * @returns {{ post: object } | { error: string }}
 */
export async function createPost(type, text) {
  try {
    const res = await fetch("/api/posts", {
      method:  "POST",
      headers: getAuthHeaders(),
      body:    JSON.stringify({ type, text }),
    });
    const json = await res.json();
    if (!res.ok) return { error: json.error || "Ошибка публикации" };
    return json;
  } catch (e) {
    console.warn("[Posts] createPost error:", e.message);
    return { error: "Нет соединения" };
  }
}

/**
 * Реагирует на пост (энергия, верификация, опровержение).
 * Повторный вызов с той же реакцией — снимает её (toggle).
 * @param {string} postId    — UUID поста
 * @param {string} reaction  — "energy" | "verified" | "disputed"
 * @returns {{ ok: boolean, toggled: "on"|"off", reaction: string } | null}
 */
export async function reactToPost(postId, reaction) {
  try {
    const res = await fetch("/api/posts", {
      method:  "PATCH",
      headers: getAuthHeaders(),
      body:    JSON.stringify({ post_id: postId, reaction }),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    console.warn("[Posts] reactToPost error:", e.message);
    return null;
  }
}
