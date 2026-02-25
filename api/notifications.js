// ============================================================
// VERCEL SERVERLESS FUNCTION — Push-уведомления через Telegram Bot API
//
// POST /api/notifications  — одиночное уведомление конкретному пользователю
// GET  /api/notifications?slot=<slot>  — CRON: рассылка конкретного слота
//
// Слоты (до 5 в день):
//   morning   — 06:00 UTC — гороскоп, астро-событие
//   midday    — 10:00 UTC — карта дня / факт / мотивация
//   afternoon — 13:00 UTC — лунный совет / совместимость / руны
//   evening   — 17:00 UTC — запись в дневник / рефлексия
//   night     — 20:00 UTC — оракул / стрик / не забудь о себе
//
// POST Body:
//   type:    "daily_horoscope" | "daily_card" | "streak_warning" |
//            "astro_event"     | "tarot_reminder" | "dream_reminder" |
//            "rune_reminder"   | "moon_event"     | "custom"
//   context: { sign?, streak?, card_name?, event_label?, event_ritual?, phase?, message? }
//
// POST Headers: x-telegram-init-data (обязателен в продакшене)
// GET  Headers: Authorization: Bearer <CRON_SECRET>
//
// Переменные Vercel:
//   TELEGRAM_BOT_TOKEN — токен бота от @BotFather
//   WEBAPP_URL         — URL задеплоенного приложения
//   CRON_SECRET        — секрет для защиты крон-эндпоинта
// ============================================================

import { getSupabase } from "./_supabase.js";
import { setCorsHeaders, setSecurityHeaders, rateLimit, checkBodySize, safeStringEqual } from "./_security.js";
import { resolveUserId } from "./_auth.js";

// ── Шаблоны для POST (одиночные) ────────────────────────────
const TEMPLATES = {
  daily_horoscope: ({ sign }) => ({
    text: `🔮 ${sign ? `${sign}, сегодня` : "Сегодня"} звёзды говорят особенно отчётливо.\n\nТвой персональный гороскоп ждёт. Что расскажет Оракул? ✨`,
    btn: "🌟 Читать гороскоп",
  }),
  daily_card: ({ card_name }) => ({
    text: `🃏 Карта дня ${card_name ? `— <b>${card_name}</b>` : "открыта"}.\n\nВселенная выбрала её специально для тебя сегодня. Загляни в МистикУм — послание уже ждёт 🔮`,
    btn: "🃏 Узнать послание",
  }),
  streak_warning: ({ streak }) => ({
    text: `🔥 Серия ${streak ? `${streak} дн.` : ""} — не прерывай!\n\nОракул помнит каждый твой визит. Загляни сегодня, чтобы сохранить стрик и получить бонусные 💫`,
    btn: "⚡ Продолжить серию",
  }),
  astro_event: ({ event_label, event_ritual }) => ({
    text: `✨ ${event_label || "Астрологическое событие"} — сегодня!\n\n${event_ritual ? `${event_ritual}.` : "Мощное время для ритуалов и намерений."} Открой МистикУм для персонального прогноза 🌙`,
    btn: "📅 Персональный прогноз",
  }),
  moon_event: ({ event_label, phase }) => ({
    text: `🌕 ${event_label || (phase ? `${phase} луна` : "Особое лунное событие")} сегодня.\n\nЭто мощное время для намерений и отпускания. Загляни в мистический календарь ✨`,
    btn: "🌙 Открыть календарь",
  }),
  tarot_reminder: ({ sign }) => ({
    text: `🎴 Карты${sign ? ` для ${sign}` : ""} готовы раскрыть тайное...\n\nЗадай вопрос — и Таро даст честный ответ. Расклад займёт меньше минуты 🔮`,
    btn: "🎴 Разложить карты",
  }),
  dream_reminder: () => ({
    text: "😴 Что снилось этой ночью?\n\nЗапиши сны пока они свежи — Оракул расшифрует образы и раскроет скрытые послания в твоём дневнике судьбы 📔",
    btn: "📔 Записать сон",
  }),
  rune_reminder: ({ sign }) => ({
    text: `ᚠ Руны${sign ? ` для ${sign}` : ""} говорят сегодня.\n\nБрось руны и узнай, какие силы действуют в твоей жизни прямо сейчас. Ответ — в древних символах 🌿`,
    btn: "ᚠ Бросить руны",
  }),
  custom: ({ message }) => ({
    text: message || "✨ Послание от МистикУма",
    btn: "🔮 Открыть МистикУм",
  }),
};

