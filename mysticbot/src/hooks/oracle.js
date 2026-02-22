// ============================================================
// ПАМЯТЬ ОРАКУЛА — анализ взаимодействий, извлечение инсайтов
// ============================================================

// ── Извлечение имён из текста ──────────────────────────────
const EXCLUDED_NAMES = new Set([
  "Что", "Когда", "Где", "Как", "Почему", "Зачем", "Кто", "Чём",
  "Будет", "Стоит", "Можно", "Нужно", "Есть", "Это", "Этот", "Эта",
  "Лучше", "Хуже", "Может", "Хочет", "Думает", "Знает", "Видит",
  "Вернётся", "Придёт", "Позвонит", "Напишет", "Уйдёт", "Останется",
  "Звёзды", "Карты", "Луна", "Солнце", "Марс", "Венера", "Сатурн",
  "Меркурий", "Юпитер", "Нептун", "Плутон", "Уран", "Таро", "Руны",
  "Вселенная", "Судьба", "Карма", "Жизнь", "Путь", "Знак", "Оракул",
]);

export const extractNamesFromText = (text) => {
  if (!text || text.length < 3) return [];
  const names = new Set();
  // Слова с заглавной буквы НЕ в начале предложения (после строчной/запятой)
  const midSentencePattern = /(?:[а-яёa-z,]\s+)([А-ЯЁ][а-яё]{3,10})(?=[\s?!]|$)/g;
  let m;
  while ((m = midSentencePattern.exec(text)) !== null) {
    if (!EXCLUDED_NAMES.has(m[1])) names.add(m[1]);
  }
  // После характерных предлогов и конструкций
  const afterPrepPattern = /(?:про\s+|об\s+|думает\s+|любит\s+|ли\s+ко\s+мне\s+|вернётся\s+)([А-ЯЁ][а-яё]{2,10})/gi;
  while ((m = afterPrepPattern.exec(text)) !== null) {
    if (!EXCLUDED_NAMES.has(m[1])) names.add(m[1]);
  }
  return [...names].slice(0, 3);
};

// ── Извлечение инсайтов из взаимодействия ─────────────────
// Вызывается после каждого гадания/записи — накапливает знания оракула
export const extractInsightsFromInteraction = (question, cards, spreadId, currentMemory) => {
  const mem = currentMemory ? { ...currentMemory } : {};
  const q   = (question || "").trim().toLowerCase();
  const now  = new Date().toISOString();
  const today = now.slice(0, 10);

  // 1. Имена из вопроса
  const newNames = extractNamesFromText(question || "");
  if (newNames.length > 0) {
    mem.mentioned_names = [...new Set([...(mem.mentioned_names || []), ...newNames])].slice(0, 10);
  }

  // 2. Тема вопроса
  let topic = null;
  if (/любов|отношен|парен|девушк|муж|жен|сердц|чувств|расстал|бросил|вернёт|скучает|встречает/.test(q)) topic = "love";
  else if (/работ|карьер|деньг|финанс|бизнес|проект|должност|уволь|повышен|зарплат/.test(q)) topic = "career";
  else if (/здоров|болезн|самочувств|боль|лечить|врач|усталост/.test(q)) topic = "health";
  else if (/семь|дет|родител|мама|папа|брат|сестра|бабушк|дедушк/.test(q)) topic = "family";
  else if (/переезд|переход|решен|выбор|путь|смысл|духовн/.test(q)) topic = "path";
  if (topic && q.length > 5) {
    mem.topic_history = [
      { date: today, topic, snippet: q.slice(0, 40) },
      ...(mem.topic_history || []),
    ].slice(0, 20);
  }

  // 3. Повторяющиеся тревожные слова
  const worryMatches = q.match(/\b(вернёт[сь]?|позвон\w*|напиш\w*|уйдёт|бросит|любит|думает|хочет|скучает|забыл|ревну\w*|обман\w*|изменяет|расстан\w*|ждёт)\w*/gi) || [];
  const kw = { ...(mem.worry_keywords || {}) };
  worryMatches.forEach(w => {
    const key = w.toLowerCase().slice(0, 12);
    kw[key] = (kw[key] || 0) + 1;
  });
  mem.worry_keywords = Object.fromEntries(Object.entries(kw).sort((a, b) => b[1] - a[1]).slice(0, 15));

  // 4. Сюжетные линии — если имя встречается 2+ раз, оракул "отслеживает" историю
  const storylines = [...(mem.storylines || [])];
  newNames.forEach(name => {
    const existing = storylines.find(s => s.name === name && s.status === "active");
    if (existing) {
      existing.sessions += 1;
      existing.last_seen = today;
      if (topic) existing.topic = topic;
    } else {
      storylines.push({
        id: `${name.toLowerCase()}_${Date.now()}`,
        name,
        topic: topic || "general",
        started: today,
        last_seen: today,
        sessions: 1,
        status: "active",
      });
    }
  });
  // Остывшие сюжеты (14+ дней без упоминания)
  const twoWeeksAgo = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);
  storylines.forEach(s => {
    if (s.status === "active" && s.last_seen < twoWeeksAgo) s.status = "cold";
  });
  mem.storylines = storylines.slice(0, 10);

  // 5. Предпочтительный расклад
  if (spreadId) {
    const spreads = { ...(mem.preferred_spreads || {}) };
    spreads[spreadId] = (spreads[spreadId] || 0) + 1;
    mem.preferred_spreads = spreads;
  }

  // 6. Время сессий → предпочтительное время дня
  const hour = new Date().getHours();
  const times = [...(mem.session_times || []), hour].slice(-20);
  mem.session_times = times;
  const avgHour = times.reduce((a, b) => a + b, 0) / times.length;
  mem.preferred_time_of_day = avgHour < 10 ? "утро" : avgHour < 15 ? "день" : avgHour < 20 ? "вечер" : "ночь";

  // 7. "Знание оракула" — то, что оракул понял о человеке
  const knows = [];
  const activeStorylines = storylines.filter(s => s.status === "active" && s.sessions >= 2);
  activeStorylines.forEach(s => {
    const freq = s.sessions >= 5 ? "много раз" : s.sessions >= 3 ? "несколько раз" : "повторно";
    if (s.topic === "love")   knows.push(`${s.name} упоминается в вопросах о любви ${freq}`);
    else if (s.topic === "career") knows.push(`${s.name} связан с профессиональными вопросами (${freq})`);
    else knows.push(`${s.name} появляется в вопросах ${freq}`);
  });
  const topWorry = Object.entries(mem.worry_keywords || {}).sort((a, b) => b[1] - a[1])[0];
  if (topWorry && topWorry[1] >= 2) {
    knows.push(`Повторяющийся вопрос: "${topWorry[0]}" (${topWorry[1]}×)`);
  }
  if ((mem.topic_history || []).length >= 3) {
    const topicFreq = {};
    (mem.topic_history || []).forEach(t => { topicFreq[t.topic] = (topicFreq[t.topic] || 0) + 1; });
    const domEntry = Object.entries(topicFreq).sort((a, b) => b[1] - a[1])[0];
    if (domEntry && domEntry[1] >= 3) {
      const tNames = { love: "любовь", career: "карьера", health: "здоровье", family: "семья", path: "жизненный путь" };
      knows.push(`Главная тема: ${tNames[domEntry[0]] || domEntry[0]} (${domEntry[1]} вопросов)`);
    }
  }
  mem.oracle_knows = knows.slice(0, 6);

  mem.session_count = (mem.session_count || 0) + 1;
  mem.last_updated = now;
  if (!mem.created_at) mem.created_at = now;

  return mem;
};
