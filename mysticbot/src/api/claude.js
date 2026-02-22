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
      ? `Создай персональный расширенный гороскоп на сегодня.

Контекст:
- Знак: ${sun_sign || "Рыбы"}
- Время суток: ${time_of_day || "день"}
- Приоритеты пользователя: ${life_focus_priority || "не указаны"}
- Доминантная тема: ${dominant_topic || "нет"}
${memHints ? `- Знание оракула: ${memHints}` : ""}

Напиши гороскоп на 3–4 абзаца. Включи: астрологический прогноз дня, совет по главному приоритету, крючок на завтра. НЕ перечисляй факты — создавай ощущение глубокого понимания.`
      : `Напиши гороскоп на сегодня для знака ${sun_sign || "Рыбы"}.

Пять-шесть предложений, один живой абзац: главная энергия дня, на что обратить внимание, короткий совет. Говори как голос звёзд — образно, тепло, без казённых слов. Без заголовков и markdown.`;

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
Уровень близости: ${intimacy_level || "новый"}
${storylineHint}
${prevHint}

Дай интерпретацию (150–250 слов). Создай нарративную связь между картами. Завершись конкретным наблюдением на 24–48 часов.`;

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

    const userPrompt = `Подсознание этого человека послало образ — сон, который требует прочтения.

Сон: "${dreamText}"
Знак: ${sun_sign || "не указан"}
${dominant_topic ? `Главная жизненная тема: ${dominant_topic}` : ""}
${oracle_memory?.mood_trend === "снижается" ? "Энергетический фон сейчас снижен — сон особенно важен." : ""}

Прочитай сон как послание из глубин. Раскрой, что подсознание пытается сказать. Вплети образы сна в нить жизни этого человека — без сухого анализа, через ощущения и символы. Завершись коротким практическим знаком: что сделать или заметить в ближайшие сутки. Говори поэтично и точно — 150–200 слов.`;

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

      userPrompt = `Проведи детальный астрологический анализ совместимости двух душ.

Первый:
- Знак: ${sign1}${name ? `\n- Имя: ${name}` : ""}${relationship_status ? `\n- Статус: ${relationship_status}` : ""}

Второй:
${partnerLines}
${loveSL ? `\nЗвёзды уже видят эту связь — история разворачивается.` : ""}

Раскрой природу этого союза через стихии и планетарные аспекты. Покажи, где эти двое резонируют, а где создают напряжение, которое может стать силой или трещиной. Говори образно, как будто читаешь карту судьбы — не сухой разбор, а живое послание. Заверши советом, который зажжёт или исцелит эту связь.

Ответ СТРОГО в формате (числа без пояснений в этих строках):
OVERALL: XX%
LOVE: XX%
FRIENDSHIP: XX%
COMMUNICATION: XX%
PASSION: XX%
ANALYSIS: [поэтичный, живой текст 150-200 слов — без markdown]`;
    } else {
      userPrompt = `Два знака — ${sign1} и ${sign2}. Что говорят звёзды об этом союзе?
Знак пользователя: ${sun_sign || sign1}
${name ? `Имя: ${name}` : ""}
${relationship_status ? `Статус: ${relationship_status}` : ""}
${loveSL ? `Звёзды уже видят эту связь — она не случайна.` : ""}

Напиши живо и образно — 4-5 предложений о природе этого союза, его силе и тени. Ни слова казённого — только голос судьбы. Ответ СТРОГО в формате:
OVERALL: XX%
LOVE: XX%
FRIENDSHIP: XX%
COMMUNICATION: XX%
TEXT: [4-5 предложений — поэтично, без markdown]`;
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
    const userPrompt = `Перед тобой фотография человека. Прочитай его ауру и состояние чакр.

${name ? `Имя: ${name}` : ""}
Знак: ${sun_sign || "не указан"}
${life_focus_priority ? `Что важно в жизни: ${life_focus_priority}` : ""}
${(oracle_memory?.mentioned_names || []).length > 0 ? `Значимые люди: ${oracle_memory.mentioned_names.slice(0, 2).join(", ")}` : ""}

Вглядись в образ этого человека. Назови точный цвет ауры — как он проявляется в облике, энергетике, взгляде. Покажи, что этот цвет несёт для знака ${sun_sign || "этого человека"} прямо сейчас. Расскажи, какие чакры сейчас горят ярко, а какие требуют внимания — говори образно, без сухого перечня. Дай одну конкретную практику на неделю для усиления энергетического поля. Заверши посланием о скрытом потенциале, который виден в этой ауре. 220–280 слов. Без markdown.`;

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
    const userPrompt = `Перед тобой ладонь человека. Читай её как открытую книгу судьбы.

${name ? `Имя: ${name}` : ""}
Знак: ${sun_sign || "не указан"}
${life_focus_priority ? `Что занимает жизнь: ${life_focus_priority}` : ""}
${(oracle_memory?.mentioned_names || []).length > 0 ? `Значимые люди в жизни: ${oracle_memory.mentioned_names.slice(0, 2).join(", ")}` : ""}