const DAILY_DEDUP_FIELD = {
  daily_horoscope: "notif_daily_sent",
  daily_card:      "notif_daily_sent",
  streak_warning:  "notif_streak_sent",
  astro_event:     "notif_event_sent",
  moon_event:      "notif_event_sent",
  tarot_reminder:  "notif_daily_sent",
  dream_reminder:  "notif_daily_sent",
  rune_reminder:   "notif_daily_sent",
};

// ── Мистический календарь 2026: ключевые даты для уведомлений ──
const ASTRO_EVENTS_2026 = [
  { date: "01-03", type: "new_moon",  label: "🌑 Новолуние в Козероге",     ritual: "Ставь финансовые намерения" },
  { date: "01-18", type: "full_moon", label: "🌕 Полнолуние в Раке",        ritual: "Отпусти старые обиды" },
  { date: "02-01", type: "new_moon",  label: "🌑 Новолуние в Водолее",      ritual: "Загадай желания на дружбу и свободу" },
  { date: "02-17", type: "full_moon", label: "🌕 Полнолуние во Льве",       ritual: "Прояви себя, покажи миру свой свет" },
  { date: "03-03", type: "new_moon",  label: "🌑 Новолуние в Рыбах",        ritual: "Доверься интуиции, загадай духовное" },
  { date: "03-14", type: "eclipse",   label: "🌑✨ Полное лунное затмение", ritual: "Мощнейший день: отпусти всё лишнее" },
  { date: "03-20", type: "equinox",   label: "🌿 Весеннее равноденствие",    ritual: "Очисти пространство, начни новый цикл" },
  { date: "03-29", type: "eclipse",   label: "☀️✨ Частичное солнечное затмение", ritual: "Новые начинания обретают силу" },
  { date: "04-02", type: "new_moon",  label: "🌑 Новолуние в Овне",         ritual: "Смелые намерения и новые проекты" },
  { date: "04-16", type: "full_moon", label: "🌕 Полнолуние в Весах",       ritual: "Гармонизируй отношения" },
  { date: "05-01", type: "new_moon",  label: "🌑 Новолуние в Тельце",       ritual: "Намерения на достаток и красоту" },
  { date: "05-16", type: "full_moon", label: "🌕 Полнолуние в Скорпионе",   ritual: "Трансформация и глубокие перемены" },
  { date: "05-31", type: "new_moon",  label: "🌑 Новолуние в Близнецах",    ritual: "Загадай желания на общение и идеи" },
  { date: "06-14", type: "full_moon", label: "🌕 Полнолуние в Стрельце",    ritual: "Расширяй горизонты" },
  { date: "06-21", type: "solstice",  label: "☀️ Летнее солнцестояние",      ritual: "Разожги костёр намерений" },
  { date: "06-29", type: "new_moon",  label: "🌑 Новолуние в Раке",         ritual: "Укрепи домашний очаг и близкие связи" },
  { date: "07-14", type: "full_moon", label: "🌕 Полнолуние в Козероге",     ritual: "Подведи итоги полугодия" },
  { date: "07-29", type: "new_moon",  label: "🌑 Новолуние во Льве",        ritual: "Прояви себя, выйди на свет" },
  { date: "08-12", type: "full_moon", label: "🌕 Полнолуние в Водолее",     ritual: "Освободись от ограничений" },
  { date: "08-27", type: "new_moon",  label: "🌑 Новолуние в Деве",         ritual: "Наведи порядок и поставь практичные цели" },
  { date: "09-07", type: "eclipse",   label: "🌑✨ Полное лунное затмение", ritual: "Переломный момент — прислушайся к знакам" },
  { date: "09-22", type: "equinox",   label: "🍂 Осеннее равноденствие",     ritual: "Благодарность и завершение циклов" },
  { date: "09-22", type: "eclipse",   label: "☀️✨ Частичное солнечное затмение", ritual: "Мощный портал перемен" },
  { date: "09-25", type: "new_moon",  label: "🌑 Новолуние в Весах",        ritual: "Гармония, партнёрство и новые договорённости" },
  { date: "10-10", type: "full_moon", label: "🌕 Полнолуние в Овне",        ritual: "Действуй! Энергия на пике" },
  { date: "10-24", type: "new_moon",  label: "🌑 Новолуние в Скорпионе",    ritual: "Отпусти старое, впусти трансформацию" },
  { date: "11-09", type: "full_moon", label: "🌕 Полнолуние в Тельце",      ritual: "Укрепи то, что ценно" },
  { date: "11-23", type: "new_moon",  label: "🌑 Новолуние в Стрельце",     ritual: "Мечтай масштабно, ставь большие цели" },
  { date: "12-08", type: "full_moon", label: "🌕 Полнолуние в Близнецах",   ritual: "Подведи итоги года" },
  { date: "12-21", type: "solstice",  label: "❄️ Зимнее солнцестояние",      ritual: "Самая длинная ночь — медитируй" },
  { date: "12-22", type: "new_moon",  label: "🌑 Новолуние в Козероге",     ritual: "Ставь намерения на новый год" },
];

