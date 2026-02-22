// POST /api/diary  — сохранить запись дневника
// GET  /api/diary?id=<telegram_id>&limit=100  — список записей
import { getSupabase } from "./_supabase.js";
import { resolveUserId } from "./_auth.js";
import {
  setCorsHeaders, setSecurityHeaders,
  capLimit, checkBodySize, sanitizeDiaryEntry, rateLimit,
} from "./_security.js";

export default async function handler(req, res) {
  setCorsHeaders(res, "GET, POST, OPTIONS");
  setSecurityHeaders(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const db = getSupabase();

    if (req.method === "GET") {
      const { id: rawId, limit = "100" } = req.query;
      const { ok, id, warn } = resolveUserId(req, rawId);
      if (!ok) return res.status(401).json({ error: warn || "id обязателен" });
      if (warn) console.warn("[/api/diary GET]", warn, id);

      const { data, error } = await db
        .from("mystic_diary")
        .select("entry, created_at")
        .eq("telegram_id", id)
        .order("created_at", { ascending: false })
        .limit(capLimit(limit, 200));

      if (error) throw error;

      const entries = (data || [])
        .map(r => r.entry)
        // TODO: старые зашифрованные записи (ENC:...) — пропускаем до ручной миграции через decrypt-diary.mjs
        .filter(e => e !== null && e !== undefined && !(typeof e === "string" && e.startsWith("ENC:")));
      return res.status(200).json({ entries });
    }

    if (req.method === "POST") {
      if (!checkBodySize(req.body, 64_000)) {
        return res.status(413).json({ error: "Слишком большой запрос" });
      }

      const { telegram_id: rawId, entries, ...singleEntry } = req.body || {};
      const { ok, id, warn } = resolveUserId(req, rawId);
      if (!ok) {
        console.warn("[/api/diary POST] auth failed:", warn, "| rawId:", rawId);
        return res.status(401).json({ error: warn || "telegram_id обязателен" });
      }
      if (warn) console.warn("[/api/diary POST]", warn, id);
      console.log("[/api/diary POST] user:", id, "| bulk:", Array.isArray(entries), "| fields:", Object.keys(singleEntry).join(","));

      // Rate limit: 20 запросов в минуту на пользователя
      if (!rateLimit(`diary_post_${id}`, 20, 60_000)) {
        return res.status(429).json({ error: "Слишком много запросов" });
      }

      // Bulk insert (миграция старых записей) — без шифрования (legacy data)
      if (Array.isArray(entries) && entries.length > 0) {
        const rows = entries.slice(0, 500).map(e => ({
          telegram_id: id,
          entry: e,
          created_at: e.date || new Date().toISOString(),
        }));
        const { error } = await db.from("mystic_diary").insert(rows);
        if (error) {
          console.error("[/api/diary POST bulk] DB error:", error.message, "| code:", error.code);
          throw error;
        }
        console.log("[/api/diary POST bulk] saved", rows.length, "entries for user:", id);
        return res.status(200).json({ ok: true, count: rows.length });
      }

      // Одиночная запись — санитизация (без шифрования: данные видны в дашборде Supabase)
      const clean = sanitizeDiaryEntry(singleEntry);
      if (!clean) {
        console.warn("[/api/diary POST] sanitizeDiaryEntry returned null | fields:", Object.keys(singleEntry).join(","));
        return res.status(400).json({ error: "Некорректные данные записи" });
      }

      const { error } = await db
        .from("mystic_diary")
        .insert({
          telegram_id: id,
          entry: clean,
          created_at: clean.date || new Date().toISOString(),
        });

      if (error) {
        console.error("[/api/diary POST single] DB error:", error.message, "| code:", error.code);
        throw error;
      }
      console.log("[/api/diary POST single] saved for user:", id);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (e) {
    console.error("[/api/diary]", e.message);
    return res.status(500).json({ error: "Внутренняя ошибка сервера" });
  }
}
