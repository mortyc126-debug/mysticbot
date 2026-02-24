import { useState, useEffect, useRef, useMemo } from "react";
import { useAppState } from "./hooks/useAppState";
import ErrorBoundary from "./components/ErrorBoundary";
import Onboarding from "./pages/Onboarding";
import Home from "./pages/Home";
import Tarot from "./pages/Tarot";
import Astrology from "./pages/Astrology";
import DiaryPage from "./pages/DiaryPage";
import Profile from "./pages/Profile";
import Runes from "./pages/Runes";
import Palmistry from "./pages/Palmistry";
import Aura from "./pages/Aura";
import OracleChat from "./pages/OracleChat";
import Quizzes from "./pages/Quizzes";
import Investigation from "./pages/Investigation";
import BottomNav from "./components/BottomNav";
import LuckToast from "./components/LuckToast";
import TelegramSDK from "./api/telegram";
import BackendAPI from "./api/backend";
import ClaudeAPI from "./api/claude";
import { getZodiacSign } from "./hooks/useAppState";

// ============================================================
// TELEGRAM WEBAPP — инициализация
// ШАГ 1: Раскомментировать в index.html:
//   <script src="https://telegram.org/js/telegram-web-app.js"></script>
// ШАГ 2: TelegramSDK.init() вызывается автоматически ниже.
// ============================================================

// Страницы основной навигации (нижнее меню)
const NAV_PAGES = { home: Home, tarot: Tarot, astrology: Astrology, diary: DiaryPage, profile: Profile };
// Страницы второго уровня (открываются кнопками внутри приложения)
const EXTRA_PAGES = { runes: Runes, palmistry: Palmistry, aura: Aura, oracle: OracleChat, quizzes: Quizzes, investigation: Investigation };
const PAGES = { ...NAV_PAGES, ...EXTRA_PAGES };

