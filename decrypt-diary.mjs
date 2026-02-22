// Запускать: node decrypt-diary.mjs
// Расшифровывает все ENC:... записи в mystic_diary и сохраняет как plain JSON

import { createDecipheriv } from "node:crypto";

// ─── НАСТРОЙКИ — вставь свои значения ───────────────────────────────────────
const SUPABASE_URL      = "ВСТАВЬ_СЮДА";   // например https://xxx.supabase.co
const SUPABASE_SERVICE_KEY = "ВСТАВЬ_СЮДА"; // service_role ключ из Supabase
const ENCRYPTION_KEY    = "ВСТАВЬ_СЮДА";   // 64 hex-символа из Vercel env
// ────────────────────────────────────────────────────────────────────────────

const PREFIX = "ENC:";
const ALG    = "aes-256-gcm";

function decryptObject(value) {
  if (!value) return null;
  if (typeof value === "object") return value;
  if (typeof value !== "string") return null;

  if (!value.startsWith(PREFIX)) {
    try { return JSON.parse(value); } catch { return null; }
  }

  try {
    const key = Buffer.from(ENCRYPTION_KEY, "hex");
    const rest = value.slice(PREFIX.length);
    const [ivHex, tagHex, ctHex] = rest.split(":");
    const iv        = Buffer.from(ivHex,  "hex");
    const tag       = Buffer.from(tagHex, "hex");
    const encrypted = Buffer.from(ctHex,  "hex");

    const decipher = createDecipheriv(ALG, key, iv);
    decipher.setAuthTag(tag);

    const plain = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
    return JSON.parse(plain);
  } catch (e) {
    console.error("Ошибка расшифровки:", e.message);
    return null;
  }
}

async function supabase(path, opts = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...opts,
    headers: {
      "apikey": SUPABASE_SERVICE_KEY,
      "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
      "Prefer": "return=minimal",
      ...(opts.headers || {}),
    },
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`Supabase error ${r.status}: ${text}`);
  }
  return opts.method === "PATCH" ? null : r.json();
}

async function main() {
  if (SUPABASE_URL === "ВСТАВЬ_СЮДА") {
    console.error("Заполни SUPABASE_URL, SUPABASE_SERVICE_KEY и ENCRYPTION_KEY в файле decrypt-diary.mjs");
    process.exit(1);
  }

  console.log("Читаем записи из mystic_diary...");

  const data = await supabase("/mystic_diary?select=id,entry&limit=10000");
  console.log(`Всего записей: ${data.length}`);

  const encrypted = data.filter(r => typeof r.entry === "string" && r.entry.startsWith(PREFIX));
  console.log(`Зашифрованных: ${encrypted.length}`);

  let migrated = 0, errors = 0;

  for (const row of encrypted) {
    const plain = decryptObject(row.entry);
    if (!plain) {
      console.warn(`  [!] Не удалось расшифровать id=${row.id}`);
      errors++;
      continue;
    }

    await supabase(`/mystic_diary?id=eq.${row.id}`, {
      method: "PATCH",
      body: JSON.stringify({ entry: plain }),
    });

    migrated++;
    if (migrated % 10 === 0) console.log(`  Обработано: ${migrated}/${encrypted.length}`);
  }

  console.log(`\nГотово! Расшифровано: ${migrated}, ошибок: ${errors}`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
