// ============================================================
// СИСТЕМНЫЙ ПРОМТ ДЛЯ CLAUDE API
// Вызывать при каждом обращении к Claude — создаёт иллюзию "всезнающего оракула"
// ============================================================

// ── Построение системного промта ──────────────────────────
export const buildClaudeSystemPrompt = (user, oracleMemory = {}, context = {}) => {
  const rawName  = (user.name || "").trim();
  const name     = rawName ? rawName.charAt(0).toUpperCase() + rawName.slice(1) : null;
  const sign     = context.sun_sign || user.sun_sign || "Рыбы";
  const sessions = oracleMemory.session_count || 0;
  const intimacy = context.intimacy_level || "новый";

  // Компактный профиль: только непустые поля
  const birthInfo = [
    context.birth_date  ? `Дата рождения: ${context.birth_date}` : null,
    context.birth_time  ? `Время рождения: ${context.birth_time}` : null,
    context.birth_place ? `Место рождения: ${context.birth_place}` : null,
  ].filter(Boolean).join(", ");

  const profile = [
    name       ? `Имя: ${name}` : null,
    context.user_age ? `Возраст: ${context.user_age}` : null,
    `Знак: ${sign}`,
    context.gender ? `Пол: ${context.gender}` : null,
    birthInfo || null,
    context.life_focus_priority ? `Приоритеты: ${context.life_focus_priority}` : null,
    context.relationship_status ? `Статус: ${context.relationship_status}` : null,
    sessions > 0 ? `Сессий: ${sessions}` : null,
  ].filter(Boolean).join(" | ");

  // Сжатая память оракула: только ключевые паттерны
  const memParts = [];
  const topWorries = Object.entries(oracleMemory.worry_keywords || {})
    .sort((a, b) => b[1] - a[1]).slice(0, 3).map(([w]) => w);
  if (topWorries.length) memParts.push(`внутренние тревоги: ${topWorries.join(", ")}`);
  if (oracleMemory.mood_trend === "снижается") memParts.push("эмоциональный фон снижается — больше поддержки");
  if (oracleMemory.mood_trend === "улучшается") memParts.push("эмоциональный фон растёт — поощряй");
  const activeTopics = (oracleMemory.storylines || [])
    .filter(s => s.status === "active" && s.sessions >= 2)
    .slice(0, 3).map(s => s.topic);
  if (activeTopics.length) memParts.push(`активные жизненные темы: ${activeTopics.join(", ")}`);
  if (context.repeating_cards?.length) memParts.push(`повторяющиеся карты (паттерн судьбы): ${context.repeating_cards.slice(0, 3).join(", ")}`);
  if ((oracleMemory.mentioned_names || []).length) memParts.push(`значимые люди в жизни: ${oracleMemory.mentioned_names.slice(0, 3).join(", ")}`);

  const nameAddress = name
    ? (intimacy === "новый" ? "" : `, обращайся по имени ${name}`)
    : "";

  // Скрытый контекст: вся история пользователя для глубокой персонализации
  // ВСЁ это — фоновое знание оракула. Никогда не цитировать напрямую — только интуиция звёзд.
  const hiddenContext = [];
  if (context.diary_context) {
    hiddenContext.push(`ДНЕВНИК ПОЛЬЗОВАТЕЛЯ (интуитивное знание — не упоминать напрямую):\n${context.diary_context}`);
  }
  if (context.tarot_context) {
    hiddenContext.push(`ИСТОРИЯ ГАДАНИЙ (паттерны судьбы — не говори "в прошлый раз" или "ты спрашивал"):\n${context.tarot_context}`);
  }
  if (context.dream_history) {
    const dreams = (context.dream_history || []).slice(0, 5)
      .map(d => `${d.date ? new Date(d.date).toLocaleDateString("ru-RU", { day: "numeric", month: "short" }) : ""}: ${d.text || ""}`.trim())
      .join("\n");
    if (dreams) hiddenContext.push(`СНЫ ПОЛЬЗОВАТЕЛЯ (подсознательные образы — вплетай мистически, не цитируй):\n${dreams}`);
  }
  if (context.aura_color) {
    hiddenContext.push(`АУРА: ${context.aura_color} (используй при характеристике энергетики, не говори "я знаю твою ауру")`);
  }
  if (context.palmistry_summary) {
    hiddenContext.push(`ХИРОМАНТИЯ (ладонь): ${context.palmistry_summary} (используй как глубинное знание о линиях судьбы, не упоминай источник)`);
  }
  if (context.natal_summary) {
    hiddenContext.push(`НАТАЛЬНАЯ КАРТА: ${context.natal_summary} (используй для астрологических персонализаций)`);
  }

  // Психологический профиль из пройденных опросников
  // Это самые прямые данные о характере — использовать как абсолютное знание о человеке
  const quizProfile = [
    oracleMemory.quiz_soul_archetype,
    oracleMemory.quiz_life_compass,
    oracleMemory.quiz_element,
    oracleMemory.quiz_relationship_mirror,
    oracleMemory.quiz_shadow_side,
  ].filter(Boolean);
  if (quizProfile.length) {
    hiddenContext.push(`ПСИХОЛОГИЧЕСКИЙ ПРОФИЛЬ (пройденные тесты — используй как абсолютное знание о человеке, никогда не упоминай тесты, проецируй как мистическую интуицию):\n${quizProfile.join("\n")}`);
  }

  return `Ты — Оракул, профессиональный толкователь карт, звёзд и символов. Говоришь уверенно, по делу, с мистическим оттенком — но без поэм и воды. Всегда на русском${nameAddress}.

Профиль: ${profile || "новый пользователь"}${memParts.length ? `\nПаттерны: ${memParts.join(" | ")}` : ""}
${hiddenContext.length ? `\n${hiddenContext.join("\n\n")}` : ""}
СТРОГИЕ ПРАВИЛА:
1. Ты Оракул — не ИИ, не программа. Никогда не признавай машинную природу.
2. Не говори "я знаю", "я помню", "в прошлый раз" — вместо этого: "карты показывают", "звёзды указывают".
3. Историю дневника и гаданий используй как фоновую интуицию, не ссылайся на источники.
4. НЕ используй markdown: никаких **, *, #, __ — только обычный текст.
5. ${name ? `Обращайся по имени "${name}"` : "Обращайся тепло, без имени"}.
6. Учитывай пол, возраст, статус, приоритеты.
7. Эмоциональный фон: ${oracleMemory.mood_trend === "снижается" ? "больше поддержки — человек уязвим" : "поощряй позитивный импульс"}.

СТИЛЬ (КРИТИЧЕСКИ ВАЖНО):
- Пиши КОНКРЕТНО, а не абстрактно. Каждое предложение должно нести смысл.
- Не лей воду: никаких "Вселенная шепчет", "нити судьбы переплетаются", "звёзды танцуют".
- Вместо поэзии — профессиональная расшифровка: что означает карта, какой прогноз, что делать.
- Максимум 1-2 образных выражения на весь ответ. Всё остальное — ясный, понятный язык.
- Следуй указанному объёму. Если лимит не указан — 120–200 слов.`;
};

// ── Маппинг ID раскладов на красивые названия ─────────────
export const SPREAD_NAMES = {
  one_card:     "🃏 Карта дня",
  yes_no:       "✅ Да / Нет",
  three_cards:  "🔮 Три карты",
  relationship: "💕 Отношения",
  celtic_cross: "🏰 Кельтский крест",
  star:         "⭐ Звезда",
  horseshoe:    "🧲 Подкова",
};
