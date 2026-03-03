// GET    /api/promo?code=CODE  — проверить промокод (для всех пользователей)
// GET    /api/promo?list=1     — список всех промокодов (только для админа)
// POST   /api/promo            — активировать / создать промокод
// DELETE /api/promo            — удалить промокод (только для админа)
//
// Также обслуживает /api/referral (через rewrite _s=referral):
// POST   /api/referral         — зачислить нового пользователя рефералу
//
// SQL (выполнить один раз в Supabase Dashboard → SQL Editor):
//   CREATE TABLE IF NOT EXISTS mystic_promos (
//     code        TEXT PRIMARY KEY,
//     tier        TEXT NOT NULL DEFAULT 'vip',
//     duration    INTEGER NOT NULL DEFAULT 30,
//     max_uses    INTEGER NOT NULL DEFAULT 1,
//     used_count  INTEGER NOT NULL DEFAULT 0,
//     created_by  TEXT,
//     created_at  TIMESTAMPTZ DEFAULT NOW(),
//     last_used   TIMESTAMPTZ
//   );
//   ALTER TABLE mystic_promos ENABLE ROW LEVEL SECURITY;
//   CREATE POLICY "deny_anon_promos" ON mystic_promos FOR ALL TO anon USING (false);

import { getSupabase } from "./_supabase.js";
import { resolveUserId } from "./_auth.js";
import {
  isAdminId, setCorsHeaders, setSecurityHeaders,
  rateLimit, checkBodySize, validateString,
} from "./_security.js";

const VALID_TIERS = new Set(["vip", "premium"]);

// ── Referral handler (previously api/referral.js) ────────────
async function handleReferral(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  if (!checkBodySize(req.body, 4_000)) return res.status(413).json({ error: "Слишком большой запрос" });

  const { referral_code, new_user_name, telegram_id: rawId } = req.body || {};
  if (!referral_code) return res.status(400).json({ error: "referral_code обязателен" });

  if (!validateString(referral_code, 32) || !validateString(new_user_name, 100)) {
    return res.status(400).json({ error: "Некорректные данные" });
  }

  const { ok, id: newUserId } = resolveUserId(req, rawId);

  const ip = req.headers["x-forwarded-for"] || "unknown";
  if (!rateLimit(`referral_${ip}`, 5, 60 * 60_000)) {
    return res.status(429).json({ error: "Слишком много запросов" });
  }

  const db = getSupabase();

  try {
    const { data: rows, error: findErr } = await db
      .from("mystic_users")
      .select("telegram_id, data")
      .filter("data->>referral_code", "eq", referral_code)
      .limit(1);

    if (findErr) throw findErr;
    if (!rows || rows.length === 0) return res.status(200).json({ ok: false, reason: "code_not_found" });

    const referrer = rows[0];
    if (ok && newUserId && referrer.telegram_id === newUserId) {
      return res.status(200).json({ ok: false, reason: "self_referral" });
    }

    const existingFriends = referrer.data?.referral_friends || [];
    if (ok && newUserId && existingFriends.some(f => f.telegram_id === newUserId)) {
      return res.status(200).json({ ok: true, already: true });
    }

    const isFirstFriend = existingFriends.length === 0;
    const newFriend = {
      telegram_id: ok && newUserId ? newUserId : null,
      name: (new_user_name || "Пользователь").slice(0, 50),
      date: new Date().toISOString(),
    };

    const updatedData = { ...referrer.data, referral_friends: [...existingFriends, newFriend] };

    const bonusDays = isFirstFriend ? 3 : 1;
    const currentUntil = referrer.data?.subscription_until
      ? new Date(referrer.data.subscription_until)
      : new Date();
    const startFrom = currentUntil > new Date() ? currentUntil : new Date();

    const priorTier = referrer.data?.subscription_tier || "free";
    if (priorTier === "vip" && !referrer.data?.base_subscription_tier) {
      updatedData.base_subscription_tier  = "vip";
      updatedData.base_subscription_until = referrer.data?.subscription_until ?? null;
    }

    updatedData.subscription_tier  = "premium";
    updatedData.subscription_until = new Date(startFrom.getTime() + bonusDays * 24 * 60 * 60 * 1000).toISOString();

    const { error: updateErr } = await db
      .from("mystic_users")
      .update({ data: updatedData, updated_at: new Date().toISOString() })
      .eq("telegram_id", referrer.telegram_id);

    if (updateErr) throw updateErr;

    const token     = process.env.TELEGRAM_BOT_TOKEN;
    const webappUrl = process.env.WEBAPP_URL || null;
    if (token) {
      const friendName  = newFriend.name || "Пользователь";
      const rewardText  = isFirstFriend
        ? `🎁 Тебе начислено <b>+3 дня Премиум</b> в подарок!`
        : `🎁 Тебе начислен <b>+1 день Премиум</b> в подарок!`;
      const text        = `🎉 По твоей реферальной ссылке зарегистрировался <b>${friendName}</b>!\n\n${rewardText}\n\nПродолжай приглашать друзей — каждый следующий добавляет ещё +1 день ✨`;
      const replyMarkup = webappUrl
        ? { inline_keyboard: [[{ text: "🔮 Открыть МистикУм", web_app: { url: webappUrl } }]] }
        : null;
      const body = { chat_id: referrer.telegram_id, text, parse_mode: "HTML" };
      if (replyMarkup) body.reply_markup = replyMarkup;
      fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(body),
      }).catch(e => console.warn("[/api/referral] notification failed:", e.message));
    }

    console.log("[/api/referral] новый реферал", `(+${bonusDays} дн. Premium, друг #${existingFriends.length + 1})`);
    return res.status(200).json({ ok: true, reward: isFirstFriend ? "3_days_premium" : "1_day_premium" });
  } catch (e) {
    console.error("[/api/referral]", e.message);
    return res.status(500).json({ error: "Внутренняя ошибка сервера" });
  }
}

