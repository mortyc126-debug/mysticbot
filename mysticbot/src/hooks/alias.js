// ============================================================
// МИСТИЧЕСКИЙ ПСЕВДОНИМ
//
// Генерирует анонимный детерминированный публичный псевдоним
// на основе telegram_id + знака + тарифа.
//
// Формат: «⭐ Искатель Стрелец #4821»
// - Иконка тарифа:  🌙 Free  ⭐ VIP  👑 Premium
// - Роль:           зависит от знака, нейтральная форма
// - Знак зодиака:   sun_sign пользователя
// - Номер:          детерминирован из telegram_id (всегда одинаков)
// ============================================================

const SIGN_ROLES = {
  "Овен":      "Воин",
  "Телец":     "Хранитель",
  "Близнецы":  "Вестник",
  "Рак":       "Страж",
  "Лев":       "Властитель",
  "Дева":      "Провидец",
  "Весы":      "Судья",
  "Скорпион":  "Тайновед",
  "Стрелец":   "Искатель",
  "Козерог":   "Мудрец",
  "Водолей":   "Пророк",
  "Рыбы":      "Сновидец",
};

export const TIER_ICONS = {
  free:    "🌙",
  vip:     "⭐",
  premium: "👑",
};

export const TIER_LABELS = {
  free:    "Free",
  vip:     "VIP",
  premium: "Premium",
};

/** Простой детерминированный хэш строки → положительное число */
function simpleHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/**
 * Возвращает полный мистический псевдоним пользователя.
 *
 * @param {string|number} telegramId  — числовой ID Telegram
 * @param {string}        sunSign     — русское название знака, напр. "Стрелец"
 * @param {string}        tier        — "free" | "vip" | "premium"
 * @returns {string}  напр. "⭐ Искатель Стрелец #4821"
 */
export function getMysticalAlias(telegramId, sunSign, tier = "free") {
  const role = SIGN_ROLES[sunSign] || "Странник";
  const num  = String(simpleHash(String(telegramId)) % 9999 + 1).padStart(4, "0");
  const icon = TIER_ICONS[tier] || TIER_ICONS.free;
  const sign = sunSign || "Неизвестный";
  return `${icon} ${role} ${sign} #${num}`;
}

/**
 * Возвращает только числовой суффикс (#XXXX) для данного пользователя.
 * Полезно при отображении краткого псевдонима.
 */
export function getAliasNumber(telegramId) {
  return "#" + String(simpleHash(String(telegramId)) % 9999 + 1).padStart(4, "0");
}

/**
 * Определяет текущий тир пользователя с учётом срока подписки.
 * Используется для отображения тира в псевдониме и бейджах.
 */
export function getActiveTier(user) {
  if (!user) return "free";
  const tier  = user.subscription_tier;
  const until = user.subscription_until ? new Date(user.subscription_until) : null;
  if ((tier === "premium" || tier === "vip") && until && until > new Date()) {
    return tier;
  }
  return "free";
}