// Диапазоны местного часа, в которые допустима рассылка слота.
// Пользователи с известным utc_offset получают уведомление только в своё "правильное" время.
// Пользователи без utc_offset получают уведомление всегда (не знаем их часового пояса).
const SLOT_LOCAL_HOURS = {
  morning:   [5, 10],
  midday:    [9, 14],
  afternoon: [12, 17],
  evening:   [16, 22],
  night:     [19, 24],
};

// Проверяет, попадает ли текущий момент в слот для данного utc_offset (минут восточнее UTC)
function isSlotTimeForUser(slot, utcOffsetMinutes) {
  if (utcOffsetMinutes == null) return true; // часовой пояс неизвестен — отправляем
  const nowUtcMinutes = new Date().getUTCHours() * 60 + new Date().getUTCMinutes();
  const localMinutes  = ((nowUtcMinutes + utcOffsetMinutes) % 1440 + 1440) % 1440;
  const localHour     = Math.floor(localMinutes / 60);
  const [from, to]    = SLOT_LOCAL_HOURS[slot] || [0, 24];
  return localHour >= from && localHour < to;
}

// ── Контент по слотам — каждый слот отличается темой ────────
// Слот определяет смысловую "дорожку" — что актуально в это время суток.
// Если сегодня астро-событие, оно имеет приоритет в любом слоте.
const SLOT_TEMPLATES = {
  // 06:00 UTC — утро: приветствие + гороскоп
  morning: [
    (ctx) => ({
      text: `🌅 Доброе утро${ctx.name ? `, <b>${ctx.name}</b>` : ctx.sign ? `, ${ctx.sign}` : ""}!\n\nЗвёзды уже выстроили путь на сегодня. Открой свой персональный гороскоп и узнай, чего ждать ✨`,
      btn: "🌟 Гороскоп на сегодня",
    }),
    (ctx) => ({
      text: `☀️ Новый день — новые возможности${ctx.sign ? ` для ${ctx.sign}` : ""}.\n\nПрежде чем начать — загляни в карты. Что подсказывает Таро? 🃏`,
      btn: "🃏 Карта дня",
    }),
    (ctx) => ({
      text: `🌄 ${ctx.name ? `<b>${ctx.name}</b>` : ctx.sign || "Звёзды"}, сегодня особый день.\n\nПолучи утреннее послание от Оракула — он уже видит твой путь 🔮`,
      btn: "🔮 Утреннее послание",
    }),
  ],
  // 10:00 UTC — день: факт, мотивация, карта
  midday: [
    () => ({
      text: `🃏 Карта дня открыта и ждёт тебя.\n\nВселенная посылает послание через символы — загляни и получи +1 💫`,
      btn: "🃏 Открыть карту дня",
    }),
    (ctx) => ({
      text: `💡 Астро-совет дня${ctx.sign ? ` для ${ctx.sign}` : ""}:\n\nЗвёзды раскрывают скрытые возможности этого дня. Открой МистикУм — там уже всё готово ✨`,
      btn: "✨ Совет дня",
    }),
    () => ({
      text: `🎴 Есть вопрос — карты готовы ответить.\n\nРасклад занимает меньше минуты. Спроси о том, что волнует прямо сейчас 🔮`,
      btn: "🎴 Разложить карты",
    }),
  ],
  // 13:00 UTC — послеполудень: лунный цикл, руны, совет
  afternoon: [
    (ctx) => ({
      text: `🌙 Луна влияет на каждое твоё решение.\n\nУзнай лунный совет на сегодня${ctx.sign ? ` специально для ${ctx.sign}` : ""} — это меняет взгляд на ситуацию 🔮`,
      btn: "🌙 Лунный совет",
    }),
    (ctx) => ({
      text: `ᚠ Руны${ctx.sign ? ` для ${ctx.sign}` : ""} готовы говорить.\n\nКакие силы действуют в твоей жизни прямо сейчас? Один бросок — и картина прояснится 🌿`,
      btn: "ᚠ Бросить руны",
    }),
    () => ({
      text: `🌿 Середина дня — хороший момент спросить у Оракула.\n\nО чём ты думаешь прямо сейчас? Задай вопрос — получи честный ответ звёзд 🔮`,
      btn: "🔮 Спросить Оракула",
    }),
  ],
  // 17:00 UTC — вечер: дневник, рефлексия
  evening: [
    () => ({
      text: `📔 Вечер — лучшее время для записи в дневник.\n\nЧто случилось сегодня? Запиши — Оракул прочитает образы и раскроет скрытые послания 🌙`,
      btn: "📔 Записать в дневник",
    }),
    () => ({
      text: `😴 Сны приходят из глубин подсознания.\n\nЗапиши сны этой ночи пока они свежи — Оракул расшифрует каждый символ 🌌`,
      btn: "📔 Записать сны",
    }),
    (ctx) => ({
      text: `🌆 Вечерний ритуал${ctx.sign ? ` для ${ctx.sign}` : ""}:\n\nПодведи итог дня с помощью Таро. Что карты скажут о прошедшем? 🎴`,
      btn: "🎴 Вечерний расклад",
    }),
  ],
  // 20:00 UTC — ночь: стрик, оракул, не прерывай
  night: [
    (ctx) => (ctx.streak >= 2 ? {
      text: `🔥 ${ctx.name ? `<b>${ctx.name}</b>, серия` : "Серия"} ${ctx.streak} дн. — не прерывай сегодня!\n\nОракул ждёт твоего визита. Загляни до полуночи — сохрани стрик и получи бонусные 💫`,
      btn: "⚡ Сохранить серию",
    } : {
      text: `🌙 ${ctx.name ? `<b>${ctx.name}</b>, ночь` : "Ночь"} — особое время для Оракула.\n\nТишина помогает услышать звёзды. Задай вопрос, который не выходит из головы 🔮`,
      btn: "🔮 Спросить Оракула",
    }),
    () => ({
      text: `🌌 Перед сном — хорошее время для карты.\n\nТаро покажет, что несёт завтрашний день. Один расклад — и можно спать спокойно 🃏`,
      btn: "🃏 Карта на завтра",
    }),
    (ctx) => ({
      text: `✨ ${ctx.name ? `<b>${ctx.name}</b>` : ctx.sign || "Звёзды"}, как прошёл твой день?\n\nЗапиши ощущения в дневник или спроси Оракула о завтра — он отвечает даже ночью 🔮`,
      btn: "🔮 Открыть МистикУм",
    }),
  ],
};

