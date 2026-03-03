// ============================================================
// ЛУННЫЙ КАЛЕНДАРЬ
//
// Вычисляет текущую фазу Луны без внешних API.
// Используется для режима «Тёмная Луна» и отображения фазы.
//
// Алгоритм: J.M.Meeus «Astronomical Algorithms» (упрощённый)
// Точность: ±1 день для бытовых задач.
// ============================================================

// Эталонное новолуние: 6 января 2000 18:14 UTC (JDE 2451549.5)
const KNOWN_NEW_MOON_JD = 2451549.5 + 0.75972; // JDE
const LUNAR_CYCLE = 29.53058867; // дней

/** Juliane day number for a given JS Date */
function toJD(date) {
  return date.getTime() / 86400000 + 2440587.5;
}

/**
 * Возвращает текущую фазу Луны: 0 = новолуние, 0.5 = полнолуние, 1 = след. новолуние.
 */
export function getLunarPhase(date = new Date()) {
  const jd   = toJD(date);
  const diff = jd - KNOWN_NEW_MOON_JD;
  const phase = ((diff % LUNAR_CYCLE) + LUNAR_CYCLE) % LUNAR_CYCLE;
  return phase / LUNAR_CYCLE; // 0..1
}

/**
 * Дней до следующего новолуния.
 */
export function daysUntilNewMoon(date = new Date()) {
  const phase = getLunarPhase(date);
  const daysInCycle = phase * LUNAR_CYCLE;
  return Math.round(LUNAR_CYCLE - daysInCycle);
}

/**
 * Дней с последнего новолуния.
 */
export function daysSinceNewMoon(date = new Date()) {
  const phase = getLunarPhase(date);
  return Math.floor(phase * LUNAR_CYCLE);
}

/**
 * Возвращает true если сейчас «Тёмная Луна» — ±2 дня от новолуния.
 */
export function isDarkMoon(date = new Date()) {
  const since = daysSinceNewMoon(date);
  const until = daysUntilNewMoon(date);
  return since <= 1 || until <= 1;
}

/**
 * Эмодзи фазы Луны (8 фаз).
 */
export function getMoonEmoji(date = new Date()) {
  const phase = getLunarPhase(date);
  const icons = ["🌑","🌒","🌓","🌔","🌕","🌖","🌗","🌘"];
  return icons[Math.round(phase * 8) % 8];
}

/**
 * Человеческое название текущей фазы.
 */
export function getMoonPhaseName(date = new Date()) {
  const phase = getLunarPhase(date);
  if (phase < 0.03 || phase > 0.97) return "Новолуние";
  if (phase < 0.22) return "Молодая луна";
  if (phase < 0.28) return "Первая четверть";
  if (phase < 0.47) return "Прибывающая луна";
  if (phase < 0.53) return "Полнолуние";
  if (phase < 0.72) return "Убывающая луна";
  if (phase < 0.78) return "Последняя четверть";
  return "Тёмная луна";
}

/**
 * Возвращает краткое описание энергетики фазы.
 */
export function getMoonEnergyDesc(date = new Date()) {
  const phase = getLunarPhase(date);
  if (phase < 0.03 || phase > 0.97) return "Время новых начал и тайных ритуалов";
  if (phase < 0.25) return "Энергия роста — сей намерения";
  if (phase < 0.28) return "Момент выбора — действуй решительно";
  if (phase < 0.50) return "Сила нарастает — усиливай желания";
  if (phase < 0.53) return "Пик энергии — время проявления";
  if (phase < 0.75) return "Отпускай лишнее — освобождай пространство";
  if (phase < 0.78) return "Рефлексия и мудрость прошлого";
  return "Уход в тень — время признаний и тайн";
}