export default async function handler(req, res) {
  setCorsHeaders(res, "GET, POST, DELETE, OPTIONS");
  setSecurityHeaders(res);

  // Route referral requests (rewrite: /api/referral → /api/promo?_s=referral)
  if (req.query._s === "referral") return handleReferral(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const db = getSupabase();

    // ── GET ────────────────────────────────────────────────────────
    if (req.method === "GET") {
      const { code, list } = req.query;

      // Список промокодов — только для админа
      if (list === "1") {
        const { ok, id } = resolveUserId(req, null);
        if (!ok || !isAdminId(id)) {
          return res.status(403).json({ error: "Доступ запрещён" });
        }
        if (!rateLimit(`promo_list_${id}`, 30, 60_000)) {
          return res.status(429).json({ error: "Слишком много запросов" });
        }
        const { data, error } = await db
          .from("mystic_promos")
          .select("*")
          .order("created_at", { ascending: false });
        if (error) throw error;
        return res.status(200).json({ promos: data || [] });
      }

      // Проверка одного промокода (публичный, с rate limiting)
      if (!code || typeof code !== "string") {
        return res.status(400).json({ error: "Параметр code обязателен" });
      }

      // Rate limit — идентифицируем по верифицированному user_id или IP
      const { id: rateLimitId } = resolveUserId(req, null);
      const rlKey = `promo_check_${rateLimitId || req.headers["x-forwarded-for"] || "anon"}`;
      if (!rateLimit(rlKey, 10, 60_000)) {
        return res.status(429).json({ error: "Слишком много запросов" });
      }

      const normalizedCode = code.trim().toUpperCase().slice(0, 100);

      // Ищем промокод в Supabase (все промокоды создаются через админ-панель)
      const { data, error } = await db
        .from("mystic_promos")
        .select("tier, duration, max_uses, used_count")
        .eq("code", normalizedCode)
        .single();

      if (error && error.code !== "PGRST116") throw error;
      if (!data) return res.status(200).json({ promo: null });

      // Проверяем лимит использований
      if (data.max_uses > 0 && data.used_count >= data.max_uses) {
        return res.status(200).json({ promo: null, exhausted: true });
      }

      return res.status(200).json({
        promo: { tier: data.tier, duration: data.duration },
      });
    }

    // ── POST ───────────────────────────────────────────────────────
    if (req.method === "POST") {
      if (!checkBodySize(req.body, 4_000)) {
        return res.status(413).json({ error: "Слишком большой запрос" });
      }

      const { action, code, tier, duration, max_uses } = req.body || {};

      // Серверная активация промокода — обновляет подписку в БД атомарно.
      // Требует верифицированного telegram_id (x-telegram-init-data).
      if (action === "use") {
        // Авторизация обязательна — нам нужен telegram_id чтобы обновить подписку
        const { ok: userOk, id: userId } = resolveUserId(req, null);
        if (!userOk || !userId) {
          return res.status(401).json({ error: "Авторизация обязательна для активации промокода" });
        }

        const rlKey = `promo_use_${userId}`;
        if (!rateLimit(rlKey, 10, 60_000)) {
          return res.status(429).json({ error: "Слишком много запросов" });
        }

        if (!code || typeof code !== "string") {
          return res.status(400).json({ error: "Поле code обязательно" });
        }
        const normalizedCode = code.trim().toUpperCase().slice(0, 100);

        // Ищем промокод в Supabase (все промокоды создаются через админ-панель)
        const { data: dbPromoRow, error: fetchErr } = await db
          .from("mystic_promos")
          .select("tier, duration, max_uses, used_count")
          .eq("code", normalizedCode)
          .single();

        if (fetchErr && fetchErr.code !== "PGRST116") throw fetchErr;
        if (!dbPromoRow) {
          return res.status(200).json({ ok: false, error: "Промокод не найден" });
        }
        if (dbPromoRow.max_uses > 0 && dbPromoRow.used_count >= dbPromoRow.max_uses) {
          return res.status(200).json({ ok: false, error: "Промокод исчерпан (все активации использованы)" });
        }

        const promoInfo = { tier: dbPromoRow.tier, duration: dbPromoRow.duration };

        // 3. Проверяем не активировал ли пользователь уже этот код
        const { data: userRow, error: userFetchErr } = await db
          .from("mystic_users")
          .select("data")
          .eq("telegram_id", userId)
          .maybeSingle();

        if (userFetchErr) throw userFetchErr;

        const activatedPromos = userRow?.data?.activated_promos || [];
        if (activatedPromos.includes(normalizedCode)) {
          return res.status(200).json({ ok: false, error: "Промокод уже использован" });
        }

        // 4. Атомарный инкремент с оптимистичной блокировкой
        const { data: updateResult, error: updateErr } = await db
          .from("mystic_promos")
          .update({ used_count: dbPromoRow.used_count + 1, last_used: new Date().toISOString() })
          .eq("code", normalizedCode)
          .eq("used_count", dbPromoRow.used_count) // optimistic lock
          .select();

        if (updateErr) throw updateErr;

        // Если update затронул 0 строк — другой запрос уже перехватил этот слот
        if (!updateResult || updateResult.length === 0) {
          return res.status(200).json({ ok: false, error: "Промокод исчерпан (попробуй ещё раз)" });
        }

        // 5. Обновляем подписку пользователя в mystic_users (сервер — источник истины)
        const until = new Date();
        until.setDate(until.getDate() + promoInfo.duration);

        const updatedData = {
          ...(userRow?.data || {}),
          subscription_tier:  promoInfo.tier,
          subscription_until: until.toISOString(),
          activated_promos:   [...activatedPromos, normalizedCode],
        };

        const { error: upsertErr } = await db
          .from("mystic_users")
          .upsert(
            { telegram_id: userId, data: updatedData, updated_at: new Date().toISOString() },
            { onConflict: "telegram_id" }
          );

        if (upsertErr) throw upsertErr;

        console.log(`[/api/promo] activated ${normalizedCode} for user ${userId} → ${promoInfo.tier} / ${promoInfo.duration}d`);
        return res.status(200).json({
          ok: true,
          promo: { tier: promoInfo.tier, duration: promoInfo.duration },
        });
      }

      // Создание промокода — только для админа
      if (action === "create") {
        const { ok, id } = resolveUserId(req, null);
        if (!ok || !isAdminId(id)) {
          return res.status(403).json({ error: "Доступ запрещён" });
        }
        if (!rateLimit(`promo_create_${id}`, 20, 60_000)) {
          return res.status(429).json({ error: "Слишком много запросов" });
        }

        if (!code || typeof code !== "string" || !code.trim()) {
          return res.status(400).json({ error: "Поле code обязательно" });
        }
        if (!VALID_TIERS.has(tier)) {
          return res.status(400).json({ error: "Допустимые тарифы: vip, premium" });
        }
        const dur = parseInt(duration, 10);
        if (isNaN(dur) || dur <= 0 || dur > 3650) {
          return res.status(400).json({ error: "duration должен быть от 1 до 3650 дней" });
        }
        const maxUses = parseInt(max_uses, 10);
        if (isNaN(maxUses) || maxUses < 0) {
          return res.status(400).json({ error: "max_uses должен быть >= 0" });
        }

        const normalizedCode = code.trim().toUpperCase().slice(0, 100);

        const { error } = await db.from("mystic_promos").insert({
          code: normalizedCode,
          tier,
          duration: dur,
          max_uses: maxUses,
          used_count: 0,
          created_by: id,
          created_at: new Date().toISOString(),
        });

        if (error) {
          if (error.code === "23505") {
            return res.status(409).json({ error: "Промокод уже существует" });
          }
          throw error;
        }

        return res.status(200).json({ ok: true });
      }

      return res.status(400).json({ error: "Неизвестное действие" });
    }

    // ── DELETE ─────────────────────────────────────────────────────
    if (req.method === "DELETE") {
      if (!checkBodySize(req.body, 1_000)) {
        return res.status(413).json({ error: "Слишком большой запрос" });
      }

      const { ok, id } = resolveUserId(req, null);
      if (!ok || !isAdminId(id)) {
        return res.status(403).json({ error: "Доступ запрещён" });
      }
      if (!rateLimit(`promo_delete_${id}`, 20, 60_000)) {
        return res.status(429).json({ error: "Слишком много запросов" });
      }

      const { code } = req.body || {};
      if (!code || typeof code !== "string") {
        return res.status(400).json({ error: "Поле code обязательно" });
      }

      const normalizedCode = code.trim().toUpperCase().slice(0, 100);
      const { error } = await db
        .from("mystic_promos")
        .delete()
        .eq("code", normalizedCode);
      if (error) throw error;

      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (e) {
    console.error("[/api/promo]", e.message);
    return res.status(500).json({ error: "Внутренняя ошибка сервера" });
  }
}