// Поле дедупликации для каждого слота (по одному на слот в день)
const SLOT_DEDUP = {
  morning:   "notif_slot_morning",
  midday:    "notif_slot_midday",
  afternoon: "notif_slot_afternoon",
  evening:   "notif_slot_evening",
  night:     "notif_slot_night",
};

// Выбрать контент для слота
function chooseSlotContent(slot, ctx, dayIndex, todayEvent) {
  // Приоритет: астро-событие всегда идёт в утреннем и послеполуденном слотах
  if (todayEvent && (slot === "morning" || slot === "afternoon")) {
    const ev = todayEvent;
    const isMoon = ev.type === "full_moon" || ev.type === "new_moon";
    return {
      text: `${isMoon ? "🌕" : "✨"} ${ev.label} — сегодня!\n\n${ev.ritual}. Открой МистикУм для персонального прогноза 🌙`,
      btn: isMoon ? "🌙 Лунный прогноз" : "📅 Персональный прогноз",
    };
  }

  const templates = SLOT_TEMPLATES[slot] || SLOT_TEMPLATES.morning;
  const fn = templates[dayIndex % templates.length];
  return fn(ctx);
}

// ── Общая функция отправки в Telegram ───────────────────────
const sendTelegramMessage = async (token, chatId, text, replyMarkup) => {
  const body = { chat_id: chatId, text, parse_mode: "HTML" };
  if (replyMarkup) body.reply_markup = replyMarkup;

  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000), // 15 сек таймаут — защита от зависания в cron
  });
  if (!r.ok) {
    const err = await r.text();
    throw new Error(`TG ${r.status}: ${err.slice(0, 200)}`);
  }
  return r.json();
};

