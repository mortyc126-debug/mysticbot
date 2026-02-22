// ============================================================
// SECURITY UTILITIES — общие механизмы защиты для всех API
// ============================================================
import { timingSafeEqual, createHash } from "node:crypto";

// ── CORS ────────────────────────────────────────────────────
// В production разрешаем только домен из WEBAPP_URL.
// В development разрешаем все домены (для локальной отладки).
export const setCorsHeaders = (res, methods = "GET, POST, OPTIONS") => {
  const origin = process.env.WEBAPP_URL;
  const isProd = process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production";

  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  } else if (isProd) {
    // Продакшн без WEBAPP_URL — запрещаем все cross-origin запросы
    res.setHeader("Access-Control-Allow-Origin", "null");
  } else {
    // Разработка — разрешаем все (локальная среда)
    res.setHeader("Access-Control-Allow-Origin", "*");
  }

  res.setHeader("Access-Control-Allow-Methods", methods);
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-telegram-init-data");
  res.setHeader("Vary", "Origin");
};

// ── Стандартные заголовки безопасности ──────────────────────
export const setSecurityHeaders = (res) => {
  res.setHeader("X-Content-Type-Options",  "nosniff");
  res.setHeader("X-Frame-Options",         "DENY");
  // X-XSS-Protection намеренно не выставляем: устарел, может вызвать уязвимости в IE
  res.setHeader("Referrer-Policy",         "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy",      "camera=(), microphone=(), geolocation=()");
  res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
  // Запрещаем кэширование API-ответов — данные персонализированы и меняются.
  // Без этого заголовка Vercel CDN и браузер могут возвращать 304 с устаревшими
  // данными вместо актуального ответа от Supabase.
  res.setHeader("Cache-Control", "no-store, private");
  res.setHeader("Pragma",        "no-cache");

  const isProd = process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production";
  if (isProd) {
    // HSTS — только в продакшне (2 года, включая субдомены)
    res.setHeader("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  }
};

// ── Защищённые поля пользователя ────────────────────────────
// Клиент НЕ может менять эти поля через /api/user POST.
//
// referral_code     — намеренно НЕ защищён: клиент генерирует код один раз и
//                     должен сохранить его в Supabase, иначе /api/referral
//                     не найдёт владельца кода и реферальная система не работает.
// subscription_tier / subscription_until — защищены: управляются только сервером
//                     через /api/promo (action="use"). Это исключает возможность
//                     самовольно выдать себе подписку через прямой POST /api/user.
const PROTECTED_USER_FIELDS = new Set([
  "referral_friends",    // только сервер добавляет рефералов через /api/referral
  "activated_promos",    // клиент не может "ретроспективно" активировать промокоды
  "telegram_id",
  "referred_by",
  "subscription_tier",   // только сервер меняет тариф через /api/payment или /api/promo
  "subscription_until",  // только сервер меняет срок через /api/payment или /api/promo
  "processed_payments",  // идемпотентность платежей — только сервер управляет списком
]);

export const sanitizeUserData = (data) => {
  const clean = { ...data };
  const blocked = [];
  for (const field of PROTECTED_USER_FIELDS) {
    if (field in clean) {
      blocked.push(field);
      delete clean[field];
    }
  }
  if (blocked.length > 0) {
    console.warn("[Security] Заблокированы защищённые поля:", blocked.join(", "));
  }
  return clean;
};

// ── Рекурсивная санитизация произвольных объектов ───────────
// Ограничивает строки (10K), массивы (100 элементов), глубину (3 уровня).
// Используется для записей дневника и таро перед сохранением в БД.
const _sanitizeValue = (val, depth) => {
  if (val === null || val === undefined) return val;
  if (typeof val === "string")  return val.slice(0, 10_000);
  if (typeof val === "number" || typeof val === "boolean") return val;
  if (depth >= 3) return null; // ограничиваем вложенность

  if (Array.isArray(val)) {
    return val
      .slice(0, 100)
      .map(v => _sanitizeValue(v, depth + 1))
      .filter(v => v !== null && v !== undefined);
  }
  if (typeof val === "object") {
    const clean = {};
    for (const [k, v] of Object.entries(val)) {
      if (typeof k !== "string" || k.length > 100) continue;
      const s = _sanitizeValue(v, depth + 1);
      if (s !== null && s !== undefined) clean[k] = s;
    }
    return clean;
  }
  return null;
};

/**
 * Санитизирует объект записи дневника.
 * @returns {object|null}
 */
export const sanitizeDiaryEntry = (entry) => {
  const result = _sanitizeValue(entry, 0);
  return result && typeof result === "object" && !Array.isArray(result) ? result : null;
};

/**
 * Санитизирует объект расклада таро.
 * @returns {object|null}
 */
export const sanitizeTarotReading = (reading) => {
  const result = _sanitizeValue(reading, 0);
  return result && typeof result === "object" && !Array.isArray(result) ? result : null;
};

// ── Валидация строки-даты ────────────────────────────────────
export const validateDateString = (str) => {
  if (!str || typeof str !== "string") return false;
  return /^\d{4}-\d{2}-\d{2}(T[\d:.Z+-]+)?$/.test(str) && !isNaN(Date.parse(str));
};

// ── Ограничение параметра limit ──────────────────────────────
export const capLimit = (value, max = 100) => {
  const n = parseInt(value, 10);
  if (isNaN(n) || n <= 0) return 50;
  return Math.min(n, max);
};

// ── Проверка размера тела запроса ────────────────────────────
export const checkBodySize = (body, maxBytes = 64_000) => {
  try {
    return JSON.stringify(body || {}).length <= maxBytes;
  } catch {
    return false;
  }
};

// ── Проверка строки: только ожидаемый тип и длина ───────────
export const validateString = (value, maxLen = 5000) => {
  if (value === null || value === undefined) return true;
  return typeof value === "string" && value.length <= maxLen;
};

// ── Проверка прав администратора (по Telegram ID) ───────────
// Список задаётся в env: ADMIN_TELEGRAM_IDS=123456,789012
export const isAdminId = (telegramId) => {
  if (!telegramId) return false;
  const adminIds = (process.env.ADMIN_TELEGRAM_IDS || "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
  return adminIds.includes(String(telegramId));
};

// ── Константное время сравнения строк (защита от timing атак) ─
// SHA-256 нормализует длину до 32 байт — полностью устраняет timing leak на разнице длин.
const _sha256 = (str) => createHash("sha256").update(String(str ?? ""), "utf8").digest();

export const safeStringEqual = (a, b) => {
  try {
    return timingSafeEqual(_sha256(a), _sha256(b));
  } catch {
    return false;
  }
};

// ── Защита от prompt injection ───────────────────────────────
// Нейтрализует попытки переключить роль, переопределить инструкции или извлечь системный промт.
const INJECTION_PATTERNS = [
  // Классические команды переключения (английский)
  /ignore\s+(all\s+)?(previous|prior|above|earlier)\s+instructions?/gi,
  /disregard\s+(all\s+)?(previous|prior|above)\s+instructions?/gi,
  /forget\s+(all\s+)?(your\s+)?(previous|prior|all|the\s+above)\s+(instructions?|rules?|training|context)/gi,
  /override\s+(previous|prior|all)\s+instructions?/gi,
  /bypass\s+(all\s+)?(previous|prior)?\s*(instructions?|filters?|restrictions?|rules?)/gi,
  /without\s+(any\s+)?restrictions?/gi,
  /no\s+restrictions?/gi,
  /do\s+anything\s+now/gi,
  /ignore\s+(your\s+)?(previous\s+)?(training|rules?|guidelines?)/gi,
  // Смена роли / persona (английский)
  /you\s+are\s+now\s+(a\s+|an\s+)?/gi,
  /act\s+as\s+(a\s+|an\s+)?(different|new|another)?/gi,
  /pretend\s+(you\s+are|to\s+be)\s+/gi,
  /roleplay\s+as\s+/gi,
  /jailbreak/gi,
  /dan\s+mode/gi,
  /developer\s+mode/gi,
  /god\s+mode/gi,
  /unrestricted\s+mode/gi,
  // Манипуляции с системными тегами (LLM-специфичные)
  /<\/?system>/gi,
  /<\/?human>/gi,
  /<\/?assistant>/gi,
  /\[INST\]/gi,
  /\[\/INST\]/gi,
  /<<SYS>>/gi,
  /\[SYSTEM\]/gi,
  // Попытки вывести системный промт (английский)
  /reveal\s+(your\s+)?(system\s+prompt|instructions?|training)/gi,
  /show\s+(me\s+)?(your\s+)?(system\s+prompt|instructions?)/gi,
  /what\s+(is|are)\s+your\s+(system\s+prompt|instructions?|rules?)/gi,
  /repeat\s+(your\s+)?(system\s+prompt|instructions?)/gi,
  // Русскоязычные паттерны
  /игнорируй\s+(все\s+)?(предыдущие\s+)?(инструкции|правила|ограничения)/gi,
  /забудь\s+(все\s+)?(что\s+ты|предыдущие\s+инструкции)/gi,
  /ты\s+теперь\s+(являешься\s+|это\s+)?/gi,
  /притворись\s+(что\s+ты\s+|будто\s+)/gi,
  /действуй\s+как\s+/gi,
  /представь\s+(что\s+ты|себя\s+)/gi,
  /сыграй\s+роль\s+/gi,
  /без\s+(каких.либо\s+)?ограничений/gi,
  /покажи\s+(свой\s+)?(системный\s+промт|инструкции)/gi,
  /раскрой\s+(свой\s+)?(системный\s+промт|инструкции)/gi,
];

export const sanitizePrompt = (text, maxLen = 6000) => {
  if (!text || typeof text !== "string") return "";

  // Убираем zero-width символы и нормализуем Unicode (защита от Unicode-обфускации)
  let safe = text
    .replace(/[\u200B-\u200D\uFEFF\u00AD\u034F\u2060-\u2064\u206A-\u206F]/g, "")
    .normalize("NFKC")
    .slice(0, maxLen);

  for (const pattern of INJECTION_PATTERNS) {
    safe = safe.replace(pattern, (match) => "*".repeat(Math.min(match.length, 10)));
  }
  return safe;
};

// ── Rate limiting через Map (in-memory, per serverless instance) ─
// Для полноценного rate limiting между инстансами — Vercel KV / Upstash Redis.
const rateLimitStore = new Map();

export const rateLimit = (key, maxRequests = 10, windowMs = 60_000) => {
  const now = Date.now();
  const entry = rateLimitStore.get(key) || { count: 0, reset: now + windowMs };

  if (now > entry.reset) {
    entry.count = 1;
    entry.reset = now + windowMs;
  } else {
    entry.count++;
  }

  rateLimitStore.set(key, entry);

  // Чистим просроченные записи при превышении 1000 ключей
  if (rateLimitStore.size > 1000) {
    for (const [k, v] of rateLimitStore) {
      if (now > v.reset) rateLimitStore.delete(k);
    }
  }

  return entry.count <= maxRequests;
};
