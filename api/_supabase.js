// Общий Supabase клиент для всех serverless functions
// Переменные в Vercel: SUPABASE_URL, SUPABASE_SERVICE_KEY
//
// Синглтон: в рамках одного тёплого Vercel-инстанса клиент переиспользуется,
// чтобы не создавать лишние соединения при каждом вызове функции.
import { createClient } from "@supabase/supabase-js";

let _client = null;

export const getSupabase = () => {
  if (_client) return _client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL или SUPABASE_SERVICE_KEY не заданы в Vercel");
  _client = createClient(url, key);
  return _client;
};
