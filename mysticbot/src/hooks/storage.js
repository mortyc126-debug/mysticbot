// ============================================================
// ЛОКАЛЬНОЕ ХРАНИЛИЩЕ — сохранение/загрузка состояния
// ============================================================

export const saveToLocal = (key, data) => {
  try { localStorage.setItem(`mystic_${key}`, JSON.stringify(data)); } catch {}
};

export const loadFromLocal = (key, fallback) => {
  try {
    const v = localStorage.getItem(`mystic_${key}`);
    return v ? JSON.parse(v) : fallback;
  } catch { return fallback; }
};

// ── Дневной кэш (сбрасывается автоматически в новый день) ──
// Используем локальную дату, а не UTC — иначе сброс происходил бы в полночь
// по UTC, а не по времени пользователя (критично для зон UTC+X).
const _todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export const getDailyCache = (key) => {
  try {
    const raw = localStorage.getItem(`mystic_daily_${key}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed.date !== _todayStr()) return null;
    return parsed.data;
  } catch { return null; }
};

export const setDailyCache = (key, data) => {
  try {
    localStorage.setItem(`mystic_daily_${key}`, JSON.stringify({ date: _todayStr(), data }));
  } catch {}
};
