// ============================================================
// TELEGRAM WEBAPP AUTH — верификация initData подписи
// Документация: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
// ============================================================
import { createHmac } from "node:crypto";
import { safeStringEqual } from "./_security.js";

/**
 * Верифицирует initData из Telegram WebApp.
 * Возвращает telegram_id (строка) при успехе, null — при ошибке или отсутствии данных.
 *
 * @param {string} initData  — raw initData string из window.Telegram.WebApp.initData
 * @param {string} botToken  — TELEGRAM_BOT_TOKEN
 */
export const verifyTelegramAuth = (initData, botToken) => {
  if (!initData || !botToken) return null;
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get("hash");
    if (!hash) return null;

    params.delete("hash");

    // Строка для проверки: отсортированные key=value через \n
    const dataCheckString = [...params.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join("\n");

    // Ключ = HMAC-SHA256("WebAppData", bot_token)
    const secretKey = createHmac("sha256", "WebAppData")
      .update(botToken)
      .digest();

    const expectedHash = createHmac("sha256", secretKey)
      .update(dataCheckString)
      .digest("hex");

    if (!safeStringEqual(expectedHash, hash)) return null;

    const userStr = params.get("user");
    if (!userStr) return null;

    const user = JSON.parse(userStr);
    return user.id ? String(user.id) : null;
  } catch {
    return null;
  }
};

/**
 * Извлекает и верифицирует telegram_id из запроса.
 * Порядок:
 *  1. x-telegram-init-data хедер — полная верификация подписи (продакшен).
 *  2. Fallback: id из query/body без верификации (dev/browser режим).
 *
 * @param {object} req  — Vercel Request
 * @param {string} fallbackId  — id из query или body (если initData не передан)
 * @returns {{ ok: boolean, id: string|null, warn: string|null }}
 */
export const resolveUserId = (req, fallbackId) => {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const initData = req.headers["x-telegram-init-data"] || "";

  // Если initData передан — обязательно верифицируем
  if (initData) {
    const verifiedId = verifyTelegramAuth(initData, botToken);
    if (!verifiedId) {
      return { ok: false, id: null, warn: "Неверная подпись initData" };
    }
    return { ok: true, id: verifiedId, warn: null };
  }

  // Без initData — в продакшене запрещаем, в dev-режиме разрешаем fallback
  const isProduction = process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production";
  if (isProduction) {
    return { ok: false, id: null, warn: "initData обязателен" };
  }

  if (!fallbackId) {
    return { ok: false, id: null, warn: "id обязателен" };
  }
  return { ok: true, id: String(fallbackId), warn: "⚠️ Запрос без верификации (dev mode)" };
};
