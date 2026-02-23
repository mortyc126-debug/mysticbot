// ============================================================
// CLAUDE API — ИНТЕГРАЦИЯ
// Вызывает Vercel Serverless Function: /api/claude
// ============================================================

import { buildClaudeSystemPrompt } from "../hooks/useAppState";
import TelegramSDK from "./telegram.js";

// Все запросы идут на /api/claude (тот же домен, Vercel Function)
const ENDPOINT = "/api/claude";

// Модели: Grok — Free/VIP задачи, Sonnet — Premium услуги
const GROK   = "grok-4-1-fast-reasoning";
const SONNET = "claude-sonnet-4-6";

// ── Вспомогательный POST ───────────────────────────────────
const callClaude = async ({ systemPrompt, userPrompt, image, maxTokens = 900, model = GROK }, signal) => {
  // Прикрепляем initData для корректного per-user rate limiting на бэкенде
  const initData = TelegramSDK.getInitData();
  const headers = { "Content-Type": "application/json" };
  if (initData) headers["x-telegram-init-data"] = initData;

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers,
    body: JSON.stringify({ systemPrompt, userPrompt, image, maxTokens, model }),
    signal,
  });
  if (!res.ok) throw new Error(`Claude API error: ${res.status}`);
  const data = await res.json();
  return data.text || "";
};

// ── Построение системного промта ──────────────────────────
const getSystemPrompt = (userContext) => {
  const { user, oracle_memory, ...ctx } = userContext || {};
  return buildClaudeSystemPrompt(user || {}, oracle_memory || {}, ctx);
};

// ── Гороскоп ──────────────────────────────────────────────
export const generateHoroscopeAI = async (userContext, signal) => {
  try {
    const { sun_sign, time_of_day, life_focus_priority, dominant_topic, oracle_memory, expanded } = userContext || {};
    const memHints = (oracle_memory?.oracle_knows || []).slice(0, 3).join("; ");

    const userPrompt = expanded
      ? `Персональный гороскоп на сегодня.

Знак: ${sun_sign || "Рыбы"}
Время суток: ${time_of_day || "день"}
Приоритеты: ${life_focus_priority || "не указаны"}
Доминантная тема: ${dominant_topic || "нет"}
${memHints ? `Контекст: ${memHints}` : ""}

3–4 абзаца. Конкретно: что ожидать сегодня, совет по главному приоритету, на что обратить внимание. Пиши по существу — не лей воду. Без markdown.`
      : `Гороскоп на сегодня для ${sun_sign || "Рыбы"}.

4–5 предложений: главное событие/энергия дня, конкретный совет. Пиши ёмко и по делу, без поэзии и воды. Без заголовков и markdown.`;

    const maxTokens = expanded ? 700 : 280;
    return await callClaude({ systemPrompt: getSystemPrompt(userContext), userPrompt, maxTokens, model: GROK }, signal);
  } catch (e) {
    console.warn("[Claude] horoscope fallback:", e.message);
    return null;
  }
};

// ── Интерпретация Таро ────────────────────────────────────
export const interpretTarot = async ({ spread, cards, question, userContext }, signal) => {
  try {
    const { sun_sign, intimacy_level, oracle_memory, prev_reading } = userContext || {};
    const cardList = (cards || []).map((c, i) => {
      const pos = spread?.positions?.[i] || `Карта ${i + 1}`;
      return `${pos}: ${c.name}${c.reversed ? " (перевёрнутая)" : ""} — ключевые слова: ${c.keywords || ""}`;
    }).join("\n");

    const storylines = (oracle_memory?.active_storylines || []).slice(0, 2);
    const storylineHint = storylines.length > 0
      ? `Активные темы: ${storylines.map(s => `${s.name} (${s.topic}, ${s.sessions} упоминаний)`).join(", ")}`
      : "";
    const prevHint = prev_reading
      ? `Прошлое гадание: "${prev_reading.cards?.[0]?.name || ""}", вопрос: "${(prev_reading.question || "").slice(0, 50)}"`
      : "";

    const userPrompt = `Расклад: ${spread?.name || "Таро"}
Вопрос: "${question || "без вопроса"}"

Карты:
${cardList}

Знак: ${sun_sign || "не указан"}
${storylineHint}
${prevHint}

Дай профессиональную расшифровку расклада (120–200 слов):
1. Значение каждой карты в контексте вопроса и позиции — конкретно, без воды.
2. Связь между картами — общая картина.
3. В конце — КРАТКИЙ ОТВЕТ простым языком (2–3 предложения): что делать, чего ожидать.

Пиши как опытный таролог: по делу, профессионально. Без поэм и абстракций.`;

    // Премиум расклады (Кельтский крест, Звезда, Подкова) → Sonnet 4.6
    const model = spread?.tier === "premium" ? SONNET : GROK;
    return await callClaude({ systemPrompt: getSystemPrompt(userContext), userPrompt, maxTokens: 900, model }, signal);
  } catch (e) {
    console.warn("[Claude] tarot fallback:", e.message);
    return null;
  }
};