export default function App() {
  const state = useAppState();
  const { onboarding, currentPage, setCurrentPage, checkStreak } = state;
  const [toast, setToast] = useState(null);
  // Отслеживаем предыдущее значение onboarding, чтобы активировать реферал
  // ТОЛЬКО при переходе new-user→registered, а не у уже зарегистрированных.
  const prevOnboardingRef = useRef(onboarding);

  // Инициализация Telegram WebApp SDK + сохранение реферального кода из start_param
  useEffect(() => {
    TelegramSDK.init();
    const startParam = window.Telegram?.WebApp?.initDataUnsafe?.start_param;
    if (startParam && /^MST-[A-Z0-9]{6}$/.test(startParam)) {
      localStorage.setItem("pending_referral", startParam);
    }
  }, []);

  // Стрик, сброс дневных лимитов + активация реферала после регистрации
  useEffect(() => {
    const prevOnboarding = prevOnboardingRef.current;
    prevOnboardingRef.current = onboarding;

    if (!onboarding) {
      checkStreak();
      // Реферал: активируется ТОЛЬКО при переходе онбординг→зарегистрирован.
      // Защита от срабатывания у уже зарегистрированных пользователей,
      // которые перешли по чужой реферальной ссылке без прохождения регистрации.
      const pendingCode = localStorage.getItem("pending_referral");
      if (pendingCode && prevOnboarding === true) {
        BackendAPI.registerReferral(pendingCode, state.user?.name || "Пользователь")
          .then(ok => { if (ok) localStorage.removeItem("pending_referral"); })
          .catch(() => {});
      }
    }
  }, [onboarding, checkStreak]);

  // Синхронизация данных из Supabase при каждом запуске (для уже зарегистрированных)
  // Подтягиваем referral_friends, subscription_tier/until — поля которые сервер
  // может обновить независимо от клиента (админ изменил подписку в БД, пришёл реферал и т.д.)
  useEffect(() => {
    if (onboarding) return;

    // Detect and save timezone once (minutes east of UTC, e.g. +180 for UTC+3)
    if (state.user?.utc_offset == null) {
      const utcOffset = -new Date().getTimezoneOffset();
      state.updateUser({ utc_offset: utcOffset });
      BackendAPI.syncUser({ utc_offset: utcOffset }).catch(() => {});
    }

    BackendAPI.fetchUser().then(serverUser => {
      if (!serverUser) return;
      const updates = {};

      // Рефералы: берём максимум из сервера и локального
      const serverFriends = serverUser.referral_friends || [];
      if (serverFriends.length > (state.user?.referral_friends || []).length) {
        updates.referral_friends = serverFriends;
      }

      // Подписка: обновляем если сервер сообщает об активной подписке.
      // Используем bestTier (не понижаем тариф): если checkPendingPayment уже поставил
      // "premium" локально, а вебхук ещё не успел и сервер возвращает "vip" —
      // прямая запись serverTier перезаписала бы "premium" обратно на "vip".
      if (serverUser.subscription_tier && serverUser.subscription_tier !== "free") {
        const until = serverUser.subscription_until ? new Date(serverUser.subscription_until) : null;
        const stillActive = !until || until > new Date();
        if (stillActive) {
          const TIER_RANK = { free: 0, vip: 1, premium: 2 };
          const serverTier = serverUser.subscription_tier;
          const localTier  = state.user?.subscription_tier || "free";
          const bestTier   = (TIER_RANK[serverTier] ?? 0) >= (TIER_RANK[localTier] ?? 0)
            ? serverTier : localTier;
          updates.subscription_tier  = bestTier;
          updates.subscription_until = serverUser.subscription_until;
        }
      }

      // Базовый тариф (для реверта VIP после истечения реферального Premium)
      if (serverUser.base_subscription_tier) {
        updates.base_subscription_tier  = serverUser.base_subscription_tier;
        updates.base_subscription_until = serverUser.base_subscription_until ?? null;
      }

      // Восстанавливаем данные рождения с сервера если локальный кэш пустой
      if (serverUser.birth_time && !state.user?.birth_time) {
        updates.birth_time = serverUser.birth_time;
      }
      if (serverUser.birth_place && !state.user?.birth_place) {
        updates.birth_place = serverUser.birth_place;
      }

      // Пересчитываем знак Луны и Асцендент если они отсутствуют, но есть дата рождения
      const needsNatal = serverUser.birth_date &&
        (!serverUser.moon_sign || !state.user?.moon_sign);
      if (needsNatal) {
        const bd = serverUser.birth_date || state.user?.birth_date;
        const bt = serverUser.birth_time || state.user?.birth_time || null;
        const bp = serverUser.birth_place || state.user?.birth_place || null;
        if (bd) {
          ClaudeAPI.calculateNatalSigns({
            birthDate: bd,
            birthTime: bt,
            birthPlace: bp,
            sunSign: getZodiacSign(bd),
          }).then(result => {
            if (result) {
              state.updateUser(result);
              BackendAPI.syncUser({
                moon_sign: result.moon_sign,
                ascendant: result.ascendant,
              }).catch(() => {});
            }
          }).catch(() => {});
        }
      }

      if (Object.keys(updates).length > 0) {
        state.updateUser(updates);
      }
    }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  if (onboarding) {
    return (
      <ErrorBoundary>
        <Onboarding state={state} showToast={showToast} />
      </ErrorBoundary>
    );
  }

  const PageComponent = PAGES[currentPage] || Home;
  const isNavPage = !!NAV_PAGES[currentPage];

  return (
    <ErrorBoundary>
      <div style={styles.app}>
        <Stars />
        <div style={styles.pageWrap}>
          {/* key={currentPage} запускает анимацию pageEnter при смене страницы */}
          <div key={currentPage} style={styles.pageAnimWrap}>
            <ErrorBoundary>
              <PageComponent state={state} showToast={showToast} />
            </ErrorBoundary>
          </div>
        </div>
        {isNavPage && <BottomNav currentPage={currentPage} setCurrentPage={setCurrentPage} />}
        {toast && <LuckToast message={toast} />}
      </div>
    </ErrorBoundary>
  );
}

function Stars() {
  const stars = useMemo(() =>
    Array.from({ length: 40 }).map(() => ({
      size: Math.random() > 0.8 ? 3 : 2,
      left: `${Math.random() * 100}%`,
      top: `${Math.random() * 100}%`,
      duration: 2 + Math.random() * 4,
      delay: Math.random() * 4,
      op: 0.3 + Math.random() * 0.6,
    })),
  []);

  return (
    <div style={styles.starsWrap}>
      {stars.map((s, i) => (
        <div key={i} style={{
          position: "absolute",
          width: s.size,
          height: s.size,
          background: "white",
          borderRadius: "50%",
          left: s.left,
          top: s.top,
          opacity: 0,
          animation: `twinkle ${s.duration}s ease-in-out ${s.delay}s infinite`,
          "--op": s.op,
        }} />
      ))}
    </div>
  );
}

const styles = {
  app: {
    background: "var(--bg)",
    height: "100%",          // 100% от #root (= 100dvh из CSS) — без бага адрес-бара
    maxWidth: 430,
    margin: "0 auto",
    position: "relative",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  pageWrap: {
    flex: 1,
    overflowY: "scroll",
    overflowX: "hidden",
    // BottomNav ~60px + safe-area iPhone ~34px + запас = 110px min
    paddingBottom: "calc(110px + env(safe-area-inset-bottom, 0px))",
    WebkitOverflowScrolling: "touch",
    position: "relative",
    zIndex: 1,
  },
  pageAnimWrap: {
    animation: "pageEnter 0.25s ease both",
    minHeight: "100%",
  },
  starsWrap: {
    position: "fixed",
    inset: 0,
    pointerEvents: "none",
    zIndex: 0,
    maxWidth: 430,
    margin: "0 auto",
  },
};
