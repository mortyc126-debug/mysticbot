// POST /api/tarot  — сохранить гадание
// GET  /api/tarot?id=<telegram_id>&limit=50  — история гаданий
import { getSupabase } from "./_supabase.js";
import { resolveUserId } from "./_auth.js";
import {
  setCorsHeaders, setSecurityHeaders,
  capLimit, checkBodySize, sanitizeTarotReading, rateLimit,
} from "./_security.js";

export default async function handler(req, res) {
  setCorsHeaders(res, "GET, POST, OPTIONS");
  setSecurityHeaders(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const db = getSupabase();

    if (req.method === "GET") {
      const { id: rawId, limit = "50" } = req.query;
      const { ok, id, warn } = resolveUserId(req, rawId);
      if (!ok) return res.status(401).json({ error: warn || "id обязателен" });
      if (warn) console.warn("[/api/tarot GET]", warn, id);

      const { data, error } = await db
        .from("mystic_tarot")
        .select("reading, created_at")
        .eq("telegram_id", id)
        .order("created_at", { ascending: false })
        .limit(capLimit(limit, 200));

      if (error) throw error;
      return res.status(200).json({ history: (data || []).map(r => r.reading) });
    }

    if (req.method === "POST") {
      if (!checkBodySize(req.body, 64_000)) {
        return res.status(413).json({ error: "Слишком большой запрос" });
      }

      const { telegram_id: rawId, readings, ...singleReading } = req.body || {};
      const { ok, id, warn } = resolveUserId(req, rawId);
      if (!ok) {
        console.warn("[/api/tarot POST] auth failed:", warn, "| rawId:", rawId);
        return res.status(401).json({ error: warn || "telegram_id обязателен" });
      }
      if (warn) console.warn("[/api/tarot POST]", warn, id);
      console.log("[/api/tarot POST] user:", id, "| bulk:", Array.isArray(readings), "| spread:", singleReading.spreadId || singleReading.spread || "?");

      // Rate limit: 30 запросов в минуту на пользователя
      if (!rateLimit(`tarot_post_${id}`, 30, 60_000)) {
        return res.status(429).json({ error: "Слишком много запросов" });
      }

      // Bulk insert (миграция старых записей)
      if (Array.isArray(readings) && readings.length > 0) {
        const rows = readings.slice(0, 500).map(r => ({
          telegram_id: id,
          reading: r,
          created_at: r.date || new Date().toISOString(),
        }));
        const { error } = await db.from("mystic_tarot").insert(rows);
        if (error) throw error;
        return res.status(200).json({ ok: true, count: rows.length });
      }

      // Одиночная запись — санитизация входных данных
      const clean = sanitizeTarotReading(singleReading);
      if (!clean) return res.status(400).json({ error: "Некорректные данные расклада" });

      const { error } = await db
        .from("mystic_tarot")
        .insert({
          telegram_id: id,
          reading: clean,
          created_at: clean.date || new Date().toISOString(),
        });

      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (e) {
    console.error("[/api/tarot]", e.message);
    return res.status(500).json({ error: "Внутренняя ошибка сервера" });
  }
}