// ── Анализ сна ────────────────────────────────────────────
export const analyzeDream = async ({ dreamText, userContext }, signal) => {
  try {
    const { sun_sign, oracle_memory, dominant_topic } = userContext || {};

    const userPrompt = `Толкование сна.

Сон: "${dreamText}"
Знак: ${sun_sign || "не указан"}
${dominant_topic ? `Жизненная тема: ${dominant_topic}` : ""}
${oracle_memory?.mood_trend === "снижается" ? "Эмоциональный фон снижен." : ""}

Расшифруй сон профессионально (120–180 слов):
1. Ключевые символы сна и их значение.
2. Что подсознание пытается сказать — конкретно.
3. В конце — КРАТКИЙ ОТВЕТ простым языком: что этот сон значит и что делать.

Без поэзии и абстракций. По делу, как профессиональный толкователь снов. Без markdown.`;

    const text = await callClaude({ systemPrompt: getSystemPrompt(userContext), userPrompt, maxTokens: 750, model: GROK }, signal);
    return text ? { summary: text, symbols: [], advice: "" } : null;
  } catch (e) {
    console.warn("[Claude] dream fallback:", e.message);
    return null;
  }
};

// ── Совместимость ─────────────────────────────────────────
export const analyzeCompatibility = async ({ sign1, sign2, detailed, userContext, partnerData }, signal) => {
  try {
    const { name, sun_sign, relationship_status, oracle_memory } = userContext || {};
    const loveSL = (oracle_memory?.active_storylines || []).find(s => s.topic === "love");

    let userPrompt;

    if (detailed && partnerData) {
      const partnerLines = [
        `- Знак: ${sign2}`,
        partnerData.name       ? `- Имя: ${partnerData.name}` : null,
        partnerData.birthDate  ? `- Дата рождения: ${partnerData.birthDate}` : null,
        partnerData.birthTime  ? `- Время рождения: ${partnerData.birthTime}` : null,
        partnerData.city       ? `- Город: ${partnerData.city}` : null,
        partnerData.country    ? `- Страна: ${partnerData.country}` : null,
      ].filter(Boolean).join("\n");

      userPrompt = `Анализ совместимости.

Первый:
- Знак: ${sign1}${name ? `\n- Имя: ${name}` : ""}${relationship_status ? `\n- Статус: ${relationship_status}` : ""}

Второй:
${partnerLines}
${loveSL ? `\nЭта связь уже развивается.` : ""}

Проанализируй совместимость через стихии и аспекты знаков. Конкретно: где пара совпадает, где конфликт, практический совет. 120–180 слов, без поэзии.

Ответ СТРОГО в формате (числа без пояснений в этих строках):
OVERALL: XX%
LOVE: XX%
FRIENDSHIP: XX%
COMMUNICATION: XX%
PASSION: XX%
ANALYSIS: [конкретный анализ 120-180 слов — без markdown]`;
    } else {
      userPrompt = `Совместимость: ${sign1} и ${sign2}.
${name ? `Имя: ${name}` : ""}
${relationship_status ? `Статус: ${relationship_status}` : ""}

4-5 предложений: суть этой пары, сильные стороны и зоны конфликта. Конкретно и по делу. Ответ СТРОГО в формате:
OVERALL: XX%
LOVE: XX%
FRIENDSHIP: XX%
COMMUNICATION: XX%
TEXT: [4-5 предложений — конкретно, без markdown]`;
    }

    const text = await callClaude({ systemPrompt: getSystemPrompt(userContext), userPrompt, maxTokens: detailed ? 700 : 400, model: GROK }, signal);
    if (!text) return null;

    const parse = (label) => {
      const m = text.match(new RegExp(`${label}:\\s*(\\d{1,3})\\s*%`));
      return m ? parseInt(m[1]) : null;
    };
    const textMatch = text.match(/(?:TEXT|ANALYSIS):\s*([\s\S]+)/);

    return {
      percent:       parse("OVERALL") || 70,
      love:          parse("LOVE"),
      friendship:    parse("FRIENDSHIP"),
      communication: parse("COMMUNICATION"),
      passion:       parse("PASSION"),
      description:   textMatch ? textMatch[1].trim() : text,
    };
  } catch (e) {
    console.warn("[Claude] compat fallback:", e.message);
    return null;
  }
};

