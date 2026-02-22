// ============================================================
// PHOTOS API — загрузка фото в Supabase Storage
// Используется хиромантией и чтением ауры по фото
// ============================================================

const ENDPOINT = "/api/photos";

// ── Загрузить фото и сохранить метаданные ─────────────────
export const uploadPhoto = async ({ telegramId, type, base64, mimeType, reading }) => {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ telegram_id: telegramId, type, base64, mimeType, reading }),
  });
  if (!res.ok) throw new Error(`Photos API error: ${res.status}`);
  return res.json(); // { ok: true, url }
};

// ── История фото пользователя ────────────────────────────
export const getPhotos = async ({ telegramId, type, limit = 10 }) => {
  const params = new URLSearchParams({ id: String(telegramId) });
  if (type)  params.set("type",  type);
  if (limit) params.set("limit", String(limit));
  const res = await fetch(`${ENDPOINT}?${params}`);
  if (!res.ok) throw new Error(`Photos API error: ${res.status}`);
  return res.json(); // { photos: [...] }
};

const PhotosAPI = { uploadPhoto, getPhotos };
export default PhotosAPI;
