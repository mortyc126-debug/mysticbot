// ============================================================
// МИСТИЧЕСКОЕ СООБЩЕСТВО — страница публичной соцсети
//
// Phase 1: Лента постов (пророчества, ритуалы, размышления, признания)
// Phase 2: Нити Судьбы, Тёмная Луна, Индекс Судьбы, Лунный виджет
// ============================================================
import { useState, useEffect, useCallback, useRef } from "react";
import { AppHeader, Modal, Btn, SLabel } from "../components/UI";
import { getMysticalAlias, getActiveTier, TIER_ICONS, TIER_LABELS } from "../hooks/alias";
import { fetchPosts, createPost, reactToPost }              from "../api/posts";
import { fetchMyThreads, discoverSouls, createThread, deleteThread } from "../api/threads";
import { getUserId } from "../api/backend";
import {
  getLunarPhase, getMoonEmoji, getMoonPhaseName,
  getMoonEnergyDesc, isDarkMoon, daysUntilNewMoon,
} from "../hooks/moon";

// ── Вопросы дня (ротация по ISO-неделе) ─────────────────────
const DAILY_QUESTIONS = [
  "Какое пророчество ты несёшь в этот мир?",
  "Что звёзды говорят тебе прямо сейчас?",
  "Какой ритуал изменил твою жизнь?",
  "О чём молчит твоя интуиция последние дни?",
  "Какую тайну ты готов открыть Вселенной?",
  "Что ты видел во сне, что не можешь забыть?",
  "Какой знак судьбы ты получил на этой неделе?",
  "Какое желание ты отпускаешь в ночь?",
  "Что бы сказал тебе твой будущий я?",
  "Какую энергию ты несёшь сегодня миру?",
  "Что ты видишь, когда закрываешь глаза?",
  "Какую карту жизни ты бы перевернул?",
];

function getWeekQuestion() {
  const now = new Date();
  const startOfYear = new Date(now.getFullYear(), 0, 1);
  const week = Math.floor((now - startOfYear) / (7 * 24 * 60 * 60 * 1000));
  return DAILY_QUESTIONS[week % DAILY_QUESTIONS.length];
}

// ── Типы постов ──────────────────────────────────────────────
const POST_TYPES = [
  { id: "all",         label: "Все",          icon: "🌐" },
  { id: "prophecy",    label: "Пророчества",  icon: "🔮" },
  { id: "ritual",      label: "Ритуалы",      icon: "🕯️" },
  { id: "reflection",  label: "Размышления",  icon: "🌙" },
  { id: "confession",  label: "Признания",    icon: "🖤" },
];

const POST_TYPE_META = {
  prophecy:   { label: "Пророчество",  icon: "🔮", color: "rgba(139,92,246,0.15)", border: "rgba(139,92,246,0.3)", text: "#a78bfa" },
  ritual:     { label: "Ритуал",       icon: "🕯️", color: "rgba(245,158,11,0.1)",  border: "rgba(245,158,11,0.3)",  text: "#fbbf24" },
  reflection: { label: "Размышление",  icon: "🌙",  color: "rgba(100,116,139,0.1)", border: "rgba(100,116,139,0.25)", text: "var(--text2)" },
  confession: { label: "Признание",    icon: "🖤",  color: "rgba(239,68,68,0.07)",  border: "rgba(239,68,68,0.2)",   text: "#f87171" },
};

// ── Коллективный пульс (детерминирован по времени суток) ─────
function getCollectivePulse() {
  const hour = new Date().getHours();
  if (hour >= 22 || hour < 4)  return { mood: "Тихая медитация",   energy: 35, icon: "🌑", color: "#6366f1" };
  if (hour >= 4  && hour < 8)  return { mood: "Пробуждение",        energy: 55, icon: "🌅", color: "#f59e0b" };
  if (hour >= 8  && hour < 13) return { mood: "Активная энергия",   energy: 78, icon: "☀️", color: "#22c55e" };
  if (hour >= 13 && hour < 17) return { mood: "Поток сознания",     energy: 65, icon: "🌊", color: "#06b6d4" };
  if (hour >= 17 && hour < 20) return { mood: "Закатные ритуалы",   energy: 72, icon: "🌇", color: "#f97316" };
  return                               { mood: "Ночные пророчества", energy: 58, icon: "🌕", color: "#8b5cf6" };
}