// ── Сжатие изображения перед отправкой (Canvas API) ───────
// Уменьшает длинную сторону до maxSide px, quality — JPEG компрессия
const compressImage = (base64, mimeType, maxSide = 1024, quality = 0.82) =>
  new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width  = Math.round(img.width  * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL("image/jpeg", quality);
      resolve(dataUrl.split(",")[1]); // только base64 без data:…;base64,
    };
    img.onerror = () => resolve(base64); // если не удалось — оригинал
    img.src = `data:${mimeType || "image/jpeg"};base64,${base64}`;
  });

// ── Аура по фото + чакры (Claude Vision) ─────────────────
export const analyzeAuraByPhoto = async ({ imageBase64, mimeType, userContext }, signal) => {
  try {
    const { name, sun_sign, life_focus_priority, oracle_memory } = userContext || {};
    const userPrompt = `Анализ ауры по фотографии.

${name ? `Имя: ${name}` : ""}
Знак: ${sun_sign || "не указан"}
${life_focus_priority ? `Приоритеты: ${life_focus_priority}` : ""}

Определи цвет ауры и дай профессиональный анализ (180–240 слов):
1. Цвет ауры и что он означает для этого знака.
2. Состояние чакр — какие активны, какие требуют внимания.
3. Как аура влияет на отношения, работу, здоровье — конкретно.
4. Одна практика на неделю для усиления энергетики.
5. Скрытый потенциал.

Пиши профессионально и конкретно. Без поэзии. Без markdown.`;

    const compressedBase64 = imageBase64
      ? await compressImage(imageBase64, mimeType)
      : undefined;
    const text = await callClaude({
      systemPrompt: getSystemPrompt(userContext),
      userPrompt,
      image: compressedBase64 ? { base64: compressedBase64, mimeType: "image/jpeg" } : undefined,
      maxTokens: 1050,
      model: SONNET,
    }, signal);
    return text ? { description: text } : null;
  } catch (e) {
    console.warn("[Claude] aura photo fallback:", e.message);
    return null;
  }
};

// ── Хиромантия (Claude Vision) ────────────────────────────
export const analyzePalmistry = async ({ imageBase64, mimeType, userContext }, signal) => {
  try {
    const { name, sun_sign, life_focus_priority, oracle_memory } = userContext || {};
    const userPrompt = `Анализ ладони (хиромантия).

${name ? `Имя: ${name}` : ""}
Знак: ${sun_sign || "не указан"}
${life_focus_priority ? `Приоритеты: ${life_focus_priority}` : ""}

Профессиональное чтение линий ладони (170–220 слов):
1. Линия жизни — здоровье и жизненная энергия.
2. Линия сердца — отношения и эмоции.
3. Линия ума — мышление и решения.
4. Линия судьбы — карьера и жизненный путь.
5. Прогноз на ближайший год — конкретно: на что обратить внимание.

Пиши как профессиональный хиромант: конкретные наблюдения, не абстракции. Учти знак зодиака. Без markdown.`;

    // Хиромантия — Premium услуга, используем Sonnet 4.6
    // Сжимаем изображение перед отправкой (экономия токенов и скорость)
    const compressedBase64 = imageBase64
      ? await compressImage(imageBase64, mimeType)
      : undefined;
    const text = await callClaude({
      systemPrompt: getSystemPrompt(userContext),
      userPrompt,
      image: compressedBase64 ? { base64: compressedBase64, mimeType: "image/jpeg" } : undefined,
      maxTokens: 1000,
      model: SONNET,
    }, signal);
    return text ? { lines: [], summary: text, prediction: "" } : null;
  } catch (e) {
    console.warn("[Claude] palmistry fallback:", e.message);
    return null;
  }
};

