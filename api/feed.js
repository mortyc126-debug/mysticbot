// ============================================================
// /api/feed — персональная мистическая лента
//
// GET  /api/feed          — получить ленту пользователя (7 дней)
// POST /api/feed          — реакция { feed_id, reaction: "like"|"dislike" }
// ============================================================
import { getSupabase }   from "./_supabase.js";
import { resolveUserId } from "./_auth.js";
import { setCorsHeaders, setSecurityHeaders, rateLimit } from "./_security.js";

export default async function handler(req, res) {
  setSecurityHeaders(res);
  setCorsHeaders(res, "GET, POST, OPTIONS");

  if (req.method === "OPTIONS") return res.status(204).end();

  const { ok, id } = resolveUserId(req, req.body?.telegram_id ?? req.query?.id ?? null);
  if (!ok) return res.status(401).json({ error: "Не авторизован" });

  const db = getSupabase();

  // ── GET: вернуть ленту ───────────────────────────────────
  if (req.method === "GET") {
    const since = new Date();
    since.setDate(since.getDate() - 7);

    const { data: posts, error } = await db
      .from("mystic_feed")
      .select("id, slot, feed_date, title, content, category, tags, created_at")
      .eq("telegram_id", id)
      .gte("feed_date", since.toISOString().slice(0, 10))
      .order("feed_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(30);

    if (error) {
      console.error("[feed GET]", error.message);
      return res.status(500).json({ error: "Ошибка загрузки ленты" });
    }

    // Подтянуть реакции пользователя одним запросом
    const ids = (posts || []).map(p => p.id);
    let reactionsMap = {};
    if (ids.length > 0) {
      const { data: reactions } = await db
        .from("mystic_feed_reactions")
        .select("feed_id, reaction")
        .eq("telegram_id", id)
        .in("feed_id", ids);
      (reactions || []).forEach(r => { reactionsMap[r.feed_id] = r.reaction; });
    }

    const feed = (posts || []).map(p => ({ ...p, my_reaction: reactionsMap[p.id] || null }));
    return res.status(200).json({ feed });
  }

  // ── POST: реакция ────────────────────────────────────────
  if (req.method === "POST") {
    if (!rateLimit(`feed_react_${id}`, 60, 60_000)) {
      return res.status(429).json({ error: "Слишком много запросов" });
    }

    const { feed_id, reaction } = req.body || {};
    if (!feed_id || !["like", "dislike"].includes(reaction)) {
      return res.status(400).json({ error: "feed_id и reaction обязательны" });
    }

    // Убедиться что пост принадлежит этому пользователю
    const { data: post } = await db
      .from("mystic_feed")
      .select("id")
      .eq("id", feed_id)
      .eq("telegram_id", id)
      .single();

    if (!post) return res.status(404).json({ error: "Пост не найден" });

    const { error } = await db
      .from("mystic_feed_reactions")
      .upsert(
        { telegram_id: id, feed_id, reaction, created_at: new Date().toISOString() },
        { onConflict: "telegram_id,feed_id" }
      );

    if (error) {
      console.error("[feed POST reaction]", error.message);
      return res.status(500).json({ error: "Ошибка сохранения реакции" });
    }

    return res.status(200).json({ ok: true });
  }

  return res.status(405).end();
}