// ── Относительное время ──────────────────────────────────────
function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1)  return "только что";
  if (m < 60) return `${m} мин назад`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} ч назад`;
  const d = Math.floor(h / 24);
  if (d < 7)  return `${d} дн назад`;
  return new Date(dateStr).toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}

// ── Индекс Судьбы: точность пророчества ─────────────────────
function destinyIndex(post) {
  const total = post.verified_count + post.disputed_count;
  if (total === 0) return null;
  return Math.round((post.verified_count / total) * 100);
}

function DestinyIndexBadge({ post }) {
  const idx = destinyIndex(post);
  if (idx === null) return null;
  const color = idx >= 70 ? "#22c55e" : idx >= 40 ? "#fbbf24" : "#f87171";
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 3,
      fontSize: 9, fontWeight: 700, color,
      background: `${color}18`, border: `1px solid ${color}40`,
      borderRadius: 6, padding: "2px 6px",
    }}>
      <span>⚖</span> {idx}%
    </div>
  );
}

// ── Карточка одного поста ────────────────────────────────────
function PostCard({ post, onReact, isOwn }) {
  const meta    = POST_TYPE_META[post.type] || POST_TYPE_META.reflection;
  const myR     = post.my_reaction;
  const canVerify = post.type === "prophecy";

  return (
    <div style={{
      background: "var(--card)",
      border: `1px solid ${myR ? meta.border : "var(--border)"}`,
      borderRadius: 16, padding: "14px 14px 12px",
      animation: "fadeInUp 0.25s ease",
    }}>
      {/* Заголовок: псевдоним + тип + время */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", marginBottom: 2, wordBreak: "break-word" }}>
            {post.alias}
          </div>
          <div style={{ fontSize: 10, color: "var(--text2)" }}>{timeAgo(post.created_at)}</div>
        </div>
        <div style={{
          flexShrink: 0, marginLeft: 8,
          fontSize: 9, fontWeight: 700, padding: "2px 7px", borderRadius: 8,
          background: meta.color, border: `1px solid ${meta.border}`, color: meta.text,
          whiteSpace: "nowrap",
        }}>
          {meta.icon} {meta.label}
        </div>
      </div>

      {/* Текст поста */}
      <div style={{
        fontSize: 13, color: "var(--text)", lineHeight: 1.65,
        marginBottom: 12, whiteSpace: "pre-wrap", wordBreak: "break-word",
      }}>
        {post.text}
      </div>

      {/* Реакции */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        {/* Энергия (универсальная) */}
        {!isOwn && (
          <ReactionBtn
            icon="⚡"
            count={post.energy_count}
            active={myR === "energy"}
            label="Энергия"
            activeColor="#f59e0b"
            onClick={() => onReact(post.id, "energy")}
          />
        )}

        {/* Верификация пророчества */}
        {canVerify && !isOwn && (
          <>
            <ReactionBtn
              icon="✓"
              count={post.verified_count}
              active={myR === "verified"}
              label="Сбылось"
              activeColor="#22c55e"
              onClick={() => onReact(post.id, "verified")}
            />
            <ReactionBtn
              icon="✗"
              count={post.disputed_count}
              active={myR === "disputed"}
              label="Не сбылось"
              activeColor="#f87171"
              onClick={() => onReact(post.id, "disputed")}
            />
          </>
        )}

        {/* Счётчики для своих постов */}
        {isOwn && (
          <div style={{ fontSize: 10, color: "var(--text2)", display: "flex", gap: 10, alignItems: "center" }}>
            {post.energy_count > 0 && <span>⚡ {post.energy_count}</span>}
            {canVerify && post.verified_count > 0 && <span style={{ color: "#22c55e" }}>✓ {post.verified_count}</span>}
            {canVerify && post.disputed_count > 0 && <span style={{ color: "#f87171" }}>✗ {post.disputed_count}</span>}
            {post.energy_count === 0 && post.verified_count === 0 && post.disputed_count === 0 && (
              <span style={{ fontStyle: "italic" }}>Жди реакций…</span>
            )}
          </div>
        )}

        {/* Индекс Судьбы для пророчеств */}
        {canVerify && <DestinyIndexBadge post={post} />}

        {/* Дедлайн верификации */}
        {canVerify && post.verify_deadline && (
          <div style={{ marginLeft: "auto", fontSize: 9, color: "var(--text2)", alignSelf: "center" }}>
            до {new Date(post.verify_deadline).toLocaleDateString("ru-RU", { day: "numeric", month: "short" })}
          </div>
        )}
      </div>
    </div>
  );
}

function ReactionBtn({ icon, count, active, label, activeColor, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", gap: 4,
        padding: "5px 10px", borderRadius: 20,
        background: active ? `${activeColor}20` : "var(--bg3)",
        border: `1px solid ${active ? activeColor : "var(--border)"}`,
        color: active ? activeColor : "var(--text2)",
        fontSize: 11, fontWeight: active ? 700 : 500, cursor: "pointer",
        transition: "all 0.2s",
      }}
    >
      <span style={{ fontSize: 12 }}>{icon}</span>
      {label}
      {count > 0 && <span style={{ fontWeight: 800 }}>{count}</span>}
    </button>
  );
}

// ── Виджет Лунного Календаря ─────────────────────────────────
function MoonWidget() {
  const phase     = getLunarPhase();
  const emoji     = getMoonEmoji();
  const name      = getMoonPhaseName();
  const desc      = getMoonEnergyDesc();
  const darkMoon  = isDarkMoon();
  const daysLeft  = daysUntilNewMoon();
  const pct       = Math.round(phase * 100);

  // Цикл: 0% = новолуние (тёмная), 50% = полнолуние (яркая)
  const brightness = phase < 0.5 ? phase * 2 : (1 - phase) * 2; // 0..1
  const glowColor  = darkMoon ? "#6366f1" : "#e2c97e";

  return (
    <div style={{
      background: darkMoon
        ? "linear-gradient(135deg, rgba(99,102,241,0.12), rgba(99,102,241,0.04))"
        : "linear-gradient(135deg, rgba(226,201,126,0.08), rgba(226,201,126,0.02))",
      border: `1px solid ${darkMoon ? "rgba(99,102,241,0.3)" : "rgba(226,201,126,0.2)"}`,
      borderRadius: 16, padding: "14px 16px",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        {/* Иконка луны */}
        <div style={{
          fontSize: 36, lineHeight: 1,
          filter: `brightness(${0.5 + brightness * 0.7}) drop-shadow(0 0 ${8 + brightness * 8}px ${glowColor}80)`,
          flexShrink: 0,
        }}>
          {emoji}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 14, fontWeight: 800, color: "var(--text)", marginBottom: 2,
            display: "flex", alignItems: "center", gap: 6,
          }}>
            {name}
            {darkMoon && (
              <span style={{
                fontSize: 9, fontWeight: 700, color: "#a5b4fc",
                background: "rgba(99,102,241,0.2)", border: "1px solid rgba(99,102,241,0.35)",
                borderRadius: 6, padding: "1px 6px",
              }}>
                🌑 Тёмная Луна
              </span>
            )}
          </div>
          <div style={{ fontSize: 11, color: "var(--text2)", lineHeight: 1.5 }}>{desc}</div>
          {!darkMoon && daysLeft > 0 && (
            <div style={{ fontSize: 10, color: "var(--text2)", marginTop: 4, opacity: 0.7 }}>
              До новолуния: {daysLeft} {daysLeft === 1 ? "день" : daysLeft < 5 ? "дня" : "дней"}
            </div>
          )}
        </div>
        {/* Процент цикла */}
        <div style={{
          fontSize: 11, fontWeight: 800, color: glowColor,
          opacity: 0.85, flexShrink: 0,
        }}>
          {pct}%
        </div>
      </div>
    </div>
  );
}

// ── Нить Судьбы: карточка совместимой души ───────────────────
function SoulCard({ soul, onConnect, loading }) {
  const compatColor =
    soul.compatibility >= 80 ? "#22c55e" :
    soul.compatibility >= 60 ? "#fbbf24" : "#94a3b8";

  return (
    <div style={{
      background: "var(--card)",
      border: "1px solid var(--border)",
      borderRadius: 14, padding: "12px 14px",
      display: "flex", alignItems: "center", gap: 10,
    }}>
      {/* Аватар стихии */}
      <div style={{
        width: 40, height: 40, borderRadius: "50%", flexShrink: 0,
        background: `conic-gradient(${compatColor}60, ${compatColor}20, ${compatColor}60)`,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 18, border: `1px solid ${compatColor}40`,
      }}>
        {TIER_ICONS[soul.tier] || "🌙"}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", wordBreak: "break-word" }}>
          {soul.alias}
        </div>
        {soul.sign && (
          <div style={{ fontSize: 10, color: "var(--text2)", marginTop: 1 }}>
            {soul.sign}
          </div>
        )}
      </div>
      {/* Совместимость */}
      <div style={{ flexShrink: 0, textAlign: "center" }}>
        <div style={{ fontSize: 15, fontWeight: 900, color: compatColor }}>
          {soul.compatibility}%
        </div>
        <div style={{ fontSize: 8, color: "var(--text2)" }}>связь</div>
      </div>
      {/* Кнопка */}
      <button
        onClick={() => onConnect(soul)}
        disabled={loading}
        style={{
          flexShrink: 0, padding: "6px 12px", borderRadius: 10,
          background: "var(--accent)", color: "white",
          border: "none", fontSize: 11, fontWeight: 700,
          cursor: loading ? "default" : "pointer",
          opacity: loading ? 0.6 : 1,
        }}
      >
        Нить
      </button>
    </div>
  );
}

// ── Карточка активной нити (исходящей) ───────────────────────
function ThreadCard({ thread, onDelete }) {
  const daysLeft = Math.max(0, Math.round(
    (new Date(thread.expires_at) - Date.now()) / (24 * 60 * 60 * 1000)
  ));
  const compatColor =
    thread.compatibility >= 80 ? "#22c55e" :
    thread.compatibility >= 60 ? "#fbbf24" : "#94a3b8";

  return (
    <div style={{
      background: "var(--card)",
      border: `1px solid ${thread.is_mutual ? "rgba(139,92,246,0.4)" : "var(--border)"}`,
      borderRadius: 14, padding: "12px 14px",
      position: "relative",
      boxShadow: thread.is_mutual ? "0 0 12px rgba(139,92,246,0.15)" : "none",
    }}>
      {thread.is_mutual && (
        <div style={{
          position: "absolute", top: 8, right: 8,
          fontSize: 8, fontWeight: 700, color: "#a78bfa",
          background: "rgba(139,92,246,0.15)", border: "1px solid rgba(139,92,246,0.3)",
          borderRadius: 5, padding: "1px 5px",
        }}>
          ✦ Взаимная
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: thread.signal ? 8 : 0 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", wordBreak: "break-word" }}>
            {thread.to_alias}
          </div>
          <div style={{ fontSize: 10, color: "var(--text2)", display: "flex", gap: 8, marginTop: 2 }}>
            <span style={{ color: compatColor }}>{thread.compatibility}% связь</span>
            <span>·</span>
            <span>{daysLeft} {daysLeft === 1 ? "день" : "дн"}</span>
          </div>
        </div>
        <button
          onClick={() => onDelete(thread.to_id)}
          style={{
            flexShrink: 0, padding: "4px 8px", borderRadius: 8,
            background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)",
            color: "#f87171", fontSize: 10, cursor: "pointer",
          }}
        >
          Оборвать
        </button>
      </div>
      {thread.signal && (
        <div style={{
          fontSize: 11, color: "var(--text2)", fontStyle: "italic",
          background: "var(--bg3)", borderRadius: 8, padding: "6px 10px",
        }}>
          «{thread.signal}»
        </div>
      )}
    </div>
  );
}

// ── Основной компонент ───────────────────────────────────────
export default function Community({ state, showToast }) {
  const { user, canAccess } = state;

  const activeTier = getActiveTier(user);
  const myUserId   = getUserId();
  const myAlias    = getMysticalAlias(myUserId, user.sun_sign, activeTier);
  const pulse      = getCollectivePulse();
  const question   = getWeekQuestion();
  const darkMoon   = isDarkMoon();

  // ── Лента ────────────────────────────────────────────────
  const [feedType,  setFeedType]  = useState("all");
  const [posts,     setPosts]     = useState([]);
  const [loading,   setLoading]   = useState(false);
  const [page,      setPage]      = useState(0);
  const [hasMore,   setHasMore]   = useState(true);

  // ── Создание поста ────────────────────────────────────────
  const [showCreate,    setShowCreate]    = useState(false);
  const [createType,    setCreateType]    = useState("reflection");
  const [createText,    setCreateText]    = useState("");
  const [createLoading, setCreateLoading] = useState(false);

  // ── Нити Судьбы ───────────────────────────────────────────
  const [showThreads,  setShowThreads]  = useState(false);
  const [myThreads,    setMyThreads]    = useState({ outgoing: [], incoming: [] });
  const [souls,        setSouls]        = useState([]);
  const [threadsLoading, setThreadsLoading] = useState(false);
  const [connectTarget, setConnectTarget] = useState(null); // душа для нити
  const [threadSignal,  setThreadSignal]  = useState("");
  const [connectLoading, setConnectLoading] = useState(false);

  const loadingRef = useRef(false);

  // ── Загрузка ленты ────────────────────────────────────────
  const loadPosts = useCallback(async (type, pageNum, append = false) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    try {
      const res = await fetchPosts(type, pageNum);
      if (res && res.posts) {
        setPosts(prev => append ? [...prev, ...res.posts] : res.posts);
        setHasMore(res.has_more);
        setPage(pageNum);
      }
    } finally {
      setLoading(false);
      loadingRef.current = false;
    }
  }, []);

  useEffect(() => {
    loadPosts("all", 0, false);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleTypeChange = (type) => {
    if (type === feedType) return;
    setFeedType(type);
    setPosts([]);
    setPage(0);
    setHasMore(true);
    loadPosts(type, 0, false);
  };

  const handleLoadMore = () => {
    if (!loading && hasMore) loadPosts(feedType, page + 1, true);
  };

  // ── Реакция на пост ───────────────────────────────────────
  const handleReact = async (postId, reaction) => {
    const res = await reactToPost(postId, reaction);
    if (!res) { showToast("⚠️ Не удалось отреагировать"); return; }

    setPosts(prev => prev.map(p => {
      if (p.id !== postId) return p;
      const next  = { ...p };
      const field = `${reaction}_count`;
      if (res.toggled === "off") {
        next[field] = Math.max(0, (next[field] || 0) - 1);
        next.my_reaction = null;
      } else {
        if (next.my_reaction && next.my_reaction !== reaction) {
          const oldField = `${next.my_reaction}_count`;
          next[oldField] = Math.max(0, (next[oldField] || 0) - 1);
        }
        next[field] = (next[field] || 0) + 1;
        next.my_reaction = reaction;
      }
      return next;
    }));

    if (res.toggled === "on") {
      const labels = { energy: "⚡ Энергия передана!", verified: "✓ Голос засчитан", disputed: "✗ Голос засчитан" };
      showToast(labels[reaction] || "Готово");
    }
  };

  // ── Публикация поста ──────────────────────────────────────
  const handleCreate = async () => {
    if (createText.trim().length < 10) { showToast("Минимум 10 символов"); return; }
    if (createLoading) return;
    setCreateLoading(true);

    const res = await createPost(createType, createText.trim());
    setCreateLoading(false);

    if (res.error) { showToast("❌ " + res.error); return; }

    if (feedType === "all" || feedType === createType) {
      setPosts(prev => [{ ...res.post, my_reaction: null }, ...prev]);
    }
    setCreateText("");
    setShowCreate(false);
    showToast("✨ Опубликовано! Мир слышит тебя");
  };

  // ── Нити Судьбы: открыть панель ──────────────────────────
  const openThreads = async () => {
    setShowThreads(true);
    setThreadsLoading(true);
    const [threadsData, soulsData] = await Promise.all([
      fetchMyThreads(),
      discoverSouls(),
    ]);
    if (threadsData) setMyThreads(threadsData);
    if (soulsData)   setSouls(soulsData.souls || []);
    setThreadsLoading(false);
  };

  // ── Нити Судьбы: протянуть нить ──────────────────────────
  const handleConnect = async (soul) => {
    setConnectTarget(soul);
    setThreadSignal("");
  };

  const handleConfirmConnect = async () => {
    if (!connectTarget || connectLoading) return;
    setConnectLoading(true);
    const res = await createThread(connectTarget.telegram_id, threadSignal);
    setConnectLoading(false);

    if (res.error) { showToast("❌ " + res.error); return; }

    setConnectTarget(null);
    // Обновляем список нитей
    const threadsData = await fetchMyThreads();
    if (threadsData) setMyThreads(threadsData);
    // Убираем из списка доступных душ
    setSouls(prev => prev.filter(s => s.telegram_id !== connectTarget.telegram_id));

    if (res.is_mutual) {
      showToast("✦ Взаимная нить! Вы уже соединены");
    } else {
      showToast(`🔗 Нить протянута (${res.compatibility}% совместимость)`);
    }
  };

  // ── Нити Судьбы: оборвать ────────────────────────────────
  const handleDeleteThread = async (toId) => {
    await deleteThread(toId);
    setMyThreads(prev => ({
      ...prev,
      outgoing: prev.outgoing.filter(t => String(t.to_id) !== String(toId)),
    }));
    showToast("🌑 Нить оборвана");
  };

  const tierColor = activeTier === "premium" ? "var(--gold2)" : activeTier === "vip" ? "var(--accent)" : "var(--text2)";

  return (
    <div style={{ paddingBottom: 90 }}>
      <AppHeader
        title="🌐 Коллектив"
        luckPoints={user.luck_points}
        streak={user.streak_days}
        userTier={activeTier}
      />

      <div style={{ padding: "14px 14px 0", display: "flex", flexDirection: "column", gap: 14 }}>

        {/* ── Твой мистический псевдоним ────────────────────── */}
        <div style={{
          background: "var(--card)", border: "1px solid var(--border)",
          borderRadius: 16, padding: "12px 16px",
          display: "flex", alignItems: "center", gap: 12,
        }}>
          <div style={{
            width: 44, height: 44, borderRadius: "50%",
            background: `linear-gradient(135deg, ${
              activeTier === "premium" ? "#f59e0b,#d97706" :
              activeTier === "vip"     ? "#8b5cf6,#6d28d9" :
                                         "#475569,#334155"
            })`,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 20, flexShrink: 0,
            boxShadow: activeTier !== "free" ? `0 0 16px ${activeTier === "premium" ? "rgba(245,158,11,0.4)" : "rgba(139,92,246,0.4)"}` : "none",
          }}>
            {TIER_ICONS[activeTier]}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: tierColor, marginBottom: 2, wordBreak: "break-word" }}>
              {myAlias}
            </div>
            <div style={{ fontSize: 10, color: "var(--text2)" }}>
              Твой анонимный псевдоним · {TIER_LABELS[activeTier]}
              {activeTier === "free" && (
                <> · <span style={{ color: "var(--accent)" }}>VIP покажет ⭐ в нике</span></>
              )}
            </div>
          </div>
        </div>

        {/* ── Лунный виджет ────────────────────────────────── */}
        <MoonWidget />

        {/* ── Тёмная Луна: пространство тайн ──────────────── */}
        {darkMoon && (
          <div style={{
            background: "linear-gradient(135deg, rgba(99,102,241,0.18), rgba(139,92,246,0.08))",
            border: "1px solid rgba(139,92,246,0.5)",
            borderRadius: 16, padding: "14px 16px",
            boxShadow: "0 0 20px rgba(99,102,241,0.2)",
          }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: "#c4b5fd", marginBottom: 6 }}>
              🌑 Пространство Тёмной Луны
            </div>
            <div style={{ fontSize: 11, color: "var(--text2)", lineHeight: 1.6, marginBottom: 10 }}>
              Сейчас время тёмных признаний. Всё, что ты напишешь здесь — исчезнет через 48 часов. Никаких следов.
            </div>
            <Btn
              size="sm"
              onClick={() => {
                setCreateType("confession");
                setCreateText("");
                setShowCreate(true);
              }}
              style={{
                background: "linear-gradient(135deg, #4f46e5, #7c3aed)",
                border: "none",
              }}
            >
              🌑 Открыть тёмное зеркало
            </Btn>
          </div>
        )}

        {/* ── Нити Судьбы ──────────────────────────────────── */}
        <div
          onClick={openThreads}
          style={{
            background: "linear-gradient(135deg, rgba(139,92,246,0.1), rgba(99,102,241,0.05))",
            border: "1px solid rgba(139,92,246,0.3)",
            borderRadius: 16, padding: "13px 16px",
            cursor: "pointer", display: "flex", alignItems: "center", gap: 12,
          }}
        >
          <div style={{ fontSize: 28, lineHeight: 1 }}>🕸️</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: "var(--text)", marginBottom: 2 }}>
              Нити Судьбы
            </div>
            <div style={{ fontSize: 10, color: "var(--text2)" }}>
              Анонимные кармические связи · до 5 нитей
            </div>
          </div>
          {myThreads.outgoing.length > 0 && (
            <div style={{
              fontSize: 11, fontWeight: 700, color: "#a78bfa",
              background: "rgba(139,92,246,0.15)", borderRadius: 10,
              padding: "3px 8px",
            }}>
              {myThreads.outgoing.length}
            </div>
          )}
          <div style={{ fontSize: 16, color: "var(--text2)" }}>›</div>
        </div>

        {/* ── Коллективный пульс ───────────────────────────── */}
        <SLabel>🫀 Пульс сообщества</SLabel>
        <div style={{
          background: `linear-gradient(135deg, ${pulse.color}18, ${pulse.color}08)`,
          border: `1px solid ${pulse.color}35`,
          borderRadius: 16, padding: "14px 16px",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 800, color: "var(--text)" }}>
                {pulse.icon} {pulse.mood}
              </div>
              <div style={{ fontSize: 11, color: "var(--text2)", marginTop: 2 }}>
                Коллективная энергия прямо сейчас
              </div>
            </div>
            <div style={{
              fontSize: 22, fontWeight: 900, color: pulse.color,
              textShadow: `0 0 12px ${pulse.color}60`,
            }}>
              {pulse.energy}%
            </div>
          </div>
          <div style={{ background: "rgba(255,255,255,0.06)", borderRadius: 20, height: 5, overflow: "hidden" }}>
            <div style={{
              height: "100%", borderRadius: 20,
              background: `linear-gradient(90deg, ${pulse.color}, ${pulse.color}80)`,
              width: `${pulse.energy}%`,
              boxShadow: `0 0 8px ${pulse.color}60`,
              transition: "width 1s ease",
            }} />
          </div>
        </div>

        {/* ── Вопрос дня от Оракула ────────────────────────── */}
        <SLabel>🔮 Вопрос от Оракула</SLabel>
        <div style={{
          background: "linear-gradient(135deg, rgba(139,92,246,0.1), rgba(139,92,246,0.04))",
          border: "1px solid rgba(139,92,246,0.25)",
          borderRadius: 16, padding: "14px 16px",
        }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", lineHeight: 1.6, marginBottom: 12, fontStyle: "italic" }}>
            «{question}»
          </div>
          <Btn
            size="sm"
            onClick={() => { setCreateType("reflection"); setCreateText(""); setShowCreate(true); }}
          >
            ✍️ Ответить сообществу
          </Btn>
        </div>

        {/* ── Фильтр типов + кнопка создания ──────────────── */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <SLabel>📜 Лента сообщества</SLabel>
          <button
            onClick={() => { setCreateType("reflection"); setCreateText(""); setShowCreate(true); }}
            style={{
              display: "flex", alignItems: "center", gap: 5,
              background: "var(--accent)", color: "white",
              border: "none", borderRadius: 12, padding: "7px 14px",
              fontSize: 12, fontWeight: 700, cursor: "pointer",
            }}
          >
            ✦ Написать
          </button>
        </div>

        {/* Скролл фильтров */}
        <div style={{
          display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4,
          scrollbarWidth: "none", msOverflowStyle: "none",
        }}>
          {POST_TYPES.map(t => (
            <button
              key={t.id}
              onClick={() => handleTypeChange(t.id)}
              style={{
                flexShrink: 0, padding: "7px 14px", borderRadius: 20,
                background: feedType === t.id ? "var(--accent)" : "var(--bg3)",
                border: `1px solid ${feedType === t.id ? "var(--accent)" : "var(--border)"}`,
                color: feedType === t.id ? "white" : "var(--text2)",
                fontSize: 12, fontWeight: feedType === t.id ? 700 : 500,
                cursor: "pointer", transition: "all 0.2s", whiteSpace: "nowrap",
              }}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        {/* Лента постов */}
        {loading && posts.length === 0 ? (
          <div style={{ textAlign: "center", padding: "40px 0", color: "var(--text2)" }}>
            <div style={{ fontSize: 32, marginBottom: 10, animation: "pulse 1.5s ease-in-out infinite" }}>🔮</div>
            <div style={{ fontSize: 13 }}>Загружаем голоса мира…</div>
          </div>
        ) : posts.length === 0 ? (
          <div style={{ textAlign: "center", padding: "40px 0", color: "var(--text2)" }}>
            <div style={{ fontSize: 40, marginBottom: 10 }}>🌑</div>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>Здесь пока тихо</div>
            <div style={{ fontSize: 12 }}>Стань первым, кто нарушит тишину</div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {posts.map(post => (
              <PostCard
                key={post.id}
                post={post}
                onReact={handleReact}
                isOwn={post.alias === myAlias}
              />
            ))}
            {hasMore && (
              <button
                onClick={handleLoadMore}
                disabled={loading}
                style={{
                  padding: "12px", borderRadius: 12,
                  background: "var(--bg3)", border: "1px solid var(--border)",
                  color: "var(--text2)", fontSize: 13, fontWeight: 600,
                  cursor: loading ? "default" : "pointer", opacity: loading ? 0.6 : 1,
                }}
              >
                {loading ? "Загружаем…" : "Показать ещё"}
              </button>
            )}
          </div>
        )}

        <div style={{ height: 8 }} />
      </div>

      {/* ══════════════════════════════════════════════════════
          Модальное окно: создание поста
      ══════════════════════════════════════════════════════ */}
      <Modal
        open={showCreate}
        onClose={() => { if (!createLoading) setShowCreate(false); }}
        title="✦ Поделиться с миром"
      >
        {/* Выбор типа */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
          {POST_TYPES.filter(t => t.id !== "all").map(t => {
            const meta = POST_TYPE_META[t.id];
            const sel  = createType === t.id;
            return (
              <div
                key={t.id}
                onClick={() => setCreateType(t.id)}
                style={{
                  padding: "10px 12px", borderRadius: 12, cursor: "pointer",
                  background: sel ? meta.color : "var(--bg3)",
                  border: `1px solid ${sel ? meta.border : "var(--border)"}`,
                  display: "flex", alignItems: "center", gap: 8,
                  transition: "all 0.2s",
                }}
              >
                <span style={{ fontSize: 18 }}>{meta.icon}</span>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: sel ? meta.text : "var(--text)" }}>
                    {meta.label}
                  </div>
                  {t.id === "prophecy" && (
                    <div style={{ fontSize: 9, color: "var(--text2)", marginTop: 1 }}>верификация через 30 дн.</div>
                  )}
                </div>
                {sel && <span style={{ marginLeft: "auto", color: meta.text, fontSize: 14 }}>✓</span>}
              </div>
            );
          })}
        </div>

        {/* Подсказка для выбранного типа */}
        {createType === "prophecy" && (
          <div style={{
            fontSize: 11, color: "#a78bfa", background: "rgba(139,92,246,0.08)",
            border: "1px solid rgba(139,92,246,0.2)", borderRadius: 9, padding: "7px 10px", marginBottom: 10,
          }}>
            🔮 Пророчество будет открыто для верификации сообществом через 30 дней
          </div>
        )}
        {createType === "confession" && (
          <div style={{
            fontSize: 11, color: "#f87171", background: "rgba(239,68,68,0.06)",
            border: "1px solid rgba(239,68,68,0.15)", borderRadius: 9, padding: "7px 10px", marginBottom: 10,
          }}>
            🖤 Признание публикуется анонимно — никто не узнает, кто ты
            {darkMoon && <> · 🌑 <b style={{ color: "#a5b4fc" }}>Тёмная Луна усиливает твои слова</b></>}
          </div>
        )}

        {/* Твой псевдоним */}
        <div style={{
          fontSize: 11, color: "var(--text2)", marginBottom: 8,
          background: "var(--bg3)", borderRadius: 8, padding: "6px 10px",
          display: "flex", alignItems: "center", gap: 6,
        }}>
          <span>{TIER_ICONS[activeTier]}</span>
          <span>Публикуется как: <b style={{ color: tierColor }}>{myAlias}</b></span>
        </div>

        {/* Текстовое поле */}
        <textarea
          value={createText}
          onChange={e => setCreateText(e.target.value.slice(0, 500))}
          placeholder={
            createType === "prophecy"   ? "Напиши своё пророчество…" :
            createType === "ritual"     ? "Опиши ритуал, который изменил тебя…" :
            createType === "reflection" ? "Поделись размышлением со звёздами…" :
                                          "Тёмное зеркало твоей души…"
          }
          disabled={createLoading}
          style={{
            width: "100%", minHeight: 120, padding: "12px 14px",
            borderRadius: 12, background: "var(--bg3)",
            border: "1px solid var(--border)", color: "var(--text)",
            fontSize: 14, resize: "none", outline: "none",
            lineHeight: 1.6, fontFamily: "inherit",
            boxSizing: "border-box",
          }}
          onFocus={e => e.target.style.borderColor = "rgba(139,92,246,0.5)"}
          onBlur={e => e.target.style.borderColor = "var(--border)"}
        />
        <div style={{
          fontSize: 10,
          color: createText.length > 450 ? (createText.length === 500 ? "#f87171" : "#fbbf24") : "var(--text2)",
          textAlign: "right", marginBottom: 12, marginTop: 4,
        }}>
          {createText.length} / 500
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <Btn variant="ghost" size="sm" style={{ flex: 1 }}
            onClick={() => setShowCreate(false)} disabled={createLoading}>
            Отмена
          </Btn>
          <Btn size="sm" style={{ flex: 2 }}
            onClick={handleCreate}
            disabled={createText.trim().length < 10 || createLoading}>
            {createLoading ? "Публикуем…" : "✦ Отправить в мир"}
          </Btn>
        </div>
      </Modal>

      {/* ══════════════════════════════════════════════════════
          Модальное окно: Нити Судьбы
      ══════════════════════════════════════════════════════ */}
      <Modal
        open={showThreads}
        onClose={() => setShowThreads(false)}
        title="🕸️ Нити Судьбы"
      >
        {threadsLoading ? (
          <div style={{ textAlign: "center", padding: "30px 0", color: "var(--text2)" }}>
            <div style={{ fontSize: 28, marginBottom: 8, animation: "pulse 1.5s ease-in-out infinite" }}>🕸️</div>
            <div style={{ fontSize: 12 }}>Ищем кармические связи…</div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

            {/* Активные нити */}
            {myThreads.outgoing.length > 0 && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text2)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  Твои нити ({myThreads.outgoing.length}/5)
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {myThreads.outgoing.map(t => (
                    <ThreadCard key={t.id} thread={t} onDelete={handleDeleteThread} />
                  ))}
                </div>
              </div>
            )}

            {/* Входящие нити */}
            {myThreads.incoming.length > 0 && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text2)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  К тебе тянутся
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {myThreads.incoming.map(t => (
                    <div key={t.id} style={{
                      background: "var(--card)", border: "1px solid var(--border)",
                      borderRadius: 14, padding: "12px 14px",
                    }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text)" }}>{t.from_alias}</div>
                      <div style={{ fontSize: 10, color: "var(--text2)", marginTop: 2 }}>
                        {t.compatibility}% совместимость
                        {t.is_mutual && <span style={{ color: "#a78bfa", marginLeft: 6 }}>✦ Взаимная</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Совместимые души */}
            {myThreads.outgoing.length < 5 && souls.length > 0 && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text2)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  Кармически близкие души
                </div>
                <div style={{ fontSize: 10, color: "var(--text2)", marginBottom: 10, lineHeight: 1.5 }}>
                  Пользователи с высокой астрологической совместимостью
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {souls.map(soul => (
                    <SoulCard
                      key={soul.telegram_id}
                      soul={soul}
                      onConnect={handleConnect}
                      loading={connectLoading}
                    />
                  ))}
                </div>
              </div>
            )}

            {myThreads.outgoing.length === 0 && souls.length === 0 && (
              <div style={{ textAlign: "center", padding: "20px 0", color: "var(--text2)" }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>🌑</div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>Пока нет подходящих душ</div>
                <div style={{ fontSize: 11, marginTop: 4 }}>Возвращайся позже — мир расширяется</div>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* ══════════════════════════════════════════════════════
          Модальное окно: подтверждение нити + сигнал
      ══════════════════════════════════════════════════════ */}
      <Modal
        open={!!connectTarget}
        onClose={() => { if (!connectLoading) setConnectTarget(null); }}
        title="🔗 Протянуть нить"
      >
        {connectTarget && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{
              background: "var(--bg3)", borderRadius: 12, padding: "12px 14px",
              display: "flex", alignItems: "center", gap: 10,
            }}>
              <div style={{ fontSize: 24 }}>{TIER_ICONS[connectTarget.tier] || "🌙"}</div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>{connectTarget.alias}</div>
                <div style={{ fontSize: 10, color: "var(--text2)" }}>
                  {connectTarget.sign} · {connectTarget.compatibility}% совместимость
                </div>
              </div>
            </div>

            <div>
              <div style={{ fontSize: 11, color: "var(--text2)", marginBottom: 6 }}>
                Анонимное послание (необязательно, до 100 символов):
              </div>
              <textarea
                value={threadSignal}
                onChange={e => setThreadSignal(e.target.value.slice(0, 100))}
                placeholder="Слово во Вселенную…"
                disabled={connectLoading}
                style={{
                  width: "100%", minHeight: 70, padding: "10px 12px",
                  borderRadius: 10, background: "var(--bg3)",
                  border: "1px solid var(--border)", color: "var(--text)",
                  fontSize: 13, resize: "none", outline: "none",
                  fontFamily: "inherit", boxSizing: "border-box",
                }}
                onFocus={e => e.target.style.borderColor = "rgba(139,92,246,0.5)"}
                onBlur={e => e.target.style.borderColor = "var(--border)"}
              />
              <div style={{ fontSize: 9, color: "var(--text2)", textAlign: "right", marginTop: 2 }}>
                {threadSignal.length} / 100
              </div>
            </div>

            <div style={{ fontSize: 10, color: "var(--text2)", lineHeight: 1.5 }}>
              Нить анонимна — получатель не узнает кто ты. Она исчезнет через 7 дней.
            </div>

            <div style={{ display: "flex", gap: 8 }}>
              <Btn variant="ghost" size="sm" style={{ flex: 1 }}
                onClick={() => setConnectTarget(null)} disabled={connectLoading}>
                Отмена
              </Btn>
              <Btn size="sm" style={{ flex: 2 }}
                onClick={handleConfirmConnect} disabled={connectLoading}>
                {connectLoading ? "Тянем нить…" : "🔗 Протянуть нить"}
              </Btn>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