// ── Аура ──────────────────────────────────────────────────
// deep=false → Grok, краткий анализ (VIP, автоматически)
// deep=true  → Sonnet, детальный анализ (Premium, по запросу)
export const analyzeAura = async ({ answers, birthDate, userContext, deep = false }, signal) => {
  try {
    const { name, sun_sign, life_focus_priority } = userContext || {};

    // Преобразуем ответы теста в читаемый формат вместо JSON
    const answersText = (answers || []).map((a, i) =>
      typeof a === "object" ? `${a.question || `Вопрос ${i + 1}`}: ${a.answer || a.value || a}` : `${i + 1}: ${a}`
    ).join("\n");

    const userPrompt = deep
      ? `Детальный анализ ауры по тесту.

${name ? `Имя: ${name}` : ""}
Знак: ${sun_sign || "не указан"}
${birthDate ? `Дата рождения: ${birthDate}` : ""}
${life_focus_priority ? `Приоритеты: ${life_focus_priority}` : ""}
Ответы теста:
${answersText}

Профессиональный анализ (200–300 слов):
1. Цвет ауры и его значение для этого знака.
2. Влияние на отношения, работу, здоровье — конкретно.
3. Состояние чакр — какие активны, какие ослаблены.
4. Практика на неделю для усиления энергетики.
5. Скрытый потенциал.
Без поэзии, по делу. Без markdown.`
      : `Анализ ауры по тесту.

${name ? `Имя: ${name}` : ""}
Знак: ${sun_sign || "не указан"}
${life_focus_priority ? `Приоритеты: ${life_focus_priority}` : ""}
Ответы теста:
${answersText}

Определи цвет ауры, объясни что он значит для ${sun_sign || "этого знака"}, дай конкретный совет. 120–170 слов. Без поэзии. Без markdown.`;

    const model = deep ? SONNET : GROK;
    const maxTokens = deep ? 1200 : 700;
    const text = await callClaude({ systemPrompt: getSystemPrompt(userContext), userPrompt, maxTokens, model }, signal);
    return text ? { deepDescription: text } : null;
  } catch (e) {
    console.warn("[Claude] aura fallback:", e.message);
    return null;
  }
};

// ── Руны ──────────────────────────────────────────────────
export const interpretRune = async ({ runes, question, userContext }, signal) => {
  try {
    const { sun_sign, oracle_memory } = userContext || {};
    const runeList = (runes || []).map(r => `${r.symbol} ${r.name}: ${r.meaning}`).join("\n");

    const userPrompt = `Толкование рун.

Выпавшие руны:
${runeList}

Вопрос: "${question || "общее гадание"}"
Знак: ${sun_sign || "не указан"}
${(oracle_memory?.oracle_knows || []).length > 0 ? `Контекст: ${oracle_memory.oracle_knows[0]}` : ""}

Профессиональная расшифровка (120–170 слов):
1. Значение каждой руны в контексте вопроса.
2. Общий ответ рун как системы.
3. В конце — КРАТКИЙ ОТВЕТ простым языком (2–3 предложения): что делать, чего ожидать.

Пиши конкретно, без поэзии. Без markdown.`;

    return await callClaude({ systemPrompt: getSystemPrompt(userContext), userPrompt, maxTokens: 800, model: GROK }, signal);
  } catch (e) {
    console.warn("[Claude] rune fallback:", e.message);
    return null;
  }
};

