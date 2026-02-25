// ============================================================
// FIELD-LEVEL ENCRYPTION — AES-256-GCM
//
// Шифрует чувствительные поля перед записью в Supabase:
//   - текст записей дневника (diary.entry.text)
//   - память оракула (user.data.oracle_memory)
//
// Переменная Vercel: ENCRYPTION_KEY — 64 hex-символа (32 байта)
//   Генерация ключа: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
//   Или: openssl rand -hex 32
//
// Формат зашифрованного поля: "ENC:iv_hex:tag_hex:ciphertext_hex"
// Префикс ENC: позволяет отличить зашифрованные данные от открытых.
// ============================================================

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALG  = "aes-256-gcm";
const IV_BYTES  = 12; // 96-bit IV — оптимально для GCM
const TAG_BYTES = 16; // 128-bit authentication tag
const PREFIX    = "ENC:";

/**
 * Возвращает ключ из ENCRYPTION_KEY env или null если не задан.
 * Ключ — 64 hex-символа = 32 байта.
 */
const getKey = () => {
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) return null;
  try {
    return Buffer.from(hex, "hex");
  } catch {
    return null;
  }
};

/**
 * Шифрует строку.
 * Если ENCRYPTION_KEY не задан — возвращает исходный текст (graceful degradation).
 * @param {string} plaintext
 * @returns {string}  зашифрованная строка или исходная если ключ не задан
 */
export const encryptField = (plaintext) => {
  if (plaintext === null || plaintext === undefined) return plaintext;
  const str = String(plaintext);
  if (str.startsWith(PREFIX)) return str; // уже зашифровано

  const key = getKey();
  if (!key) return str; // ключ не задан → храним открыто

  const iv  = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALG, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(str, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return `${PREFIX}${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
};

/**
 * Расшифровывает строку.
 * Если строка не зашифрована или ключ не задан — возвращает как есть.
 * @param {string} ciphertext
 * @returns {string}
 */
export const decryptField = (ciphertext) => {
  if (!ciphertext || typeof ciphertext !== "string") return ciphertext;
  if (!ciphertext.startsWith(PREFIX)) return ciphertext; // не зашифровано

  const key = getKey();
  if (!key) {
    console.error("[Crypto] ENCRYPTION_KEY не задан — не могу расшифровать поле");
    return "[зашифровано]";
  }

  try {
    const rest = ciphertext.slice(PREFIX.length);
    const [ivHex, tagHex, ctHex] = rest.split(":");
    if (!ivHex || !tagHex || !ctHex) throw new Error("Неверный формат зашифрованного поля");

    const iv         = Buffer.from(ivHex,  "hex");
    const tag        = Buffer.from(tagHex, "hex");
    const encrypted  = Buffer.from(ctHex,  "hex");

    const decipher = createDecipheriv(ALG, key, iv);
    decipher.setAuthTag(tag);

    return Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]).toString("utf8");
  } catch (e) {
    console.error("[Crypto] Ошибка расшифровки:", e.message);
    return "[ошибка расшифровки]";
  }
};

/**
 * Шифрует объект целиком (сериализует в JSON, потом шифрует).
 * Удобно для JSONB-полей в Supabase.
 * @param {object} obj
 * @returns {string}  зашифрованная строка
 */
export const encryptObject = (obj) => {
  if (obj === null || obj === undefined) return obj;
  return encryptField(JSON.stringify(obj));
};

/**
 * Расшифровывает строку и возвращает распарсенный объект.
 * @param {string|object} value  зашифрованная строка или уже распарсенный объект
 * @returns {object|null}
 */
export const decryptObject = (value) => {
  if (!value) return null;
  // Если Supabase вернул уже распарсенный JSONB объект — возвращаем как есть
  if (typeof value === "object") return value;
  if (typeof value !== "string") return null;
  // Если это зашифрованная строка — расшифровываем
  if (value.startsWith(PREFIX)) {
    try {
      return JSON.parse(decryptField(value));
    } catch {
      return null;
    }
  }
  // Открытый JSON-текст (legacy или ключ не задан)
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

/**
 * Возвращает true если ENCRYPTION_KEY задан и корректен.
 */
export const isEncryptionEnabled = () => getKey() !== null;
