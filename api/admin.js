// ============================================================
// VERCEL SERVERLESS FUNCTION — Админ-панель
//
// GET  /api/admin?action=stats          — статистика пользователей
// POST /api/admin  { action: "decrypt-diary" } — миграция зашифрованных дневников
// ============================================================

import { getSupabase } from "./_supabase.js";
import { resolveUserId } from "./_auth.js";
import { isAdminId, setCorsHeaders, setSecurityHeaders, rateLimit, safeStringEqual } from "./_security.js";
import { decryptObject } from "./_crypto.js";

const ONLINE_MS = 5 * 60 * 1000;
const BATCH = 200;

// ── GET: статистика ─────────────────────────────────────────
async function handleStats(req, res) {
  const { ok, id } = resolveUserId(req, req.query?.admin_id || null);
  if (!ok || !isAdminId(id)) {
    return res.status(403).json({ error: "Доступ запрещён" });
  }

  if (!rateLimit(`admin_stats_${id}`, 20, 60_000)) {
    return res.status(429).json({ error: "Слишком много запросов" });
  }

  try {
    const db = getSupabase();
    const { data: rows, error } = await db
      .from("mystic_users")
      .select("telegram_id, data, updated_at");

    if (error) throw error;

    const now = Date.now();
    const stats = {
      total: 0, online: 0,
      free: 0, vip: 0, premium: 0,
      online_free: 0, online_vip: 0, online_premium: 0,
    };

    for (const row of rows || []) {
      if (!row.telegram_id) continue;
      const d = row.data || {};
      stats.total++;

      const tier = d.subscription_tier || "free";
      const until = d.subscription_until ? new Date(d.subscription_until).getTime() : 0;
      const tierKey =
        tier === "premium" && until > now ? "premium" :
        tier === "vip"     && until > now ? "vip"     : "free";
      stats[tierKey]++;

      const lastActive = row.updated_at
        ? new Date(row.updated_at).getTime()
        : (d.last_login ? new Date(d.last_login).getTime() : 0);
      if (lastActive && now - lastActive < ONLINE_MS) {
        stats.online++;
        stats[`online_${tierKey}`]++;
      }
    }

    return res.status(200).json(stats);
  } catch (e) {
    console.error("[/api/admin/stats]", e.message);
    return res.status(500).json({ error: "Внутренняя ошибка сервера" });
  }
}

// ── POST: расшифровка дневников ─────────────────────────────
async function handleDecryptDiary(req, res) {
  const secret = process.env.ADMIN_SECRET;
  const provided = req.headers["x-admin-secret"];
  if (!secret || !provided || !safeStringEqual(provided, secret)) {
    return res.status(403).json({ error: "Forbidden" });
  }

  try {
    const db = getSupabase();
    let offset = 0, total = 0, migrated = 0, errors = 0;

    while (true) {
      const { data, error } = await db
        .from("mystic_diary")
        .select("id, entry")
        .range(offset, offset + BATCH - 1);

      if (error) throw error;
      if (!data || data.length === 0) break;
      total += data.length;

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
    return res.status(500).json({ error: "Внутренняя ошибка" });
  }
}

// ── Роутинг ─────────────────────────────────────────────────
export default async function handler(req, res) {
  setCorsHeaders(res, "GET, POST, OPTIONS");
  setSecurityHeaders(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method === "GET") return handleStats(req, res);

  if (req.method === "POST") {
    const action = req.body?.action;
    if (action === "decrypt-diary") return handleDecryptDiary(req, res);
    return res.status(400).json({ error: "Unknown action" });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