// ── Натальная карта ───────────────────────────────────────
export const generateNatalChart = async ({ birthDate, birthTime, birthPlace, userContext }, signal) => {
  try {
    const { name, sun_sign } = userContext || {};
    const userPrompt = `Натальная карта.

${name ? `Имя: ${name}` : ""}
Дата рождения: ${birthDate || "не указана"}
${birthTime ? `Время рождения: ${birthTime}` : ""}
${birthPlace ? `Место рождения: ${birthPlace}` : ""}
Знак Солнца: ${sun_sign || "не указан"}

Профессиональный анализ натальной карты (200–250 слов):
1. Ключевые черты личности по положению Солнца, Луны и планет.
2. Сильные стороны и скрытые таланты.
3. Главные жизненные темы и вызовы.
4. Прогноз на ближайший период — конкретно.

Пиши как профессиональный астролог: конкретно, без воды. Без markdown.`;

    // Натальная карта — Premium услуга, используем Sonnet 4.6
    const text = await callClaude({ systemPrompt: getSystemPrompt(userContext), userPrompt, maxTokens: 950, model: SONNET }, signal);
    return text ? { sun: sun_sign, moon: "", ascendant: "", description: text } : null;
  } catch (e) {
    console.warn("[Claude] natal fallback:", e.message);
    return null;
  }
};

// ── Прогноз события ───────────────────────────────────────
export const getEventForecast = async ({ event, userContext }, signal) => {
  try {
    const { sun_sign } = userContext || {};
    const userPrompt = `Прогноз астрособытия.

Событие: ${event?.label || event?.name || "астрологическое событие"}
${event?.date ? `Дата: ${event.date}` : ""}
${event?.description ? `Суть: ${event.description}` : ""}
Знак: ${sun_sign || "не указан"}

3-4 предложения: как это событие повлияет на этот знак конкретно. Что делать в этот день. Без абстракций, по делу. Без markdown.`;

    return await callClaude({ systemPrompt: getSystemPrompt(userContext), userPrompt, maxTokens: 450, model: GROK }, signal);
  } catch (e) {
    console.warn("[Claude] event fallback:", e.message);
    return null;
  }
};

// ── Планеты на сегодня ────────────────────────────────────
export const generateDailyPlanets = async (todayStr, signal) => {
  try {
    const userPrompt = `Сегодня ${todayStr}. Определи положение планет для этого дня.

Верни ТОЛЬКО валидный JSON (без пояснений, без markdown):
{
  "sun":     { "sign": "знак_зодиака", "deg": число, "influence": "влияние 4-6 слов" },
  "moon":    { "sign": "знак_зодиака", "deg": число, "phase": "растущая|убывающая|полная|новая", "influence": "влияние 4-6 слов" },
  "mercury": { "sign": "знак_зодиака", "deg": число, "retrograde": false, "influence": "влияние 4-6 слов" },
  "venus":   { "sign": "знак_зодиака", "deg": число, "influence": "влияние 4-6 слов" },
  "mars":    { "sign": "знак_зодиака", "deg": число, "influence": "влияние 4-6 слов" },
  "jupiter": { "sign": "знак_зодиака", "deg": число, "influence": "влияние 4-6 слов" },
  "saturn":  { "sign": "знак_зодиака", "deg": число, "influence": "влияние 4-6 слов" },
  "retrograde": []
}

Все названия знаков — на русском. Позиции должны соответствовать реальным астрологическим данным для указанной даты.`;

    const text = await callClaude({
      systemPrompt: "Ты — профессиональный астролог с точными эфемеридами. Возвращай ТОЛЬКО JSON без лишнего текста.",
      userPrompt,
      maxTokens: 400,
      model: GROK,
    }, signal);

    // Сначала пробуем распарсить весь текст как JSON (модель вернула чистый JSON)
    try {
      return JSON.parse(text.trim());
    } catch {
      // Fallback: ищем первый корректный JSON-объект в тексте
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) return null;
      try {
        return JSON.parse(match[0]);
      } catch {
        console.warn("[Claude] planets: не удалось распарсить JSON из ответа");
        return null;
      }
    }
  } catch (e) {
    console.warn("[Claude] planets fallback:", e.message);
    return null;
  }
};

// ── Прогноз планеты для пользователя ─────────────────────
export const generatePlanetForecast = async ({ planetName, planetData, userSign, isVip, userContext }, signal) => {
  try {
    const userPrompt = isVip
      ? `${planetName} в ${planetData.sign || "знаке"}${planetData.retrograde ? " (ретроград)" : ""}. Что это значит для ${userSign || "этого знака"} сегодня?
${userContext?.life_focus_priority ? `Приоритеты: ${userContext.life_focus_priority}` : ""}

2-3 предложения: конкретное влияние на этот знак. Без поэзии. Без markdown.`
      : `${planetName} в ${planetData.sign || "знаке"}${planetData.retrograde ? " (ретроград)" : ""}. 1-2 предложения: влияние на все знаки сегодня. Конкретно. Без markdown.`;

    return await callClaude({
      systemPrompt: getSystemPrompt(userContext),
      userPrompt,
      maxTokens: 250,
      model: GROK,
    }, signal);
  } catch (e) {
    console.warn("[Claude] planet forecast fallback:", e.message);
    return null;
  }
};

