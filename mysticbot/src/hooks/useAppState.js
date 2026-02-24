// ============================================================
// ХРАНИЛИЩЕ СОСТОЯНИЯ ПРИЛОЖЕНИЯ
// ============================================================
// Файл содержит только React-хук useAppState.
// Чистые функции, константы и утилиты вынесены в отдельные модули:
//   ./storage.js    — localStorage helpers, getDailyCache/setDailyCache
//   ./constants.js  — MOCK_USER, READING_LIMITS, лимиты гаданий, …
//   ./oracle.js     — extractNamesFromText, extractInsightsFromInteraction
//   ./astrology.js  — getZodiacSign, generateHoroscope, interpretTarot, …
//   ./prompts.js    — buildClaudeSystemPrompt, SPREAD_NAMES
// ============================================================

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { saveToLocal, loadFromLocal } from "./storage.js";
import {
  syncUser, fetchUser,
  saveTarotReading, fetchTarotHistory, migrateTarotHistory,
  saveDiaryEntry, fetchDiary, migrateDiaryEntries,
  saveOracleMemory, fetchOracleMemory,
  useCustomPromo, createServerPromo, deleteServerPromo, fetchServerPromos,
} from "../api/backend.js";
import { checkPendingPayment } from "../api/payments.js";
import TelegramSDK from "../api/telegram.js";
import {
  MOCK_USER, READING_LIMITS, DIARY_LIMITS, COMPAT_LIMITS,
  REFERRAL_COMPAT_DAILY,
} from "./constants.js";
import { extractInsightsFromInteraction } from "./oracle.js";
import { getZodiacSign, getUpcomingEvents } from "./astrology.js";
import { MAJOR_ARCANA } from "../data/tarot.js";

// Помощник: начало текущей недели (понедельник) — используется только внутри хука
function getWeekStart() {
  const now = new Date();
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(now.setDate(diff)).toDateString();
}

// Помощник: эффективный тариф с учётом даты истечения подписки.
// Если подписка истекла — проверяет base_subscription_tier (для VIP-пользователей,
// которые получили Premium через реферал), иначе возвращает "free".
function getEffectiveTier(userObj) {
  const tier = userObj?.subscription_tier || "free";
  if (tier === "free") return "free";
  if (userObj.subscription_until && new Date(userObj.subscription_until) < new Date()) {
    // Подписка истекла. Проверяем базовый тариф (актуально для VIP→Premium через реферал)
    const baseTier  = userObj?.base_subscription_tier;
    const baseUntil = userObj?.base_subscription_until ? new Date(userObj.base_subscription_until) : null;
    if (baseTier && baseTier !== "free" && baseUntil && baseUntil > new Date()) {
      return baseTier; // Возвращаем VIP, если его подписка ещё активна
    }
    return "free";
  }
  return tier;
}


// ============================================================
// ДОСТИЖЕНИЯ
// ============================================================
export const ACHIEVEMENTS_LIST = [
  // ── Первые шаги ────────────────────────────────────────────
  { id: "first_reading",      emoji: "🃏", title: "Первое гадание",           desc: "Начало мистического пути",                    luck: 5   },
  { id: "first_dream",        emoji: "🌙", title: "Первый сон",               desc: "Сны открывают путь к подсознанию",             luck: 5   },
  { id: "first_diary",        emoji: "📖", title: "Первая запись",            desc: "Дневник — зеркало твоей души",                 luck: 5   },
  { id: "first_compat",       emoji: "💕", title: "Первая совместимость",     desc: "Звёзды рассказали о твоих связях",             luck: 5   },
  // ── Серии (стрики) ─────────────────────────────────────────
  { id: "streak_3",           emoji: "🌱", title: "3 дня подряд",             desc: "Первые ростки преданности",                    luck: 8   },
  { id: "streak_7",           emoji: "🔥", title: "7 дней подряд",            desc: "Огонь преданности не гаснет",                  luck: 15  },
  { id: "streak_14",          emoji: "🌙", title: "2 недели подряд",          desc: "Луна прошла полный цикл вместе с тобой",       luck: 30  },
  { id: "streak_30",          emoji: "❤️‍🔥", title: "Месяц верности",           desc: "Ты настоящий мистик — 30 дней подряд",         luck: 75  },
  { id: "streak_60",          emoji: "⚡", title: "60 дней подряд",           desc: "Посвящённый — два месяца без перерыва",         luck: 120 },
  { id: "streak_100",         emoji: "👑", title: "100 дней подряд",          desc: "Архимаг. Дисциплина на уровне легенды",         luck: 250 },
  // ── Количество гаданий ─────────────────────────────────────
  { id: "reading_5",          emoji: "🌀", title: "5 гаданий",                desc: "Путь начат — карты уже знают тебя",            luck: 10  },
  { id: "reading_10",         emoji: "🔮", title: "10 гаданий",               desc: "Карты знают тебя всё лучше",                   luck: 20  },
  { id: "reading_25",         emoji: "💜", title: "25 гаданий",               desc: "Четверть сотни — ты уже опытный",              luck: 35  },
  { id: "reading_50",         emoji: "💫", title: "50 гаданий",               desc: "Полсотни обращений к картам",                  luck: 50  },
  { id: "reading_100",        emoji: "🌟", title: "100 гаданий",              desc: "Сто — это не число, это образ жизни",           luck: 100 },
  { id: "reading_200",        emoji: "🏛️", title: "200 гаданий",              desc: "Зал мудрецов распахнул для тебя двери",         luck: 200 },
  // ── Коллекция карт ─────────────────────────────────────────
  { id: "cards_10",           emoji: "📦", title: "10 карт собрано",          desc: "Коллекция пополняется",                        luck: 10  },
  { id: "cards_22",           emoji: "🎴", title: "22 Старших Аркана",       desc: "Все Старшие Арканы собраны!",                  luck: 50  },
  { id: "cards_40",           emoji: "🃏", title: "40 карт собрано",          desc: "Больше половины колоды в твоих руках",          luck: 30  },
  { id: "cards_78",           emoji: "🏆", title: "Полная колода",            desc: "Все 78 карт Таро собраны!",                    luck: 150 },
  // ── Время суток ────────────────────────────────────────────
  { id: "night_owl",          emoji: "🦉", title: "Ночной мистик",            desc: "Гадание в ночной тишине (00:00–04:59)",         luck: 10  },
  { id: "early_bird",         emoji: "🌅", title: "Рассветное гадание",       desc: "На заре карты особенно сильны (05:00–06:59)",   luck: 10  },
  { id: "midnight_oracle",    emoji: "🌑", title: "Оракул полуночи",          desc: "Гадание ровно в полночь",                      luck: 20  },
  // ── Астральные события ─────────────────────────────────────
  { id: "full_moon_reading",  emoji: "🌕", title: "Гадание в полнолуние",     desc: "Под полной луной карты особенно ясны",          luck: 20  },
  { id: "new_moon_reading",   emoji: "🌑", title: "Гадание в новолуние",      desc: "В темноте новолуния зарождается новое",         luck: 20  },
  { id: "special_day",        emoji: "⚡", title: "Гадание в особый день",    desc: "В сильный астральный день",                    luck: 25  },
  { id: "eclipse_reading",    emoji: "🌑✨", title: "Затмение",               desc: "Гадание в день солнечного или лунного затмения", luck: 50 },
  { id: "retrograde_reading", emoji: "☿", title: "Ретроградный Меркурий",    desc: "Осмелился гадать в период ретрограда",          luck: 15  },
  // ── Разнообразие практик ───────────────────────────────────
  { id: "runes_cast",         emoji: "ᚠ", title: "Первые руны",              desc: "Древняя мудрость рун обратилась к тебе",        luck: 10  },
  { id: "aura_scan",          emoji: "✨", title: "Аура прочитана",           desc: "Твоё энергетическое поле раскрыто",             luck: 10  },
  { id: "palmistry_done",     emoji: "🖐", title: "Линии судьбы",             desc: "Хиромант прочёл карту твоей ладони",            luck: 15  },
  { id: "all_spreads",        emoji: "🎲", title: "Коллекционер раскладов",   desc: "Попробовал все доступные расклады Таро",        luck: 30  },
  // ── Дневник ────────────────────────────────────────────────
  { id: "diary_7",            emoji: "📓", title: "7 записей в дневнике",     desc: "Дневник становится твоим зеркалом",             luck: 15  },
  { id: "diary_30",           emoji: "📕", title: "30 записей в дневнике",    desc: "Месяц наблюдения за собой",                    luck: 40  },
  // ── Опросники ──────────────────────────────────────────────
  { id: "quiz_1",             emoji: "🧬", title: "Первый опросник",          desc: "Оракул начал узнавать тебя глубже",             luck: 5   },
  { id: "quiz_all",           emoji: "🔬", title: "Душа раскрыта",            desc: "Все 5 опросников пройдены",                    luck: 30  },
  // ── Оракул ─────────────────────────────────────────────────
  { id: "oracle_1",           emoji: "🔮", title: "Голос Оракула",            desc: "Первый диалог с Персональным Оракулом",         luck: 10  },
  { id: "oracle_10",          emoji: "🌌", title: "Постоянный гость",         desc: "10 вопросов Персональному Оракулу",             luck: 25  },
  // ── Удача ──────────────────────────────────────────────────
  { id: "luck_100",           emoji: "💰", title: "100 очков удачи",          desc: "Счастливчик — первая сотня",                   luck: 15  },
  { id: "luck_500",           emoji: "💎", title: "500 очков удачи",          desc: "Везение стало твоей второй натурой",            luck: 50  },
];

