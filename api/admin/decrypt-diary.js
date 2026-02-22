// POST /api/admin/decrypt-diary — одноразовая миграция:
// расшифровывает все ENC:... записи в mystic_diary и сохраняет как plain JSONB.
// Защищён ADMIN_SECRET (задать в Vercel env).

import { getSupabase } from "../_supabase.js";
import { decryptObject } from "../_crypto.js";
import { setCorsHeaders, setSecurityHeaders } from "../_security.js";

const BATCH = 200; // сколько строк обрабатываем за раз

export default async function handler(req, res) {
  setCorsHeaders(res, "POST, OPTIONS");
  setSecurityHeaders(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // Проверяем секрет
  const secret = process.env.ADMIN_SECRET;
  const provided = req.headers["x-admin-secret"] || req.body?.secret;
  if (!secret || provided !== secret) {
    return res.status(403).json({ error: "Forbidden" });
  }

  try {
    const db = getSupabase();
    let offset = 0;
    let total = 0;
    let migrated = 0;
    let errors = 0;

    // Читаем всё постранично
    while (true) {
      const { data, error } = await db
        .from("mystic_diary")
        .select("id, entry")
        .range(offset, offset + BATCH - 1);

      if (error) throw error;
      if (!data || data.length === 0) break;

      total += data.length;

      // Фильтруем только зашифрованные (ENC:...)
      const encrypted = data.filter(
        r => typeof r.entry === "string" && r.entry.startsWith("ENC:")
      );

      for (const row of encrypted) {
        const plain = decryptObject(row.entry);
        if (!plain) {
          console.warn("[decrypt-diary] не удалось расшифровать id:", row.id);
          errors++;
          continue;
        }
        const { error: upErr } = await db
          .from("mystic_diary")
          .update({ entry: plain })
          .eq("id", row.id);

        if (upErr) {
          console.error("[decrypt-diary] ошибка обновления id:", row.id, upErr.message);
          errors++;
        } else {
          migrated++;
        }
      }

      if (data.length < BATCH) break;
      offset += BATCH;
    }

    console.log(`[decrypt-diary] total=${total} migrated=${migrated} errors=${errors}`);
    return res.status(200).json({ ok: true, total, migrated, errors });
  } catch (e) {
    console.error("[decrypt-diary]", e.message);
    return res.status(500).json({ error: e.message });
  }
}