// ── Знак, которого стоит ждать (Гороскоп · Таро) ─────────
export const generatePredictionSeedAI = async ({ cards, question, userContext }, signal) => {
  try {
    const { sun_sign, oracle_memory } = userContext || {};
    const q = (question || "без вопроса");
    const cardNames = (cards || []).slice(0, 3).map(c => c.name + (c.reversed ? " (↕)" : "")).join(", ");
    const activeTopics = (oracle_memory?.active_storylines || [])
      .filter(s => s.status === "active").slice(0, 1).map(s => s.topic).join("");

    const userPrompt = `Карты: ${cardNames}
Вопрос: "${q}"
Знак: ${sun_sign || "Рыбы"}
${activeTopics ? `Тема: ${activeTopics}` : ""}

Напиши 1-2 предложения: расплывчатый, атмосферный знак-ощущение, который подтвердит послание карт. Это должно быть поэтическое, символичное указание — не конкретное событие, а общее настроение, образ, сфера жизни. Пользователь сам узнает знак, когда встретит его. Например: "Вселенная пошлёт тебе что-то неожиданное в общении", "Обрати внимание на знаки в пространстве вокруг тебя", "Услышишь слово, которое зацепит сердце". Без конкретных деталей (номеров, цветов, имён). Без markdown.`;

    return await callClaude({
      systemPrompt: "Ты — Оракул. Давай расплывчатые, символичные знаки-ощущения. Не конкретные события, а намёки. Только русский текст, без markdown.",
      userPrompt,
      maxTokens: 120,
      model: GROK,
    }, signal);
  } catch (e) {
    console.warn("[Claude] predictionSeed fallback:", e.message);
    return null;
  }
};

// ── Расчёт знака Луны и Асцендента при регистрации ──────
// Вызывается один раз при завершении онбординга.
// Grok использует дату/время/место рождения и возвращает JSON.
// Если время рождения не указано — Асцендент будет null (честно).
export const calculateNatalSigns = async ({ birthDate, birthTime, birthPlace, sunSign }) => {
  try {
    const userPrompt = `Определи знак Луны и Асцендент по натальным данным.

Дата рождения: ${birthDate}
${birthTime ? `Время рождения: ${birthTime}` : "Время рождения: неизвестно"}
${birthPlace ? `Место рождения: ${birthPlace}` : "Место рождения: неизвестно"}
Знак Солнца: ${sunSign || "не указан"}

Верни ТОЛЬКО JSON без пояснений и markdown:
{"moon_sign":"знак на русском","ascendant":"знак на русском или null"}

Если время рождения неизвестно — для ascendant верни null.
Знаки только из этого списка: Овен, Телец, Близнецы, Рак, Лев, Дева, Весы, Скорпион, Стрелец, Козерог, Водолей, Рыбы.`;

    const text = await callClaude({
      systemPrompt: "Ты астролог-калькулятор. Отвечай только валидным JSON без пояснений.",
      userPrompt,
      maxTokens: 60,
      model: GROK,
    });

    if (!text) return null;
    const match = text.match(/\{[^}]+\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]);
    return {
      moon_sign: parsed.moon_sign || null,
      ascendant: (parsed.ascendant && parsed.ascendant !== "null") ? parsed.ascendant : null,
    };
  } catch (e) {
    console.warn("[Claude] natal signs fallback:", e.message);
    return null;
  }
};

const ClaudeAPI = {
  generateHoroscopeAI,
  interpretTarot,
  analyzeDream,
  analyzeCompatibility,
  analyzeAuraByPhoto,
  analyzePalmistry,
  analyzeAura,
  interpretRune,
  generateNatalChart,
  getEventForecast,
  generateDailyPlanets,
  generatePlanetForecast,
  generatePredictionSeedAI,
  calculateNatalSigns,
};

export default ClaudeAPI;