export const useAppState = () => {
  const [user, setUser]               = useState(() => loadFromLocal("user", MOCK_USER));
  const [diary, setDiary]             = useState(() => loadFromLocal("diary", []));
  const [tarotHistory, setTarotHistory] = useState(() => loadFromLocal("tarot_history", []));
  const [dailyData, setDailyData]     = useState(() => loadFromLocal("daily_data", null));
  const [oracleMemory, setOracleMemory] = useState(() => loadFromLocal("oracle_memory", {}));
  const [currentPage, setCurrentPageRaw] = useState("home");
  const currentPageRef = useRef("home");
  const prevPageRef    = useRef("home");

  // Обёртка: запоминает предыдущую страницу для goBack()
  const setCurrentPage = useCallback((page) => {
    prevPageRef.current    = currentPageRef.current;
    currentPageRef.current = page;
    setCurrentPageRaw(page);
  }, []);

  // Возврат на предыдущую страницу
  const goBack = useCallback(() => {
    const prev = prevPageRef.current || "home";
    prevPageRef.current    = "home";
    currentPageRef.current = prev;
    setCurrentPageRaw(prev);
  }, []);

  const [investigation, setInvestigation] = useState(() => loadFromLocal("investigation", null));
  const [onboarding, setOnboarding]   = useState(() => !loadFromLocal("user", MOCK_USER).registered);
  // Статус администратора: проверяется на сервере (ADMIN_TELEGRAM_IDS в env).
  // Начальное значение false — панель скрыта до завершения проверки.
  const [isAdminUser, setIsAdminUser] = useState(false);

  // Debounce-таймер для синхронизации памяти оракула (не чаще раза в 30 сек)
  const oracleSyncTimer = useRef(null);

  const scheduleSyncOracleMemory = useCallback((mem) => {
    if (oracleSyncTimer.current) clearTimeout(oracleSyncTimer.current);
    oracleSyncTimer.current = setTimeout(() => {
      saveOracleMemory(mem).catch(() => {});
    }, 30_000); // 30 секунд после последнего изменения
  }, []);

  // Синхронизация при старте: мигрируем локальное → Supabase, или восстанавливаем ← Supabase
  useEffect(() => {
    if (onboarding) return;
    const localUser = loadFromLocal("user", MOCK_USER);
    if (!localUser.registered) return;

    // Обновляем updated_at при каждом открытии (для статистики онлайн)
    syncUser({}).catch(() => {});

    // Профиль: нет в Supabase → мигрируем локальный.
    // Есть в Supabase → восстанавливаем критичные поля если локальный кэш был сброшен
    // (Telegram WebApp может очищать localStorage при холодном старте или смене устройства).
    fetchUser().then(serverUser => {
      if (!serverUser) { syncUser(localUser).catch(() => {}); return; }

      // luck_points: берём максимум сервера и локального.
      // Это защищает от двух сценариев:
      //   1) кэш сброшен → local=0, server=100 → берём 100 ✓
      //   2) локально начислили пока не было инета → local=80, server=50 → берём 80 ✓
      const serverLuck = serverUser.luck_points ?? 0;
      const localLuck  = localUser.luck_points  ?? 0;
      if (serverLuck > localLuck) {
        setUser(prev => {
          const next = { ...prev, luck_points: serverLuck };
          saveToLocal("user", next);
          return next;
        });
      }

      // shop_purchases: берём максимум по каждому ключу.
      // Магазин не синхронизировался раньше → при очистке кэша покупки терялись.
      const serverShop = serverUser.shop_purchases || {};
      const localShop  = loadFromLocal("shop_purchases", {});
      let shopChanged  = false;
      const mergedShop = { ...localShop };
      for (const [k, v] of Object.entries(serverShop)) {
        if ((v || 0) > (mergedShop[k] || 0)) { mergedShop[k] = v; shopChanged = true; }
      }
      if (shopChanged) {
        saveToLocal("shop_purchases", mergedShop);
        setShopPurchases(mergedShop);
      }
    }).catch(() => {});

    // Таро: двусторонняя синхронизация
    const localHistory = loadFromLocal("tarot_history", []);
    fetchTarotHistory(50).then(serverHistory => {
      if (serverHistory === null) return;
      if (serverHistory.length === 0 && localHistory.length > 0) {
        // Сервер пуст, локально есть → мигрируем
        migrateTarotHistory(localHistory).catch(() => {});
      } else if (serverHistory.length > 0 && localHistory.length === 0) {
        // Локально пусто (кэш сброшен), сервер есть → восстанавливаем
        saveToLocal("tarot_history", serverHistory);
        setTarotHistory(serverHistory);
      }
    }).catch(() => {});

    // Дневник: двусторонняя синхронизация
    const localDiary = loadFromLocal("diary", []);
    fetchDiary(100).then(serverDiary => {
      if (serverDiary === null) return;
      if (serverDiary.length === 0 && localDiary.length > 0) {
        // Сервер пуст, локально есть → мигрируем
        migrateDiaryEntries(localDiary).catch(() => {});
      } else if (serverDiary.length > 0 && localDiary.length === 0) {
        // Локально пусто (кэш сброшен), сервер есть → восстанавливаем
        saveToLocal("diary", serverDiary);
        setDiary(serverDiary);
      }
    }).catch(() => {});

    // Проверяем ожидающий платёж при старте — необходимо если приложение
    // перезагрузилось после оплаты (hiddenAt = 0, visibilitychange не сработает).
    // Логика идентична обработчику в visibilitychange, но вызывается один раз при монтировании.
    const TIER_RANK_STARTUP = { free: 0, vip: 1, premium: 2 };
    // Поллинг ожидающего платежа: если ЮKassa ещё обрабатывает (pending),
    // повторяем до 10 раз через 3с. GET /api/payment?status= теперь сам
    // активирует подписку/удачу серверно (ensurePaymentApplied), поэтому
    // даже если вебхук ЮKassa не дошёл — данные попадут в Supabase.
    checkPendingPayment().then(async (result) => {
      if (!result) return;
      if (result.pending) {
        for (let i = 0; i < 10 && result?.pending; i++) {
          await new Promise(r => setTimeout(r, 3000));
          result = await checkPendingPayment();
        }
      }
      if (!result?.succeeded) return;

      if (result.type === "luck" && result.metadata?.luck) {
        const luckAmount = parseInt(result.metadata.luck, 10);
        if (luckAmount > 0) {
          setUser(prev => {
            const next = { ...prev, luck_points: (prev.luck_points || 0) + luckAmount };
            saveToLocal("user", next);
            return next;
          });
        }
      }

      if (result.type === "subscription" && result.metadata?.tier) {
        const purchasedTier = result.metadata.tier;
        const purchasedDays = parseInt(result.metadata.days || "30", 10);
        setUser(prev => {
          const currentTier  = prev.subscription_tier || "free";
          const bestTier = (TIER_RANK_STARTUP[purchasedTier] ?? 0) >= (TIER_RANK_STARTUP[currentTier] ?? 0)
            ? purchasedTier : currentTier;
          const prevUntilMs = prev.subscription_until ? new Date(prev.subscription_until).getTime() : 0;
          const baseMs      = Math.max(prevUntilMs, Date.now());
          const newUntil    = new Date(baseMs + purchasedDays * 86400000).toISOString();
          const next = { ...prev, subscription_tier: bestTier, subscription_until: newUntil };
          saveToLocal("user", next);
          return next;
        });
      }

      // Повторный fetchUser через 3с — подтверждаем данные с сервера
      const tierBefore = loadFromLocal("user", MOCK_USER).subscription_tier || "free";
      setTimeout(() => {
        fetchUser().then(serverUser => {
          if (!serverUser) return;
          setUser(prev => {
            const serverTier = serverUser.subscription_tier || "free";
            const currentTier = prev.subscription_tier || "free";
            const bestTier = (TIER_RANK_STARTUP[serverTier] ?? 0) >= (TIER_RANK_STARTUP[currentTier] ?? 0)
              ? serverTier : currentTier;
            const luck_points = result.type === "luck"
              ? Math.max(prev.luck_points || 0, serverUser.luck_points ?? 0)
              : serverUser.luck_points ?? prev.luck_points;
            const next = {
              ...prev,
              luck_points,
              subscription_tier:  bestTier,
              subscription_until: serverUser.subscription_until ?? prev.subscription_until,
            };
            saveToLocal("user", next);
            return next;
          });
          // Если подписка всё ещё не обновилась — ещё один retry через 5с
          if (result.type === "subscription" && serverUser.subscription_tier === tierBefore) {
            setTimeout(() => {
              fetchUser().then(u => {
                if (!u) return;
                setUser(prev => {
                  const serverTier = u.subscription_tier || "free";
                  const currentTier = prev.subscription_tier || "free";
                  const bestTier = (TIER_RANK_STARTUP[serverTier] ?? 0) >= (TIER_RANK_STARTUP[currentTier] ?? 0)
                    ? serverTier : currentTier;
                  if (bestTier === currentTier && u.luck_points === prev.luck_points) return prev;
                  const next = {
                    ...prev,
                    luck_points: u.luck_points ?? prev.luck_points,
                    subscription_tier:  bestTier,
                    subscription_until: u.subscription_until ?? prev.subscription_until,
                  };
                  saveToLocal("user", next);
                  return next;
                });
              }).catch(() => {});
            }, 5000);
          }
        }).catch(() => {});
      }, 3000);
    }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Heartbeat: обновляем updated_at каждые 5 минут, чтобы онлайн-статус был актуальным.
  // Также отправляем сигнал при возврате на вкладку (после паузы).
  useEffect(() => {
    if (onboarding) return;
    const localUser = loadFromLocal("user", MOCK_USER);
    if (!localUser.registered) return;

    const HEARTBEAT_MS = 5 * 60 * 1000; // 5 минут

    const beat = () => syncUser({}).catch(() => {});

    const timer = setInterval(beat, HEARTBEAT_MS);

    // При возврате на вкладку: 1) heartbeat 2) проверяем ожидающий платёж
    let hiddenAt = 0;
    const onVisibility = () => {
      if (document.hidden) {
        hiddenAt = Date.now();
      } else if (hiddenAt) {
        const wasHiddenMs = Date.now() - hiddenAt;
        hiddenAt = 0;

        // Heartbeat (только если скрыто > 1 мин)
        if (wasHiddenMs > 60_000) beat();

        // Проверяем статус ожидающего платежа (всегда при возврате).
        // Поллинг: если ЮKassa ещё обрабатывает (pending), повторяем до 10 раз через 3с.
        // GET /api/payment?status= теперь активирует подписку серверно (ensurePaymentApplied).
        checkPendingPayment().then(async (result) => {
          if (!result) return;
          if (result.pending) {
            for (let i = 0; i < 10 && result?.pending; i++) {
              await new Promise(r => setTimeout(r, 3000));
              result = await checkPendingPayment();
            }
          }
          if (!result?.succeeded) return;

          // Для покупки звёзд — начисляем локально сразу, не дожидаясь вебхука.
          // Вебхук ЮKassa асинхронен: к моменту возврата пользователя он мог не успеть
          // обновить БД, и fetchUser() вернул бы старое значение luck_points, затирая
          // локальный баланс. Начисляем из метаданных платежа, которые YooKassa
          // включает в объект payment.metadata (те же данные, что мы передали при создании).
          if (result.type === "luck" && result.metadata?.luck) {
            const luckAmount = parseInt(result.metadata.luck, 10);
            if (luckAmount > 0) {
              setUser(prev => {
                const next = { ...prev, luck_points: (prev.luck_points || 0) + luckAmount };
                saveToLocal("user", next);
                return next;
              });
            }
          }

          // Для подписки — применяем купленный тариф локально сразу (не ждём вебхук).
          // Это критично для апгрейда VIP→Премиум: без мгновенного локального обновления
          // fetchUser() возвращал бы старый тариф и пользователь не видел Премиум.
          if (result.type === "subscription" && result.metadata?.tier) {
            const purchasedTier = result.metadata.tier;
            const purchasedDays = parseInt(result.metadata.days || "30", 10);
            const TIER_RANK_SUB = { free: 0, vip: 1, premium: 2 };
            setUser(prev => {
              const currentTier = prev.subscription_tier || "free";
              const bestTier = (TIER_RANK_SUB[purchasedTier] ?? 0) >= (TIER_RANK_SUB[currentTier] ?? 0)
                ? purchasedTier : currentTier;
              // Продлеваем until сразу (фикс для VIP→VIP renewal):
              // canAccess проверяет subscription_until — без обновления продление незаметно.
              const prevUntilMs = prev.subscription_until ? new Date(prev.subscription_until).getTime() : 0;
              const baseMs      = Math.max(prevUntilMs, Date.now());
              const newUntil    = new Date(baseMs + purchasedDays * 86400000).toISOString();
              const next = { ...prev, subscription_tier: bestTier, subscription_until: newUntil };
              saveToLocal("user", next);
              return next;
            });
          }

          // Платёж подтверждён — обновляем данные из БД (подписка / eventual consistency).
          // Для подписки: если первый fetchUser вернул ещё старый тариф (вебхук не успел),
          // повторяем запрос через 3 секунды — к этому моменту вебхук гарантированно отработал.
          const applyServerUser = (serverUser, prevTier) => {
            if (!serverUser) return;
            setUser(prev => {
              // Для подписки защищаемся от перезаписи устаревшим значением:
              // берём "лучший" тариф между локальным ожиданием и серверным ответом.
              const TIER_RANK = { free: 0, vip: 1, premium: 2 };
              const serverTier = serverUser.subscription_tier || "free";
              const currentTier = prev.subscription_tier || "free";
              const bestTier = (TIER_RANK[serverTier] ?? 0) >= (TIER_RANK[currentTier] ?? 0)
                ? serverTier : currentTier;
              const bestUntil = serverUser.subscription_until ?? prev.subscription_until;

              const next = {
                ...prev,
                // Для звёзд: берём максимум — если вебхук уже отработал,
                // сервер вернёт обновлённое значение; если нет — оставляем
                // локально начисленное (не затираем его устаревшим серверным).
                luck_points: result.type === "luck"
                  ? Math.max(prev.luck_points || 0, serverUser.luck_points ?? 0)
                  : serverUser.luck_points ?? prev.luck_points,
                subscription_tier:  bestTier,
                subscription_until: bestUntil,
              };
              saveToLocal("user", next);
              return next;
            });

            // Если подписка ещё не обновилась на сервере — перепроверяем через 3 сек
            if (result.type === "subscription" && serverUser.subscription_tier === prevTier) {
              setTimeout(() => {
                fetchUser().then(u => applyServerUser(u, prevTier)).catch(() => {});
              }, 3000);
            }
          };

          const localTierBefore = loadFromLocal("user", MOCK_USER).subscription_tier || "free";
          fetchUser().then(u => applyServerUser(u, localTierBefore)).catch(() => {});
        }).catch(() => {});
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [onboarding]); // eslint-disable-line react-hooks/exhaustive-deps

  // Уведомления перенесены полностью в серверный CRON (GET /api/notifications).
  // CRON сам выбирает тип уведомления (астро-событие, серия, ротация) для каждого
  // пользователя и отправляет через Telegram Bot API — работает даже когда приложение закрыто.

  // Проверяем статус администратора через сервер (только для зарегистрированных).
  // Бэкенд возвращает 403 если telegram_id не в ADMIN_TELEGRAM_IDS (env).
  useEffect(() => {
    if (onboarding) return;
    const localUser = loadFromLocal("user", MOCK_USER);
    if (!localUser.registered) return;
    import("../api/backend.js").then(({ fetchUserStats }) => {
      fetchUserStats().then(stats => {
        if (stats && !stats.__error) setIsAdminUser(true);
      }).catch(() => {});
    }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Загружаем память оракула из Supabase при старте (только для зарегистрированных)
  useEffect(() => {
    if (onboarding) return;
    fetchOracleMemory().then(serverMem => {
      if (!serverMem) return;
      setOracleMemory(prev => {
        // Supabase — источник истины: берём серверные данные, но мержим с локальными
        // если на сервере session_count меньше (редкий случай рассинхрона)
        const serverCount = serverMem.session_count || 0;
        const localCount  = prev.session_count || 0;
        const merged = serverCount >= localCount ? { ...prev, ...serverMem } : { ...serverMem, ...prev };
        saveToLocal("oracle_memory", merged);
        return merged;
      });
    }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Тихий поллинг подписки на странице профиля (каждые 3 сек).
  // Обновляет ТОЛЬКО subscription_tier / subscription_until — так сервер
  // сообщает о результатах платежа, который вебхук ЮKassa записал в БД.
  //
  // luck_points намеренно НЕ обновляется здесь: поллинг получает серверное
  // значение, которое может быть НИЖЕ локального (вебхук ещё не обработан
  // или дебаунс luckSyncRef ещё не отправил трату) — это приводит к эффекту
  // "начислили и сразу списали". Для очков удачи используются:
  //   • checkPendingPayment (startup + visibilitychange) — начисляет при возврате с оплаты
  //   • luckSyncRef (debounce 5с) — синхронизирует траты в Supabase
  //   • Startup fetchUser [] — восстанавливает если сервер > локального
  useEffect(() => {
    if (onboarding || currentPage !== "profile") return;

    const TIER_RANK = { free: 0, vip: 1, premium: 2 };

    const poll = () => {
      fetchUser().then(serverUser => {
        if (!serverUser) return;
        setUser(prev => {
          const serverTier = serverUser.subscription_tier || "free";
          const currentTier = prev.subscription_tier || "free";
          // Не понижаем тариф: берём лучший из серверного и локального
          const bestTier = (TIER_RANK[serverTier] ?? 0) >= (TIER_RANK[currentTier] ?? 0)
            ? serverTier : currentTier;
          // Для until: берём ту дату что дальше в будущем (продление не должно откатываться)
          const prevUntil   = prev.subscription_until ? new Date(prev.subscription_until).getTime() : 0;
          const serverUntil = serverUser.subscription_until ? new Date(serverUser.subscription_until).getTime() : 0;
          const bestUntil   = serverUntil >= prevUntil
            ? (serverUser.subscription_until ?? prev.subscription_until)
            : prev.subscription_until;

          // Обновляем только если данные реально изменились — не вызываем лишних ре-рендеров
          if (bestTier === currentTier && bestUntil === prev.subscription_until) return prev;

          const next = {
            ...prev,
            subscription_tier:  bestTier,
            subscription_until: bestUntil,
          };
          saveToLocal("user", next);
          return next;
        });
      }).catch(() => {});
    };

    const timer = setInterval(poll, 3000);
    return () => clearInterval(timer);
  }, [onboarding, currentPage]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Обновить пользователя ---
  const updateUser = useCallback((updates) => {
    setUser(prev => {
      const next = { ...prev, ...(typeof updates === "function" ? updates(prev) : updates) };
      saveToLocal("user", next);
      return next;
    });
  }, []);

  // --- Память оракула: прямое обновление (для внешних компонентов) ---
  const updateOracleMemory = useCallback((updates) => {
    setOracleMemory(prev => {
      const next = typeof updates === "function" ? updates(prev) : { ...prev, ...updates };
      saveToLocal("oracle_memory", next);
      scheduleSyncOracleMemory(next);
      return next;
    });
  }, [scheduleSyncOracleMemory]);

  // --- Регистрация ---
  const completeRegistration = useCallback((userData) => {
    const sunSign = getZodiacSign(userData.birth_date);
    const newUser = {
      ...MOCK_USER, ...userData,
      sun_sign: sunSign, registered: true,
      luck_points: 10, streak_days: 1,
      last_login: new Date().toISOString(),
    };
    saveToLocal("user", newUser);
    setUser(newUser);
    setOnboarding(false);
    // Сохраняем пользователя в Supabase (fire-and-forget)
    syncUser(newUser).catch(() => {});
  }, []);

  // --- Удача ---
  const addLuck = useCallback((amount, reason = "") => {
    setUser(prev => {
      const newLuck = (prev.luck_points || 0) + amount;
      const alreadyUnlocked = new Set(prev.unlocked_achievements || []);
      const luckUnlocks = [];
      const checkLuckAch = (id, threshold) => {
        if (newLuck >= threshold && !alreadyUnlocked.has(id)) {
          luckUnlocks.push(id); alreadyUnlocked.add(id);
        }
      };
      checkLuckAch("luck_100", 100);
      checkLuckAch("luck_500", 500);
      const next = {
        ...prev,
        luck_points: newLuck,
        unlocked_achievements: Array.from(alreadyUnlocked),
        achievements_pending: [...(prev.achievements_pending || []), ...luckUnlocks],
      };
      saveToLocal("user", next);
      return next;
    });
  }, []);

  // --- Дневник ---
  const addDiaryEntry = useCallback((entry) => {
    const newEntry = { id: Date.now(), date: new Date().toISOString(), ...entry };
    setDiary(prev => {
      const next = [newEntry, ...prev].slice(0, 100); // max 100 записей
      saveToLocal("diary", next);
      return next;
    });
    // Увеличить счётчик дневных записей + проверить достижения дневника
    // Читаем из localStorage (а не из замкнутого state diary), чтобы избежать
    // stale closure: useCallback не пересоздаётся при каждом обновлении diary.
    const totalDiaryCount = loadFromLocal("diary", []).length + 1; // +1 за текущую запись
    setUser(prev => {
      const today = new Date().toDateString();
      const count = prev.diary_entries_today_date === today ? (prev.diary_entries_today || 0) + 1 : 1;
      const alreadyUnlocked = new Set(prev.unlocked_achievements || []);
      const diaryUnlocks = [];
      const checkDiaryAch = (id, cond) => {
        if (cond && !alreadyUnlocked.has(id)) { diaryUnlocks.push(id); alreadyUnlocked.add(id); }
      };
      checkDiaryAch("first_diary", totalDiaryCount === 1);
      checkDiaryAch("diary_7",     totalDiaryCount === 7);
      checkDiaryAch("diary_30",    totalDiaryCount === 30);
      const diaryLuck = diaryUnlocks.reduce((s, id) => {
        const a = ACHIEVEMENTS_LIST.find(a => a.id === id); return s + (a?.luck || 0);
      }, 0);
      const next = {
        ...prev,
        diary_entries_today: count,
        diary_entries_today_date: today,
        unlocked_achievements: Array.from(alreadyUnlocked),
        luck_points: (prev.luck_points || 0) + diaryLuck,
        achievements_pending: [...(prev.achievements_pending || []), ...diaryUnlocks],
      };
      saveToLocal("user", next);
      return next;
    });
    addLuck(3, "Запись в дневник");
    // Обновить настроение в памяти оракула
    const moodScores = {
      "😊": 4, "🥰": 5, "😄": 5, "🎉": 5, "😌": 4, "🤩": 5, "😎": 4,
      "😐": 3, "🤔": 3, "😤": 2, "😰": 2, "😢": 1, "😔": 2, "😞": 1, "😭": 1,
    };
    setOracleMemory(prev => {
      const score = moodScores[entry.mood] || 3;
      const moodHistory = [
        { date: new Date().toISOString().slice(0, 10), emoji: entry.mood || "😐", score },
        ...(prev.mood_history || []),
      ].slice(0, 30);
      let trend = prev.mood_trend || "стабильное";
      if (moodHistory.length >= 4) {
        const recent = moodHistory.slice(0, Math.min(6, moodHistory.length));
        const older = moodHistory.slice(Math.min(6, moodHistory.length), Math.min(12, moodHistory.length));
        const rAvg = recent.reduce((a, b) => a + b.score, 0) / recent.length;
        const oAvg = older.length > 0 ? older.reduce((a, b) => a + b.score, 0) / older.length : rAvg;
        trend = rAvg > oAvg + 0.4 ? "улучшается" : rAvg < oAvg - 0.4 ? "снижается" : "стабильное";
      }
      const next = { ...prev, mood_history: moodHistory, mood_trend: trend };
      saveToLocal("oracle_memory", next);
      scheduleSyncOracleMemory(next);
      return next;
    });
    // Сохраняем запись в Supabase (fire-and-forget)
    saveDiaryEntry(newEntry).catch(() => {});
  }, [addLuck, scheduleSyncOracleMemory]);

  // Проверка лимита записей дневника
  const canAddDiaryEntry = useCallback(() => {
    const today = new Date().toDateString();
    const currentUser = loadFromLocal("user", MOCK_USER);
    const tier = getEffectiveTier(currentUser);
    const limit = DIARY_LIMITS[tier] || DIARY_LIMITS.free;
    if (currentUser.diary_entries_today_date !== today) return true;
    return (currentUser.diary_entries_today || 0) < limit;
  }, []);

  const getDiaryLimit = useCallback(() => {
    const currentUser = loadFromLocal("user", MOCK_USER);
    const tier = getEffectiveTier(currentUser);
    return DIARY_LIMITS[tier] || DIARY_LIMITS.free;
  }, []);

  const getDiaryUsedToday = useCallback(() => {
    const today = new Date().toDateString();
    const currentUser = loadFromLocal("user", MOCK_USER);
    if (currentUser.diary_entries_today_date !== today) return 0;
    return currentUser.diary_entries_today || 0;
  }, []);

  // spendLuck: атомарная операция — проверка и списание в одном setUser-колбеке.
  // Используем ref для возврата результата из функционального обновления.
  const spendResultRef = useRef(false);
  const spendLuck = useCallback((amount) => {
    spendResultRef.current = false;
    setUser(prev => {
      if ((prev.luck_points || 0) < amount) return prev; // недостаточно — не меняем
      spendResultRef.current = true;
      const next = { ...prev, luck_points: prev.luck_points - amount };
      saveToLocal("user", next);
      return next;
    });
    return spendResultRef.current;
  }, []);

  // --- Магазин: покупки за очки удачи ---
  // Хранится отдельно от user, не протухает — покупки не пропадают.
  const [shopPurchases, setShopPurchases] = useState(() => loadFromLocal("shop_purchases", {}));

  const addShopPurchase = useCallback((key) => {
    setShopPurchases(prev => {
      const next = { ...prev, [key]: (prev[key] || 0) + 1 };
      saveToLocal("shop_purchases", next);
      return next;
    });
  }, []);

  // Списывает одну попытку. Возвращает true если успешно.
  // Атомарная проверка+списание через functional setState (аналогично spendLuck).
  const shopSpendRef = useRef(false);
  const useShopPurchase = useCallback((key) => {
    shopSpendRef.current = false;
    setShopPurchases(prev => {
      if ((prev[key] || 0) <= 0) return prev;
      shopSpendRef.current = true;
      const next = { ...prev, [key]: prev[key] - 1 };
      saveToLocal("shop_purchases", next);
      return next;
    });
    return shopSpendRef.current;
  }, []);

  // Дебаунсированный sync luck_points → Supabase.
  // Объявлен ПОСЛЕ shopPurchases чтобы избежать Temporal Dead Zone (ReferenceError).
  // Запускается при любом изменении баланса (стрик, ачивки, покупки и т.д.).
  const luckSyncRef = useRef(null);
  useEffect(() => {
    if (onboarding || !user.registered) return;
    clearTimeout(luckSyncRef.current);
    luckSyncRef.current = setTimeout(() => {
      syncUser({ luck_points: user.luck_points }).catch(() => {});
    }, 5000);
    return () => clearTimeout(luckSyncRef.current);
  }, [user.luck_points, onboarding, user.registered]); // eslint-disable-line react-hooks/exhaustive-deps

  // Централизованная проверка достижений luck_100 / luck_500.
  // addLuck() проверяет их, но luck_points также растёт через платежи,
  // награды за достижения, стрик-бонусы и т.д. — поэтому следим за самим значением.
  useEffect(() => {
    if (onboarding || !user.registered) return;
    const lp = user.luck_points || 0;
    const unlocked = user.unlocked_achievements || [];
    const thresholds = [
      { id: "luck_100", min: 100 },
      { id: "luck_500", min: 500 },
    ];
    const toUnlock = thresholds.filter(t => lp >= t.min && !unlocked.includes(t.id));
    if (toUnlock.length === 0) return;
    setUser(prev => {
      const already = new Set(prev.unlocked_achievements || []);
      const newUnlocks = [];
      let bonusLuck = 0;
      for (const t of toUnlock) {
        if (!already.has(t.id)) {
          already.add(t.id);
          newUnlocks.push(t.id);
          const ach = ACHIEVEMENTS_LIST.find(a => a.id === t.id);
          bonusLuck += ach?.luck || 0;
        }
      }
      if (newUnlocks.length === 0) return prev;
      const next = {
        ...prev,
        unlocked_achievements: Array.from(already),
        luck_points: (prev.luck_points || 0) + bonusLuck,
        achievements_pending: [...(prev.achievements_pending || []), ...newUnlocks],
      };
      saveToLocal("user", next);
      return next;
    });
  }, [user.luck_points, user.unlocked_achievements, onboarding, user.registered]); // eslint-disable-line react-hooks/exhaustive-deps

  // Дебаунсированный sync shop_purchases → Supabase.
  // Магазин раньше хранился только в localStorage — при очистке кэша покупки терялись.
  const shopSyncRef = useRef(null);
  useEffect(() => {
    if (onboarding) return;
    clearTimeout(shopSyncRef.current);
    shopSyncRef.current = setTimeout(() => {
      syncUser({ shop_purchases: shopPurchases }).catch(() => {});
    }, 3000);
    return () => clearTimeout(shopSyncRef.current);
  }, [shopPurchases, onboarding]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Гадание Таро (сохранение вопроса + карт + интерпретации + seed) ---
  const addTarotReading = useCallback((reading) => {
    const newReading = {
      id: Date.now(),
      date: new Date().toISOString(),
      spread: reading.spread,
      spreadId: reading.spreadId || "",
      question: reading.question || "",
      cards: reading.cards, // [{ name, reversed, position }]
      interpretation: reading.interpretation,
      prediction_seed: reading.prediction_seed || null, // "крючок на завтра"
      prediction_confirmed: null, // "yes" | "partly" | "no" | null
      mood_before: reading.mood_before || null,
    };
    setTarotHistory(prev => {
      const next = [newReading, ...prev].slice(0, 50); // max 50 гаданий
      saveToLocal("tarot_history", next);
      return next;
    });
    // Обновить счётчик гаданий + лимиты
    const today = new Date().toDateString();
    const spreadId = reading.spreadId || "";
    const weekStart = getWeekStart();
    setUser(prev => {
      const readingsToday = prev.readings_today_date === today ? { ...(prev.readings_today || {}) } : {};
      readingsToday[spreadId] = (readingsToday[spreadId] || 0) + 1;

      const readingsWeek = prev.readings_week_start === weekStart ? { ...(prev.readings_this_week || {}) } : {};
      readingsWeek[spreadId] = (readingsWeek[spreadId] || 0) + 1;

      // --- Коллекция карт ---
      const cardNames = (reading.cards || []).map(c => c.name).filter(Boolean);
      const existingCollection = new Set(prev.card_collection || []);
      cardNames.forEach(n => existingCollection.add(n));
      const newCollection = Array.from(existingCollection);

      // --- Проверка достижений (без showToast — складируем в pending) ---
      const newTotalReadings = (prev.total_readings || 0) + 1;
      const hour = new Date().getHours();
      const todayStr2 = new Date().toISOString().slice(0, 10);
      const isFullMoon = [
        "2026-01-17","2026-02-12","2026-03-14","2026-04-12","2026-05-11",
        "2026-06-09","2026-07-09","2026-08-07","2026-09-05","2026-10-05",
        "2026-11-03","2026-12-03",
      ].includes(todayStr2);

      const isNewMoon = [
        "2026-01-29","2026-02-28","2026-03-29","2026-04-27","2026-05-27",
        "2026-06-25","2026-07-25","2026-08-23","2026-09-21","2026-10-21",
        "2026-11-20","2026-12-19",
      ].includes(todayStr2);
      const isEclipse = [
        "2026-02-17","2026-03-03","2026-08-12","2026-08-28",
      ].includes(todayStr2);
      const minute = new Date().getMinutes();
      // Ретроградный Меркурий 2026
      const RETROGRADE = [
        { start: "2026-03-15", end: "2026-04-07" },
        { start: "2026-07-18", end: "2026-08-10" },
        { start: "2026-11-11", end: "2026-12-02" },
      ];
      const isRetrograde = RETROGRADE.some(r => todayStr2 >= r.start && todayStr2 <= r.end);
      // Расклады: если пользователь использовал все основные типы
      const spreadTypes = new Set(Object.keys(prev.readings_today || {}));
      const allSpreadsUsed = ["one_card","yes_no","three_cards","relationship","celtic_cross","star","horseshoe"]
        .every(s => (prev.readings_this_week || {})[s] > 0 || spreadId === s || spreadTypes.has(s));

      const alreadyUnlocked = new Set(prev.unlocked_achievements || []);
      const newUnlocks = [];
      const checkAch = (id) => { if (!alreadyUnlocked.has(id)) { newUnlocks.push(id); alreadyUnlocked.add(id); } };

      // Первые шаги
      if (newTotalReadings === 1)                    checkAch("first_reading");
      // Количество гаданий
      if (newTotalReadings === 5)                    checkAch("reading_5");
      if (newTotalReadings === 10)                   checkAch("reading_10");
      if (newTotalReadings === 25)                   checkAch("reading_25");
      if (newTotalReadings === 50)                   checkAch("reading_50");
      if (newTotalReadings === 100)                  checkAch("reading_100");
      if (newTotalReadings === 200)                  checkAch("reading_200");
      // Астральные события
      if (isFullMoon)                                checkAch("full_moon_reading");
      if (isNewMoon)                                 checkAch("new_moon_reading");
      if (isEclipse)                                 checkAch("eclipse_reading");
      if (isRetrograde)                              checkAch("retrograde_reading");
      // Время суток
      if (hour >= 0 && hour < 5)                     checkAch("night_owl");
      if (hour >= 5 && hour < 7)                     checkAch("early_bird");
      if (hour === 0 && minute <= 4)                  checkAch("midnight_oracle");
      // Коллекция карт
      if (newCollection.length >= 10)                checkAch("cards_10");
      if (newCollection.length >= 22)                checkAch("cards_22");
      if (newCollection.length >= 40)                checkAch("cards_40");
      if (newCollection.length >= 78)                checkAch("cards_78");
      // Разнообразие раскладов
      if (allSpreadsUsed)                            checkAch("all_spreads");

      const achievementLuck = newUnlocks.reduce((sum, id) => {
        const a = ACHIEVEMENTS_LIST.find(a => a.id === id);
        return sum + (a?.luck || 0);
      }, 0);

      const next = {
        ...prev,
        total_readings: newTotalReadings,
        readings_today: readingsToday,
        readings_today_date: today,
        readings_this_week: readingsWeek,
        readings_week_start: weekStart,
        card_collection: newCollection,
        unlocked_achievements: Array.from(alreadyUnlocked),
        luck_points: (prev.luck_points || 0) + achievementLuck,
        achievements_pending: [...(prev.achievements_pending || []), ...newUnlocks],
      };
      saveToLocal("user", next);
      return next;
    });
    // Обновить память оракула — извлечь имена, темы, сюжеты из вопроса
    setOracleMemory(prev => {
      const next = extractInsightsFromInteraction(reading.question, reading.cards || [], reading.spreadId, prev);
      saveToLocal("oracle_memory", next);
      scheduleSyncOracleMemory(next);
      return next;
    });
    // Продвигаем прогресс расследования (если активно, < 3)
    setInvestigation(prev => {
      if (!prev) return prev;
      const weekStart = getWeekStart();
      if (prev.weekStart !== weekStart) return prev;
      if ((prev.progress || 0) >= 3) return prev;
      const next = { ...prev, progress: (prev.progress || 0) + 1 };
      saveToLocal("investigation", next);
      return next;
    });
    // Сохраняем гадание в Supabase (fire-and-forget)
    saveTarotReading(newReading).catch(() => {});
  }, [scheduleSyncOracleMemory]);

  // --- Проверка лимита гаданий ---
  const canDoReading = useCallback((spreadId) => {
    const limit = READING_LIMITS[spreadId];
    if (!limit) return true;
    const currentUser = loadFromLocal("user", MOCK_USER);
    const tier = getEffectiveTier(currentUser);
    const maxCount = limit[tier] || 0;
    if (maxCount === 0) return false;

    if (limit.type === "daily") {
      const today = new Date().toDateString();
      if (currentUser.readings_today_date !== today) return true;
      const used = (currentUser.readings_today || {})[spreadId] || 0;
      return used < maxCount;
    }

    if (limit.type === "weekly") {
      const weekStart = getWeekStart();
      if (currentUser.readings_week_start !== weekStart) return true;
      const used = (currentUser.readings_this_week || {})[spreadId] || 0;
      return used < maxCount;
    }

    return true;
  }, []);

  const getReadingInfo = useCallback((spreadId) => {
    const limit = READING_LIMITS[spreadId];
    if (!limit) return { used: 0, max: 999, type: "daily" };
    const currentUser = loadFromLocal("user", MOCK_USER);
    const tier = getEffectiveTier(currentUser);
    const maxCount = limit[tier] || 0;
    const today = new Date().toDateString();
    const weekStart = getWeekStart();

    let used = 0;
    if (limit.type === "daily") {
      if (currentUser.readings_today_date === today) {
        used = (currentUser.readings_today || {})[spreadId] || 0;
      }
    } else if (limit.type === "weekly") {
      if (currentUser.readings_week_start === weekStart) {
        used = (currentUser.readings_this_week || {})[spreadId] || 0;
      }
    }
    return { used, max: maxCount, type: limit.type };
  }, []);

  // --- Streak ---
  const checkStreak = useCallback(() => {
    setUser(prev => {
      const today = new Date().toDateString();
      const lastLogin = prev.last_login ? new Date(prev.last_login).toDateString() : null;
      if (lastLogin === today) return prev; // уже заходил

      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const wasYesterday = lastLogin === yesterday.toDateString();
      const newStreak = wasYesterday ? (prev.streak_days || 0) + 1 : 1;
      const bonusLuck = newStreak >= 30 ? 50 : newStreak >= 7 ? 10 : 1;

      // Streak achievements
      const streakAlready = new Set(prev.unlocked_achievements || []);
      const streakUnlocks = [];
      const checkStrAch = (id, cond) => { if (cond && !streakAlready.has(id)) { streakUnlocks.push(id); streakAlready.add(id); } };
      checkStrAch("streak_3",   newStreak === 3);
      checkStrAch("streak_7",   newStreak === 7);
      checkStrAch("streak_14",  newStreak === 14);
      checkStrAch("streak_30",  newStreak === 30);
      checkStrAch("streak_60",  newStreak === 60);
      checkStrAch("streak_100", newStreak === 100);
      const streakAchLuck = streakUnlocks.reduce((sum, id) => {
        const a = ACHIEVEMENTS_LIST.find(a => a.id === id);
        return sum + (a?.luck || 0);
      }, 0);

      const next = {
        ...prev,
        streak_days: newStreak,
        last_login: new Date().toISOString(),
        luck_points: (prev.luck_points || 0) + bonusLuck + streakAchLuck,
        unlocked_achievements: Array.from(streakAlready),
        achievements_pending: [...(prev.achievements_pending || []), ...streakUnlocks],
        // Сброс дневных лимитов при новом дне
        readings_today: {},
        readings_today_date: today,
        diary_entries_today: 0,
        diary_entries_today_date: today,
        referral_compat_today: 0,
        referral_compat_today_date: today,
      };
      saveToLocal("user", next);
      // Обновляем last_login в Supabase (fire-and-forget)
      syncUser({ last_login: next.last_login, streak_days: next.streak_days }).catch(() => {});
      return next;
    });
  }, []);

  // --- Прочитать гороскоп (один раз в день) ---
  const readHoroscope = useCallback(() => {
    const today = new Date().toDateString();
    // Синхронная проверка через localStorage для защиты от повторного начисления
    const currentUser = loadFromLocal("user", MOCK_USER);
    if (currentUser.horoscope_read_today === today) return false;

    setUser(prev => {
      if (prev.horoscope_read_today === today) return prev; // уже читал
      const bonus = prev.subscription_tier === "vip" || prev.subscription_tier === "premium" ? 2 : 1;
      const next = {
        ...prev,
        horoscope_read_today: today,
        luck_points: (prev.luck_points || 0) + bonus,
      };
      saveToLocal("user", next);
      return next;
    });
    return true; // очки начислены
  }, []);

  const horoscopeReadToday = user.horoscope_read_today === new Date().toDateString();

  // --- Карта дня (1 раз в день) ---
  const isDailyCardUsed = useCallback(() => {
    const today = new Date().toDateString();
    const currentUser = loadFromLocal("user", MOCK_USER);
    return currentUser.daily_card_date === today;
  }, []);

  const markDailyCardUsed = useCallback(() => {
    const today = new Date().toDateString();
    setUser(prev => {
      const next = { ...prev, daily_card_date: today };
      saveToLocal("user", next);
      return next;
    });
  }, []);

  // --- Награды за уровень мастерства ---
  const claimLevelReward = useCallback((levelName, rewardPoints) => {
    const currentUser = loadFromLocal("user", MOCK_USER);
    const claimed = currentUser.level_rewards_claimed || [];
    if (claimed.includes(levelName)) return false;

    setUser(prev => {
      const alreadyClaimed = prev.level_rewards_claimed || [];
      if (alreadyClaimed.includes(levelName)) return prev;
      const next = {
        ...prev,
        luck_points: (prev.luck_points || 0) + rewardPoints,
        level_rewards_claimed: [...alreadyClaimed, levelName],
      };
      saveToLocal("user", next);
      return next;
    });
    return true;
  }, []);

  // --- Ежедневные данные (планеты/луна — обновляется раз в день) ---
  const getDailyData = useCallback(() => {
    const today = new Date().toDateString();
    const saved = loadFromLocal("daily_data", null);
    if (saved && saved.date === today) return saved; // кэш на день
    return null;
  }, []);

  const saveDailyData = useCallback((data) => {
    const toSave = { ...data, date: new Date().toDateString() };
    saveToLocal("daily_data", toSave);
    setDailyData(toSave);
  }, []);

  // --- Совместимость: лимиты ---
  const canCheckCompat = useCallback((type = "basic") => {
    const currentUser = loadFromLocal("user", MOCK_USER);
    const tier = currentUser.subscription_tier || "free";
    const weekStart = getWeekStart();
    const limits = COMPAT_LIMITS[type] || COMPAT_LIMITS.basic;
    const maxCount = limits[tier] || 0;
    const field = type === "detailed" ? "compat_detailed_this_week" : "compat_basic_this_week";
    if (currentUser.compat_week_start !== weekStart) return maxCount > 0;
    return (currentUser[field] || 0) < maxCount;
  }, []);

  const getCompatInfo = useCallback((type = "basic") => {
    const currentUser = loadFromLocal("user", MOCK_USER);
    const tier = currentUser.subscription_tier || "free";
    const weekStart = getWeekStart();
    const limits = COMPAT_LIMITS[type] || COMPAT_LIMITS.basic;
    const maxCount = limits[tier] || 0;
    const field = type === "detailed" ? "compat_detailed_this_week" : "compat_basic_this_week";
    const used = currentUser.compat_week_start === weekStart ? (currentUser[field] || 0) : 0;
    return { used, max: maxCount };
  }, []);

  const useCompatCheck = useCallback((type = "basic") => {
    const weekStart = getWeekStart();
    setUser(prev => {
      const field = type === "detailed" ? "compat_detailed_this_week" : "compat_basic_this_week";
      const currentWeek = prev.compat_week_start === weekStart ? (prev[field] || 0) : 0;
      const next = { ...prev, [field]: currentWeek + 1, compat_week_start: weekStart };
      saveToLocal("user", next);
      return next;
    });
  }, []);

  // --- Реферальная совместимость (бесплатная, до 5 раз/день) ---
  const canReferralCompat = useCallback(() => {
    const today = new Date().toDateString();
    const currentUser = loadFromLocal("user", MOCK_USER);
    if ((currentUser.referral_friends || []).length === 0) return false;
    if (currentUser.referral_compat_today_date !== today) return true;
    return (currentUser.referral_compat_today || 0) < REFERRAL_COMPAT_DAILY;
  }, []);

  const getReferralCompatInfo = useCallback(() => {
    const today = new Date().toDateString();
    const currentUser = loadFromLocal("user", MOCK_USER);
    const hasFriends = (currentUser.referral_friends || []).length > 0;
    const used = currentUser.referral_compat_today_date === today ? (currentUser.referral_compat_today || 0) : 0;
    return { used, max: REFERRAL_COMPAT_DAILY, hasFriends };
  }, []);

  const useReferralCompat = useCallback(() => {
    const today = new Date().toDateString();
    setUser(prev => {
      const used = prev.referral_compat_today_date === today ? (prev.referral_compat_today || 0) : 0;
      const next = { ...prev, referral_compat_today: used + 1, referral_compat_today_date: today };
      saveToLocal("user", next);
      return next;
    });
  }, []);

  // --- Генерация реферального кода (атомарная через localStorage) ---
  const getReferralCode = useCallback(() => {
    const currentUser = loadFromLocal("user", MOCK_USER);
    if (currentUser.referral_code) return currentUser.referral_code;
    const code = "MST-" + Math.random().toString(36).substring(2, 8).toUpperCase();
    // Атомарно записываем в localStorage до обновления React-состояния
    const updated = { ...currentUser, referral_code: code };
    saveToLocal("user", updated);
    setUser(prev => ({ ...prev, referral_code: code }));
    // Сохраняем код в Supabase — /api/referral ищет владельца по коду в БД,
    // без этого шага реферальная система никогда не найдёт пользователя.
    syncUser({ referral_code: code }).catch(() => {});
    return code;
  }, []);

  // --- Энергия дня: +10% за взаимодействие, каждые 10% = 1 очко удачи ---
  const addDailyEnergy = useCallback(() => {
    const today = new Date().toDateString();
    setUser(prev => {
      // Сброс если новый день
      const currentEnergy = prev.daily_energy_date === today ? (prev.daily_energy || 0) : 0;
      if (currentEnergy >= 100) return prev; // уже максимум

      const newEnergy = Math.min(100, currentEnergy + 10);
      // Определяем сколько новых "порогов 10%" пересечено → 1 очко за каждый
      const crossedThresholds = Math.floor(newEnergy / 10) - Math.floor(currentEnergy / 10);
      const luckBonus = crossedThresholds > 0 ? crossedThresholds : 0;
      const next = {
        ...prev,
        daily_energy: newEnergy,
        daily_energy_date: today,
        luck_points: (prev.luck_points || 0) + luckBonus,
      };
      saveToLocal("user", next);
      return next;
    });
  }, []);

  // --- Добавить реферала (друг зарегался по ссылке) ---
  const addReferralFriend = useCallback((friendName) => {
    setUser(prev => {
      const friends = [...(prev.referral_friends || []), { name: friendName, date: new Date().toISOString() }];
      const next = { ...prev, referral_friends: friends };
      saveToLocal("user", next);
      return next;
    });
  }, []);

  // --- Промокоды ---
  // Активация всегда идёт через сервер (POST /api/promo {action:"use"}).
  // Сервер валидирует код, проверяет повторную активацию и обновляет подписку в БД.
  const activatePromoCode = useCallback(async (code) => {
    const normalizedCode = code.trim().toUpperCase();

    const serverResult = await useCustomPromo(normalizedCode);

    if (serverResult.ok && serverResult.promo) {
      const promo = serverResult.promo;
      // Вычисляем дату окончания для локального UI (сервер уже записал в БД)
      const until = new Date();
      until.setDate(until.getDate() + promo.duration);

      // Обновляем локальное состояние для текущей сессии
      setUser(prev => {
        const next = {
          ...prev,
          subscription_tier:  promo.tier,
          subscription_until: until.toISOString(),
          activated_promos: [...(prev.activated_promos || []), normalizedCode],
        };
        saveToLocal("user", next);
        return next;
      });

      return { success: true, tier: promo.tier, duration: promo.duration };
    }

    if (!serverResult.ok && serverResult.error) {
      return { success: false, error: serverResult.error };
    }

    return { success: false, error: "Промокод не найден" };
  }, []);

  // --- Админ: проверка через сервер (ADMIN_TELEGRAM_IDS в env) ---
  // Значение проставляется в useEffect через /api/admin.
  // Локальная клиентская проверка намеренно убрана — она была обходима.
  const isAdmin = useCallback(() => isAdminUser, [isAdminUser]);

  // --- Админ: создать кастомный промокод (сохраняется в Supabase) ---
  const createCustomPromo = useCallback(async (code, tier, duration, maxUses) => {
    const normalizedCode = code.trim().toUpperCase();
    if (!normalizedCode) return { success: false, error: "Введи код" };
    // Статический список промокодов теперь только на сервере — уникальность
    // проверяется там же при активации (activated_promos в mystic_users).

    const result = await createServerPromo(normalizedCode, tier || "vip", duration || 30, maxUses || 1);
    if (result.ok) return { success: true };
    return { success: false, error: result.error || "Ошибка создания промокода" };
  }, []);

  // --- Админ: список кастомных промокодов (из Supabase) ---
  // Возвращает массив объектов { code, tier, duration, max_uses, used_count, created_at }
  const getCustomPromos = useCallback(async () => {
    return fetchServerPromos();
  }, []);

  // --- Админ: удалить кастомный промокод (из Supabase) ---
  const deleteCustomPromo = useCallback(async (code) => {
    await deleteServerPromo(code);
  }, []);

  // --- Доступ по тарифу: free(0) < vip(1) < premium(2) ---
  // Учитывает дату истечения подписки
  const canAccess = useCallback((tier) => {
    const levels = { free: 0, basic: 1, vip: 1, premium: 2 };
    const effectiveTier = getEffectiveTier(user);
    return (levels[effectiveTier] || 0) >= (levels[tier] || 0);
  }, [user.subscription_tier, user.subscription_until, user.base_subscription_tier, user.base_subscription_until]);

  // --- Подтверждение предсказания ---
  const confirmPrediction = useCallback((id, result) => {
    setTarotHistory(prev => {
      const next = prev.map(r => r.id === id ? { ...r, prediction_confirmed: result } : r);
      saveToLocal("tarot_history", next);
      return next;
    });
    // Бонус за честное подтверждение
    if (result === "yes")    addLuck(5, "Предсказание сбылось!");
    if (result === "partly") addLuck(2, "Предсказание частично сбылось");
  }, [addLuck]);

  // --- Последнее неподтверждённое гадание (было вчера или раньше) ---
  const getLastUnconfirmedReading = useCallback(() => {
    const yesterday = Date.now() - 12 * 60 * 60 * 1000; // 12+ часов назад
    return tarotHistory.find(r =>
      r.prediction_seed &&
      r.prediction_confirmed === null &&
      new Date(r.date).getTime() < yesterday
    ) || null;
  }, [tarotHistory]);

  // --- Хуки вовлечённости (для Home) ---
  const getEngagementHooks = useCallback(() => {
    const sign = user.sun_sign || "Рыбы";
    const streak = user.streak_days || 0;

    // Энергетическое окно по знаку
    const energyWindows = {
      "Овен": 14, "Лев": 13, "Стрелец": 15,       // Огонь — полдень
      "Телец": 8, "Дева": 7, "Козерог": 9,          // Земля — утро
      "Близнецы": 20, "Весы": 19, "Водолей": 21,    // Воздух — вечер
      "Рак": 22, "Скорпион": 23, "Рыбы": 21,        // Вода — ночь
    };
    const peakHour  = energyWindows[sign] || 21;
    const nowHour   = new Date().getHours();
    const hoursLeft = ((peakHour - nowHour + 24) % 24);
    const isWindowOpen = hoursLeft <= 2 || hoursLeft >= 22; // 2 часа до/после пика

    // Паттерн повторяющихся карт
    const cardFreq = {};
    tarotHistory.slice(0, 7).forEach(r =>
      (r.cards || []).forEach(c => { cardFreq[c.name] = (cardFreq[c.name] || 0) + 1; })
    );
    const repeatedCard = Object.entries(cardFreq).find(([, n]) => n >= 2)?.[0] || null;

    // Угроза потери серии
    const lastLogin    = user.last_login ? new Date(user.last_login) : null;
    const hoursElapsed = lastLogin ? (Date.now() - lastLogin.getTime()) / 3600000 : 0;
    const streakAtRisk = streak >= 2 && hoursElapsed > 20;

    // Непрочитанное предсказание
    const unconfirmed = getLastUnconfirmedReading();

    // Прогресс опросников
    const completedQuizzes = user.completed_quizzes || [];

    return { peakHour, hoursLeft, isWindowOpen, repeatedCard, streakAtRisk, streak, unconfirmed, completedQuizzes };
  }, [user, tarotHistory, getLastUnconfirmedReading]);

  // --- Контекст для Claude — расширенный семантический профиль ---
  const getContextForClaude = useCallback(() => {
    // Доминантная тема из гаданий (для эффекта ясновидящего)
    const topicCounts = {};
    (tarotHistory || []).forEach(r => {
      const q = (r.question || "").toLowerCase();
      if (/любов|отношен|парен|девушк|муж|жен|сердц/.test(q)) topicCounts.love   = (topicCounts.love   || 0) + 1;
      if (/работ|карьер|деньг|финанс|бизнес|проект/.test(q)) topicCounts.career  = (topicCounts.career  || 0) + 1;
      if (/здоров|болезн|самочувств/.test(q))                  topicCounts.health  = (topicCounts.health  || 0) + 1;
      if (/семь|дет|родител|дом/.test(q))                      topicCounts.family  = (topicCounts.family  || 0) + 1;
    });
    const sorted = Object.entries(topicCounts).sort((a, b) => b[1] - a[1]);
    const dominantTopic    = sorted[0]?.[0] || null;
    const dominantStrength = sorted[0]?.[1] || 0;

    // Дневник — последние записи (ограничиваем объём для системного промта)
    // Берём последние 7 записей и обрезаем каждую до 300 символов, чтобы не раздувать тело запроса
    const diaryFull = diary.slice(0, 7).map(e => {
      const date = e.date ? new Date(e.date).toLocaleDateString("ru-RU", { day: "numeric", month: "short" }) : "";
      const text = (e.text || "").slice(0, 300);
      return `[${date}] ${e.mood || "📝"} ${e.title ? `«${e.title}»` : ""}: ${text}`.trim();
    }).join("\n").slice(0, 2000);

    // Таро — последние 15 гаданий (вопрос + карты, без интерпретации)
    const tarotFull = (tarotHistory || []).slice(0, 15).map(e => {
      const cards = (e.cards || []).map(c => c.name + (c.reversed ? "↕" : "")).join(", ");
      return `${(e.question || "без вопроса").slice(0, 100)} — ${cards}`;
    }).join("\n").slice(0, 1500);

    // Время суток
    const hour = new Date().getHours();
    const timeOfDay = hour < 7 ? "ночь" : hour < 12 ? "утро" : hour < 17 ? "день" : hour < 22 ? "вечер" : "ночь";

    // Уровень близости по стрику
    const streak = user.streak_days || 0;
    const intimacyLevel = streak >= 30 ? "глубокий" : streak >= 7 ? "тёплый" : "новый";

    // Пол пользователя
    const genderMap = { female: "женщина", male: "мужчина", other: "не указан" };
    const gender = genderMap[user.gender] || null;

    // Семейное положение
    const relMap = {
      single: "в поиске", dating: "встречается", relationship: "в отношениях",
      married: "женат/замужем", complicated: "всё сложно", private: "не указано",
    };
    const relationshipStatus = relMap[user.relationship_status] || null;

    // Приоритеты
    const focusLabels = {
      love: "Любовь", career: "Карьера", finance: "Финансы",
      health: "Здоровье", spiritual: "Духовность", family: "Семья",
    };
    const lifeFocusPriority = (user.life_focus || []).length > 0
      ? (user.life_focus || []).map((f, i) => `${i + 1}. ${focusLabels[f] || f}`).join(", ")
      : null;

    // Возраст из даты рождения
    let userAge = null;
    if (user.birth_date) {
      const parts = user.birth_date.split("-");
      if (parts.length === 3) {
        const birthYear = parseInt(parts[0], 10);
        const birthMonth = parseInt(parts[1], 10);
        const now = new Date();
        userAge = now.getFullYear() - birthYear;
        if (now.getMonth() + 1 < birthMonth) userAge -= 1;
      }
    }

    // Карты, которые повторяются — паттерн судьбы
    const cardFreq = {};
    tarotHistory.forEach(r =>
      (r.cards || []).forEach(c => { cardFreq[c.name] = (cardFreq[c.name] || 0) + 1; })
    );
    const repeatingCards = Object.entries(cardFreq)
      .filter(([, n]) => n >= 2).map(([name]) => name);

    // Точность предсказаний (если 3+ подтверждений)
    const confirmedTotal = user.total_predictions || 0;
    const confirmedYes = user.confirmed_predictions || 0;
    const predictionAccuracy = confirmedTotal >= 3
      ? Math.round((confirmedYes / confirmedTotal) * 100) : null;

    // Память оракула — накопленные инсайты
    const mem = oracleMemory || {};
    const activeStorylines = (mem.storylines || []).filter(s => s.status === "active" && s.sessions >= 2);
    const topWorryWords = Object.entries(mem.worry_keywords || {})
      .sort((a, b) => b[1] - a[1]).slice(0, 3).map(([w]) => w);

    // Психологический профиль из опросников
    const quizProfile = [
      mem.quiz_soul_archetype,
      mem.quiz_life_compass,
      mem.quiz_element,
      mem.quiz_relationship_mirror,
      mem.quiz_shadow_side,
    ].filter(Boolean);

    return {
      // Базовый контекст
      diary_context:           diaryFull || null,
      tarot_context:           tarotFull || null,
      dominant_topic:          dominantTopic,
      dominant_topic_strength: dominantStrength,
      time_of_day:             timeOfDay,
      intimacy_level:          intimacyLevel,
      streak_days:             streak,
      prev_reading:            tarotHistory[0] || null,
      // Личный профиль (включая данные рождения)
      gender,
      relationship_status:     relationshipStatus,
      life_focus_priority:     lifeFocusPriority,
      sun_sign:                user.sun_sign || null,
      name:                    user.name || null,
      user_age:                userAge,
      birth_date:              user.birth_date || null,
      birth_time:              user.birth_time || null,
      birth_place:             user.birth_place || null,
      // Результаты анализов (сохранённые в oracle_memory)
      dream_history:           mem.dream_history || null,
      palmistry_summary:       mem.palmistry_summary || null,
      aura_color:              mem.aura_color || null,
      natal_summary:           mem.natal_summary || null,
      // Поведенческие паттерны
      repeating_cards:         repeatingCards.slice(0, 3),
      prediction_accuracy:     predictionAccuracy,
      // Память оракула — то, что оракул "видит" в человеке
      oracle_memory: {
        mentioned_names:    (mem.mentioned_names || []).slice(0, 5),
        active_storylines:  activeStorylines.slice(0, 3),
        oracle_knows:       (mem.oracle_knows || []).slice(0, 5),
        mood_trend:         mem.mood_trend || null,
        worry_keywords_top: topWorryWords,
        session_count:      mem.session_count || 0,
        preferred_time:     mem.preferred_time_of_day || null,
        quiz_profile:       quizProfile.length > 0 ? quizProfile : null,
      },
    };
  }, [diary, tarotHistory, user.streak_days, user.gender, user.relationship_status,
      user.life_focus, user.sun_sign, user.name, user.birth_date, user.birth_time,
      user.birth_place, user.total_predictions, user.confirmed_predictions, oracleMemory]);

  // --- Разблокировать достижение (из компонентов) ---
  const unlockAchievement = useCallback((id) => {
    const achievement = ACHIEVEMENTS_LIST.find(a => a.id === id);
    if (!achievement) return null;
    const currentUser = loadFromLocal("user", MOCK_USER);
    if ((currentUser.unlocked_achievements || []).includes(id)) return null;
    setUser(prev => {
      if ((prev.unlocked_achievements || []).includes(id)) return prev;
      const next = {
        ...prev,
        unlocked_achievements: [...(prev.unlocked_achievements || []), id],
        luck_points: (prev.luck_points || 0) + achievement.luck,
        achievements_pending: [...(prev.achievements_pending || []), id],
      };
      saveToLocal("user", next);
      return next;
    });
    return achievement;
  }, []);

  // --- Завершить опросник (сохраняет в completed_quizzes + проверяет достижения) ---
  const completeQuiz = useCallback((quizId) => {
    setUser(prev => {
      const already = prev.completed_quizzes || [];
      if (already.includes(quizId)) return prev;
      const newCompleted = [...already, quizId];
      const alreadyUnlocked = new Set(prev.unlocked_achievements || []);
      const quizUnlocks = [];
      if (!alreadyUnlocked.has("quiz_1")) { quizUnlocks.push("quiz_1"); alreadyUnlocked.add("quiz_1"); }
      if (newCompleted.length >= 5 && !alreadyUnlocked.has("quiz_all")) {
        quizUnlocks.push("quiz_all"); alreadyUnlocked.add("quiz_all");
      }
      const quizLuck = quizUnlocks.reduce((s, id) => {
        const a = ACHIEVEMENTS_LIST.find(a => a.id === id); return s + (a?.luck || 0);
      }, 0);
      const next = {
        ...prev,
        completed_quizzes: newCompleted,
        unlocked_achievements: Array.from(alreadyUnlocked),
        luck_points: (prev.luck_points || 0) + quizLuck,
        achievements_pending: [...(prev.achievements_pending || []), ...quizUnlocks],
      };
      saveToLocal("user", next);
      return next;
    });
  }, []);

  // --- Забрать достижение из очереди (для показа тоста в App) ---
  const popAchievementToast = useCallback(() => {
    const pending = (loadFromLocal("user", MOCK_USER).achievements_pending || []);
    if (pending.length === 0) return null;
    const id = pending[0];
    setUser(prev => {
      const next = { ...prev, achievements_pending: (prev.achievements_pending || []).slice(1) };
      saveToLocal("user", next);
      return next;
    });
    return ACHIEVEMENTS_LIST.find(a => a.id === id) || null;
  }, []);

  // Cleanup pending timers при размонтировании (смена аккаунта, logout и т.д.)
  useEffect(() => {
    return () => {
      if (oracleSyncTimer.current) clearTimeout(oracleSyncTimer.current);
      if (luckSyncRef.current) clearTimeout(luckSyncRef.current);
      if (shopSyncRef.current) clearTimeout(shopSyncRef.current);
    };
  }, []);

  return {
    user, updateUser, completeRegistration,
    diary, addDiaryEntry, canAddDiaryEntry, getDiaryLimit, getDiaryUsedToday,
    tarotHistory, addTarotReading,
    canDoReading, getReadingInfo,
    addLuck, spendLuck, checkStreak,
    shopPurchases, addShopPurchase, useShopPurchase,
    readHoroscope, horoscopeReadToday,
    isDailyCardUsed, markDailyCardUsed,
    claimLevelReward,
    canCheckCompat, getCompatInfo, useCompatCheck,
    canReferralCompat, getReferralCompatInfo, useReferralCompat,
    getReferralCode, addReferralFriend, addDailyEnergy,
    activatePromoCode, isAdmin,
    createCustomPromo, getCustomPromos, deleteCustomPromo,
    getDailyData, saveDailyData, dailyData,
    canAccess, currentPage, setCurrentPage,
    onboarding, setOnboarding,
    getContextForClaude,
    confirmPrediction, getLastUnconfirmedReading, getEngagementHooks,
    oracleMemory, updateOracleMemory,
    unlockAchievement, popAchievementToast, completeQuiz,
    investigation, setInvestigation,
    goBack,
    sendNotification: TelegramSDK.notifications.send,
  };
};

// ============================================================
// РЕ-ЭКСПОРТЫ ДЛЯ ОБРАТНОЙ СОВМЕСТИМОСТИ
// Все импорты в компонентах работают как раньше:
//   import { generateHoroscope, getDailyCache, … } from "../hooks/useAppState"
// ============================================================
export { getDailyCache, setDailyCache } from "./storage.js";
export { extractInsightsFromInteraction } from "./oracle.js";
export {
  getZodiacSign, MASTERY_LEVELS, getMasteryLevel,
  generateHoroscope, interpretTarot,
  DAILY_PLANETS_STUB, getPersonalizedPlanetInfluence,
  generateEventForecast, generatePersonalPlanetForecast,
  MYSTICAL_CALENDAR_2026, getPersonalizedRitual,
  getEventsForMonth, getUpcomingEvents,
  getSpecialDay, isMercuryRetrograde, MERCURY_RETROGRADE_2026,
} from "./astrology.js";
export { buildClaudeSystemPrompt, SPREAD_NAMES } from "./prompts.js";
