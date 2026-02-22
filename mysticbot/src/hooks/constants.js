// ============================================================
// КОНСТАНТЫ ПРИЛОЖЕНИЯ — лимиты, тарифы, промокоды
// ============================================================

export const MOCK_USER = {
  id: null, telegram_id: null,
  name: "", birth_date: "", birth_time: "", birth_place: "",
  gender: "", life_focus: [], relationship_status: "",
  sun_sign: "", moon_sign: "", ascendant: "",
  subscription_tier: "free",
  subscription_until: null,
  luck_points: 0, streak_days: 0, last_login: null,
  total_readings: 0, confirmed_predictions: 0, total_predictions: 0,
  horoscope_read_today: null, // дата последнего прочитанного гороскопа
  daily_card_date: null,      // дата получения карты дня
  // Энергия дня: накапливается по 10% за каждое взаимодействие, сбрасывается ежедневно
  daily_energy: 0,
  daily_energy_date: null,
  registered: false,
  // Лимиты на день (сбрасываются в checkStreak)
  readings_today: {},
  readings_today_date: null,
  diary_entries_today: 0,
  diary_entries_today_date: null,
  // Лимиты на неделю
  readings_this_week: {},
  readings_week_start: null,
  // Награды за уровень
  level_rewards_claimed: [],
  // Совместимость (недельные лимиты)
  compat_basic_this_week: 0,
  compat_detailed_this_week: 0,
  compat_week_start: null,
  // Реферальная совместимость (дневной лимит)
  referral_compat_today: 0,
  referral_compat_today_date: null,
  // Рефералы
  referral_code: null,
  referred_by: null,
  referral_friends: [],
  // Промокоды
  activated_promos: [],
  // Опросники
  completed_quizzes: [],
};

// ── Лимиты на гадания ──────────────────────────────────────
export const READING_LIMITS = {
  // Дневные лимиты: { free: N, vip: N, premium: N }
  one_card:     { type: "daily",  free: 1, vip: 1, premium: 1  },
  yes_no:       { type: "daily",  free: 3, vip: 5, premium: 10 },
  three_cards:  { type: "daily",  free: 0, vip: 2, premium: 5  },
  relationship: { type: "daily",  free: 0, vip: 2, premium: 5  },
  // Недельные лимиты
  celtic_cross: { type: "weekly", free: 0, vip: 0, premium: 1  },
  star:         { type: "weekly", free: 0, vip: 0, premium: 2  },
  horseshoe:    { type: "weekly", free: 0, vip: 0, premium: 1  },
};

// Лимиты записей в дневнике в день
export const DIARY_LIMITS = { free: 3, vip: 5, premium: 10 };

// ── Лимиты совместимости (в неделю) ───────────────────────
export const COMPAT_LIMITS = {
  basic:    { free: 2, vip: 5,  premium: 10 },
  detailed: { free: 0, vip: 3,  premium: 5  },
};
export const REFERRAL_COMPAT_DAILY = 5; // бесплатные проверки по рефералу в день

// Промокоды создаются через админ-панель и хранятся в таблице mystic_promos.
// Клиент не хранит список кодов — это устраняет утечку кодов в JS-бандле.
// Активация промокодов всегда идёт через POST /api/promo {action:"use"}.
// Статус администратора проверяется на сервере через ADMIN_TELEGRAM_IDS (env).
