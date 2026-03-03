// ============================================================
// МИСТИЧЕСКОЕ СООБЩЕСТВО — страница публичной соцсети
//
// Структура:
//  ┌ AppHeader (с тиром и удачей)
//  ├ Коллективный пульс (настроение сообщества, анонимно)
//  ├ Вопрос дня от Оракула (меняется каждую неделю)
//  ├ Фильтр типов постов
//  ├ Лента постов
//  └ Модальное окно создания поста
// ============================================================
import { useState, useEffect, useCallback, useRef } from "react";
import { AppHeader, Modal, Btn, SLabel } from "../components/UI";
import { getMysticalAlias, getActiveTier, TIER_ICONS, TIER_LABELS } from "../hooks/alias";
import { fetchPosts, createPost, reactToPost } from "../api/posts";
import { getUserId } from "../api/backend";

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
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
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

// ── Основной компонент ───────────────────────────────────────
export default function Community({ state, showToast }) {
  const { user, canAccess } = state;

  const activeTier = getActiveTier(user);
  // getUserId() всегда возвращает реальный Telegram ID (или стабильный браузерный UUID)
  // user.telegram_id в стейте может быть null, поэтому используем SDK напрямую
  const myUserId   = getUserId();
  const myAlias    = getMysticalAlias(myUserId, user.sun_sign, activeTier);
  const pulse      = getCollectivePulse();
  const question   = getWeekQuestion();

  // Лента
  const [feedType,  setFeedType]  = useState("all");
  const [posts,     setPosts]     = useState([]);
  const [loading,   setLoading]   = useState(false);
  const [page,      setPage]      = useState(0);
  const [hasMore,   setHasMore]   = useState(true);
  const [initialized, setInit]    = useState(false);

  // Создание поста
  const [showCreate,    setShowCreate]    = useState(false);
  const [createType,    setCreateType]    = useState("reflection");
  const [createText,    setCreateText]    = useState("");
  const [createLoading, setCreateLoading] = useState(false);

  const loadingRef = useRef(false);

  // Загрузка ленты
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
    setInit(true);
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
    if (!loading && hasMore) {
      loadPosts(feedType, page + 1, true);
    }
  };

  // Реакция на пост
  const handleReact = async (postId, reaction) => {
    const res = await reactToPost(postId, reaction);
    if (!res) { showToast("⚠️ Не удалось отреагировать"); return; }

    setPosts(prev => prev.map(p => {
      if (p.id !== postId) return p;
      const next = { ...p };
      const field = `${reaction}_count`;

      if (res.toggled === "off") {
        next[field] = Math.max(0, (next[field] || 0) - 1);
        next.my_reaction = null;
      } else {
        // Если была другая реакция — убираем старую
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

  // Публикация поста
  const handleCreate = async () => {
    if (createText.trim().length < 10) { showToast("Минимум 10 символов"); return; }
    if (createLoading) return;
    setCreateLoading(true);

    const res = await createPost(createType, createText.trim());
    setCreateLoading(false);

    if (res.error) {
      showToast("❌ " + res.error);
      return;
    }

    // Добавляем новый пост в начало ленты (если текущий фильтр совпадает)
    if (feedType === "all" || feedType === createType) {
      setPosts(prev => [{ ...res.post, my_reaction: null }, ...prev]);
    }

    setCreateText("");
    setShowCreate(false);
    showToast("✨ Опубликовано! Мир слышит тебя");
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
          {/* Полоса пульса */}
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

            {/* Загрузить ещё */}
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

      {/* ── Модальное окно: создание поста ───────────────────── */}
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
          fontSize: 10, color: createText.length > 450 ? (createText.length === 500 ? "#f87171" : "#fbbf24") : "var(--text2)",
          textAlign: "right", marginBottom: 12, marginTop: 4,
        }}>
          {createText.length} / 500
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <Btn
            variant="ghost" size="sm" style={{ flex: 1 }}
            onClick={() => setShowCreate(false)}
            disabled={createLoading}
          >
            Отмена
          </Btn>
          <Btn
            size="sm" style={{ flex: 2 }}
            onClick={handleCreate}
            disabled={createText.trim().length < 10 || createLoading}
          >
            {createLoading ? "Публикуем…" : "✦ Отправить в мир"}
          </Btn>
        </div>
      </Modal>
    </div>
  );
}
