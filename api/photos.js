// POST /api/photos — загрузить фото в Supabase Storage и сохранить метаданные
// GET  /api/photos?id=<telegram_id>&type=<type>&limit=10 — история фото
import { getSupabase } from "./_supabase.js";
import { resolveUserId } from "./_auth.js";
import { setCorsHeaders, setSecurityHeaders, rateLimit } from "./_security.js";

const BUCKET    = "mystic-photos";
const MAX_BYTES = 5 * 1024 * 1024; // 5 МБ

// Разрешённые MIME-типы для загрузки фото (только изображения)
const ALLOWED_MIME_TYPES = new Map([
  ["image/jpeg", "jpg"],
  ["image/jpg",  "jpg"],
  ["image/png",  "png"],
  ["image/webp", "webp"],
  ["image/heic", "heic"],
  ["image/heif", "heif"],
]);

export default async function handler(req, res) {
  setCorsHeaders(res, "GET, POST, OPTIONS");
  setSecurityHeaders(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const db = getSupabase();

    // GET — история фото пользователя
    if (req.method === "GET") {
      const { id: rawId, type, limit = "10" } = req.query;
      const { ok, id, warn } = resolveUserId(req, rawId);
      if (!ok) return res.status(401).json({ error: warn || "id обязателен" });
      if (warn) console.warn("[/api/photos GET]", warn, id);

      let query = db
        .from("mystic_photos")
        .select("id, type, url, reading, created_at")
        .eq("telegram_id", id)
        .order("created_at", { ascending: false })
        .limit(Math.min(parseInt(limit) || 10, 50));

      if (type) query = query.eq("type", type);

      const { data, error } = await query;
      if (error) throw error;
      return res.status(200).json({ photos: data || [] });
    }

    // POST — загрузить фото
    if (req.method === "POST") {
      const { telegram_id: rawId, type, base64, mimeType, reading } = req.body || {};
      const { ok, id, warn } = resolveUserId(req, rawId);
      if (!ok) return res.status(401).json({ error: warn || "telegram_id обязателен" });
      if (warn) console.warn("[/api/photos POST]", warn, id);

      if (!type || !["palmistry", "aura"].includes(type)) {
        return res.status(400).json({ error: "type должен быть 'palmistry' или 'aura'" });
      }
      if (!base64) return res.status(400).json({ error: "base64 обязателен" });

      // Rate limit: 10 загрузок в минуту
      if (!rateLimit(`photos_post_${id}`, 10, 60_000)) {
        return res.status(429).json({ error: "Слишком много запросов" });
      }

      // Проверка размера (base64 → ~75% от байт)
      const approxBytes = Math.ceil(base64.length * 0.75);
      if (approxBytes > MAX_BYTES) {
        return res.status(413).json({ error: "Фото слишком большое (максимум 5 МБ)" });
      }

      // Валидация mimeType: только разрешённые типы изображений
      const safeMime = mimeType && typeof mimeType === "string" ? mimeType.toLowerCase().trim() : "image/jpeg";
      if (!ALLOWED_MIME_TYPES.has(safeMime)) {
        return res.status(400).json({ error: "Неподдерживаемый тип файла. Разрешены: JPEG, PNG, WebP, HEIC" });
      }

      // Путь в Storage: {telegram_id}/{type}/{timestamp}.{ext}
      const ext = ALLOWED_MIME_TYPES.get(safeMime);
      const filePath = `${id}/${type}/${Date.now()}.${ext}`;
      const buffer = Buffer.from(base64, "base64");

      const { error: uploadError } = await db.storage
        .from(BUCKET)
        .upload(filePath, buffer, { contentType: safeMime, upsert: false });

      if (uploadError) {
        console.error("[/api/photos] Storage upload:", uploadError.message);
        throw uploadError;
      }

      const { data: { publicUrl } } = db.storage.from(BUCKET).getPublicUrl(filePath);

      // Сохраняем метаданные в таблицу
      const { error: insertError } = await db
        .from("mystic_photos")
        .insert({
          telegram_id: id,
          type,
          url: publicUrl,
          reading: reading ? String(reading).slice(0, 2000) : null,
          created_at: new Date().toISOString(),
        });

      if (insertError) {
        console.error("[/api/photos] DB insert:", insertError.message);
        throw insertError;
      }

      console.log("[/api/photos POST] saved:", type, "user:", id);
      return res.status(200).json({ ok: true, url: publicUrl });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (e) {
    console.error("[/api/photos]", e.message);
    return res.status(500).json({ error: "Внутренняя ошибка сервера" });
  }
}