// ── GET: CRON — массовая рассылка слота ─────────────────────
async function handleCron(req, res) {
  // Проверка авторизации крона
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = req.headers.authorization || "";
    // Сравниваем в постоянное время (защита от timing attack)
    if (!safeStringEqual(authHeader, `Bearer ${cronSecret}`)) {
      return res.status(401).json({ error: "Unauthorized" });
    }
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return res.status(503).json({ error: "TELEGRAM_BOT_TOKEN не задан" });

  // Определяем слот из query-параметра (или фоллбэк по текущему часу UTC)
  const rawSlot = (req.query?.slot || "").toLowerCase();
  const VALID_SLOTS = ["morning", "midday", "afternoon", "evening", "night"];
  const slot = VALID_SLOTS.includes(rawSlot) ? rawSlot : (() => {
    const h = new Date().getUTCHours();
    if (h < 8)  return "morning";
    if (h < 12) return "midday";
    if (h < 15) return "afternoon";
    if (h < 19) return "evening";
    return "night";
  })();

  const dedupField = SLOT_DEDUP[slot];
  const webappUrl = process.env.WEBAPP_URL || null;
  const db = getSupabase();

  // Проверяем астро-событие на сегодня (MM-DD формат) — вычисляем один раз для всего крона
  const today = new Date().toDateString();
  const dayIndex = Math.floor(Date.now() / 86400000);
  const nowDate = new Date();
  const mmdd = `${String(nowDate.getMonth() + 1).padStart(2, "0")}-${String(nowDate.getDate()).padStart(2, "0")}`;
  const todayEvent = ASTRO_EVENTS_2026.find(e => e.date === mmdd) || null;

  let sent = 0, skipped = 0, blocked = 0, errors = 0, totalFetched = 0;

  // Пагинация: обрабатываем пользователей батчами по 500, чтобы не загружать
  // всю базу в память одним запросом (защита от OOM при большой аудитории).
  const BATCH_SIZE = 500;
  let offset = 0;

  try {
    while (true) {
      const { data: users, error } = await db
        .from("mystic_users")
        .select("telegram_id, data")
        .not("data", "is", null)
        .range(offset, offset + BATCH_SIZE - 1);

      if (error) throw error;
      if (!users || users.length === 0) break;

      totalFetched += users.length;

      for (const row of users) {
        const userData = row.data || {};

        if (!userData.registered) { skipped++; continue; }

        // Дедупликация: уже отправляли этот слот сегодня?
        if (userData[dedupField] === today) { skipped++; continue; }

        // Фильтрация по часовому поясу: отправляем только если сейчас "правильное" время для пользователя
        const utcOffsetMinutes = userData.utc_offset ?? null;
        if (!isSlotTimeForUser(slot, utcOffsetMinutes)) { skipped++; continue; }

        const sign    = userData.sun_sign || null;
        const streak  = userData.streak_days || 0;
        const rawName = (userData.name || "").trim();
        const name    = rawName ? rawName.charAt(0).toUpperCase() + rawName.slice(1) : null;
        const ctx = { sign, streak, name };

        const { text: notifText, btn: btnLabel } = chooseSlotContent(slot, ctx, dayIndex, todayEvent);

        const replyMarkup = webappUrl
          ? { inline_keyboard: [[{ text: btnLabel, web_app: { url: webappUrl } }]] }
          : null;

        try {
          await sendTelegramMessage(token, row.telegram_id, notifText, replyMarkup);
          sent++;

          // Помечаем слот как отправленный
          const merged = { ...userData, [dedupField]: today };
          await db.from("mystic_users").upsert(
            { telegram_id: row.telegram_id, data: merged, updated_at: new Date().toISOString() },
            { onConflict: "telegram_id" }
          );
        } catch (e) {
          if (e.message.match(/403|400|blocked|chat not found/i)) { blocked++; continue; }
          console.warn(`[Cron:${slot}] Error sending to ${row.telegram_id}:`, e.message);
          errors++;
        }

        // Telegram лимит: 30 msg/sec
        if (sent % 25 === 0) await new Promise(r => setTimeout(r, 1100));
      }

      // Если получили меньше батча — это последняя страница
      if (users.length < BATCH_SIZE) break;
      offset += BATCH_SIZE;
    }

    return res.status(200).json({ ok: true, slot, total: totalFetched, sent, skipped, blocked, errors });
  } catch (e) {
    console.error(`[Cron notify:${slot}]`, e.message);
    return res.status(500).json({ error: e.message });
  }
}