Прочитай ладонь как послание — не перечень линий, а живую историю. Покажи, что линии жизни, сердца, ума и судьбы говорят об этом конкретном человеке прямо сейчас. Вплети знак зодиака в прочтение. Заверши предсказанием на ближайший год — образным, притягивающим, с лёгким крючком: что должно случиться и когда. 200–250 слов. Без markdown.`;

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
      ? `Аура этого человека раскрыла себя через тест. Ты видишь её цвет, вибрацию, глубину.

${name ? `Имя: ${name}` : ""}
Знак Зодиака: ${sun_sign || "не указан"}
${birthDate ? `Дата рождения: ${birthDate}` : ""}
${life_focus_priority ? `Что важно в жизни: ${life_focus_priority}` : ""}
Откровения теста:
${answersText}

Прочитай ауру как живое поле — назови цвет и покажи, что он несёт именно этому человеку, с его знаком и жизнью. Расскажи, как аура звучит в отношениях, работе и здоровье. Какие чакры сейчас зовут к себе? Какая практика на ближайшую неделю укрепит это поле? И главное — какой скрытый потенциал дремлет в этой ауре прямо сейчас. 250–350 слов. Говори как Вселенная — образно, точно, без markdown.`
      : `Аура этого человека проявила себя. Определи её цвет и послание.

${name ? `Имя: ${name}` : ""}
Знак: ${sun_sign || "не указан"}
${life_focus_priority ? `Жизненные приоритеты: ${life_focus_priority}` : ""}
Откровения теста:
${answersText}

Назови цвет ауры и объясни, что он значит для знака ${sun_sign || "этого человека"} прямо сейчас. Покажи, как аура проявляется в его жизни, и дай один конкретный совет. 150–200 слов. Без markdown.`;

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

    const userPrompt = `Руны пали — и каждая несёт часть послания. Вместе они открывают нечто важное.

Выпавшие руны:
${runeList}

Вопрос: "${question || "общее гадание"}"
Знак: ${sun_sign || "не указан"}
${(oracle_memory?.oracle_knows || []).length > 0 ? `Что известно об этом человеке: ${oracle_memory.oracle_knows[0]}` : ""}

Читай руны как единую систему, не по отдельности. Покажи, как они переплетаются в один ответ на вопрос. Говори языком древнего знания — образно, но точно. Заверши советом и крючком: знаком или наблюдением, которое человек должен будет заметить в ближайшие дни. 150–200 слов. Без markdown.`;

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
    const userPrompt = `В момент рождения этого человека небо зафиксировало уникальный рисунок судьбы. Прочитай его.

${name ? `Имя: ${name}` : ""}
Дата рождения: ${birthDate || "не указана"}
${birthTime ? `Время рождения: ${birthTime}` : ""}
${birthPlace ? `Место рождения: ${birthPlace}` : ""}
Знак Солнца: ${sun_sign || "не указан"}

Раскрой натальную карту как живое послание: покажи ключевые грани личности, скрытые дары и главные жизненные темы, которые небо начертало в момент появления на свет. Говори образно и точно — не перечень планет, а история души. Заверши крючком: намекни, какой период или поворот уже приближается в судьбе, чтобы человек захотел узнать больше. 220–270 слов. Без markdown.`;

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
    const userPrompt = `Астрологическое событие приближается — и оно говорит именно с этим человеком.

Событие: ${event?.label || event?.name || "астрологическое событие"}
${event?.date ? `Дата: ${event.date}` : ""}
${event?.description ? `Суть: ${event.description}` : ""}
Знак: ${sun_sign || "не указан"}

Покажи, как это небесное событие коснётся его жизни лично — не общие слова, а живое предсказание. Три-четыре предложения: образно, с ощущением значимости момента. Заверши намёком на то, что стоит сделать или заметить в этот день. Без markdown.`;

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
      ? `${planetName} сейчас в ${planetData.sign || "знаке"}${planetData.retrograde ? " — ретроградное движение" : ""}. Что это значит для ${userSign || "этого знака"} сегодня?
${userContext?.life_focus_priority ? `Жизненный фокус: ${userContext.life_focus_priority}` : ""}

Два-три предложения: образно, точно, с ощущением живого влияния этой планеты прямо сейчас. Без markdown.`
      : `${planetName} в ${planetData.sign || "знаке"}${planetData.retrograde ? " (ретроград)" : ""}. Одно-два предложения: общий образ влияния для всех знаков сегодня. Без markdown.`;

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
      systemPrompt: "Ты — голос звёзд. Давай поэтичные, символичные, расплывчатые знаки-ощущения. Не конкретные события, а атмосферные намёки, которые пользователь сам разгадает. Только русский текст, без markdown.",
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