// ── POST: одиночное уведомление ─────────────────────────────
async function handlePost(req, res) {
  if (!checkBodySize(req.body, 8_000)) {
    return res.status(413).json({ error: "Слишком большой запрос" });
  }

  const { telegram_id: rawId, type = "daily_horoscope", context: ctx = {} } = req.body || {};
  const { ok, id, warn } = resolveUserId(req, rawId);
  if (!ok) return res.status(401).json({ error: warn || "telegram_id обязателен" });
  if (warn) console.warn("[/api/notifications]", warn, id);

  if (!rateLimit(`notif_${id}`, 10, 60_000)) {
    return res.status(429).json({ error: "Слишком много запросов" });
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.error("[Notifications] TELEGRAM_BOT_TOKEN не задан");
    return res.status(503).json({ error: "Сервис временно недоступен" });
  }

  const webappUrl = process.env.WEBAPP_URL || null;
  const db = getSupabase();

  // Дедупликация
  const dedupField = DAILY_DEDUP_FIELD[type];
  if (dedupField) {
    try {
      const { data: userRow } = await db
        .from("mystic_users")
        .select("data")
        .eq("telegram_id", id)
        .maybeSingle();

      if (userRow?.data) {
        const today = new Date().toDateString();
        if (userRow.data[dedupField] === today) {
          return res.status(200).json({ ok: true, skipped: true, reason: "already_sent_today" });
        }
      }
    } catch (e) {
      console.warn("[Notifications] dedup check failed:", e.message);
    }
  }

  const templateFn = TEMPLATES[type] || TEMPLATES.custom;
  const { text: notifText, btn: btnLabel } = templateFn(ctx);

  const replyMarkup = webappUrl
    ? { inline_keyboard: [[{ text: btnLabel, web_app: { url: webappUrl } }]] }
    : null;

  try {
    await sendTelegramMessage(token, id, notifText, replyMarkup);
  } catch (e) {
    console.error("[Notifications] send error:", e.message);
    if (e.message.match(/403|blocked|chat not found/i)) {
      return res.status(200).json({ ok: false, reason: "bot_blocked_or_no_chat" });
    }
    return res.status(502).json({ error: "Не удалось отправить уведомление" });
  }

  if (dedupField) {
    try {
      const today = new Date().toDateString();
      const { data: existing } = await db
        .from("mystic_users")
        .select("data")
        .eq("telegram_id", id)
        .maybeSingle();

      const merged = { ...(existing?.data || {}), [dedupField]: today };
      await db.from("mystic_users").upsert(
        { telegram_id: id, data: merged, updated_at: new Date().toISOString() },
        { onConflict: "telegram_id" }
      );
    } catch (e) {
      console.warn("[Notifications] failed to save dedup date:", e.message);
    }
  }

  return res.status(200).json({ ok: true });
}

// ── Роутинг по методу ───────────────────────────────────────
export default async function handler(req, res) {
  setCorsHeaders(res, "GET, POST, OPTIONS");
  setSecurityHeaders(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method === "GET")  return handleCron(req, res);
  if (req.method === "POST") return handlePost(req, res);

  return res.status(405).json({ error: "Method not allowed" });
}
