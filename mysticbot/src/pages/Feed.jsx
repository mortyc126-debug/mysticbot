// ============================================================
// ПЕРСОНАЛЬНАЯ ЛЕНТА — мистический контент, созданный лично для тебя
// ============================================================
import { useState, useEffect, useCallback } from "react";
import { AppHeader } from "../components/UI";
import BackendAPI from "../api/backend";

const SLOT_ICON = { morning: "🌅", afternoon: "☀️", evening: "🌙" };
const SLOT_LABEL = { morning: "Утро", afternoon: "День", evening: "Вечер" };
const CATEGORY_ICON = {
  ritual:      "🕯️",
  intention:   "✨",
  rune_wisdom: "ᚱ",
  astrology:   "🌟",
  myth:        "📜",
  tarot_deep:  "🃏",
  love_magic:  "💞",
  slavic:      "🌿",
  reflection:  "🔮",
  dream_magic: "🌙",
};

// Форматирование даты
const formatDate = (dateStr) => {
  const d = new Date(dateStr + "T12:00:00");
  const today = new Date();
  const diff  = Math.floor((today - d) / 86400000);
  if (diff === 0) return "Сегодня";
  if (diff === 1) return "Вчера";
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
};

// Группировка постов по дате
const groupByDate = (posts) => {
  const groups = {};
  posts.forEach(p => {
    const key = p.feed_date;
    if (!groups[key]) groups[key] = [];
    groups[key].push(p);
  });
  return Object.entries(groups).sort((a, b) => b[0].localeCompare(a[0]));
};

// ── Карточка поста ────────────────────────────────────────
function FeedCard({ post }) {
  const [expanded,  setExpanded]  = useState(false);
  const [reaction,  setReaction]  = useState(post.my_reaction || null);
  const [animating, setAnimating] = useState(null);

  const PREVIEW_CHARS = 180;
  const isLong = post.content.length > PREVIEW_CHARS;

  const handleReact = async (r) => {
    const prev        = reaction;
    const newReaction = reaction === r ? null : r; // toggle: повторный клик снимает реакцию
    setAnimating(r);
    setTimeout(() => setAnimating(null), 400);
    setReaction(newReaction);
    try {
      await BackendAPI.reactFeed(post.id, newReaction); // null = удалить реакцию
    } catch (e) {
      setReaction(prev); // откат UI если запрос упал
      console.warn("[feed react]", e.message);
    }
  };

  return (
    <div style={{
      background:    "rgba(255,255,255,0.04)",
      border:        "1px solid rgba(255,255,255,0.08)",
      borderRadius:  16,
      padding:       "16px 16px 12px",
      marginBottom:  12,
      position:      "relative",
      overflow:      "hidden",
    }}>
      {/* Мерцающий акцент сверху */}
      <div style={{
        position: "absolute", top: 0, left: 0, right: 0, height: 2,
        background: "linear-gradient(90deg, transparent, rgba(139,92,246,0.6), transparent)",
      }} />

      {/* Слот + категория */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 13 }}>
          {SLOT_ICON[post.slot] || "✨"} {SLOT_LABEL[post.slot] || ""}
        </span>
        <span style={{
          fontSize: 11, color: "var(--text2)",
          background: "rgba(139,92,246,0.12)", borderRadius: 20,
          padding: "2px 8px", border: "1px solid rgba(139,92,246,0.2)",
        }}>
          {CATEGORY_ICON[post.category] || "✨"} {post.category?.replace(/_/g, " ")}
        </span>
      </div>

      {/* Заголовок */}
      <div style={{
        fontSize: 15, fontWeight: 700, color: "var(--text1)",
        lineHeight: 1.4, marginBottom: 10,
      }}>
        {post.title}
      </div>

      {/* Контент */}
      <div style={{
        fontSize: 13.5, color: "var(--text2)", lineHeight: 1.65,
        whiteSpace: "pre-wrap",
      }}>
        {isLong && !expanded
          ? post.content.slice(0, PREVIEW_CHARS) + "..."
          : post.content}
      </div>

      {isLong && (
        <button
          onClick={() => setExpanded(v => !v)}
          style={{
            background: "none", border: "none", cursor: "pointer",
            color: "var(--accent)", fontSize: 12, marginTop: 6, padding: 0,
          }}
        >
          {expanded ? "Свернуть ↑" : "Читать дальше →"}
        </button>
      )}

      {/* Лайк / дизлайк */}
      <div style={{
        display: "flex", gap: 8, marginTop: 14,
        paddingTop: 10, borderTop: "1px solid rgba(255,255,255,0.06)",
      }}>
        <button
          onClick={() => handleReact("like")}
          style={{
            background:    reaction === "like"
              ? "rgba(16,185,129,0.18)" : "rgba(255,255,255,0.04)",
            border:        reaction === "like"
              ? "1px solid rgba(16,185,129,0.4)" : "1px solid rgba(255,255,255,0.08)",
            borderRadius:  20, padding: "5px 14px",
            cursor: "pointer", color: reaction === "like" ? "#10b981" : "var(--text2)",
            fontSize: 13, display: "flex", alignItems: "center", gap: 5,
            transition: "all 0.2s",
            transform: animating === "like" ? "scale(1.18)" : "scale(1)",
          }}
        >
          👍 Нравится
        </button>
        <button
          onClick={() => handleReact("dislike")}
          style={{
            background:    reaction === "dislike"
              ? "rgba(239,68,68,0.12)" : "rgba(255,255,255,0.04)",
            border:        reaction === "dislike"
              ? "1px solid rgba(239,68,68,0.3)" : "1px solid rgba(255,255,255,0.08)",
            borderRadius:  20, padding: "5px 14px",
            cursor: "pointer", color: reaction === "dislike" ? "#ef4444" : "var(--text2)",
            fontSize: 13, display: "flex", alignItems: "center", gap: 5,
            transition: "all 0.2s",
            transform: animating === "dislike" ? "scale(1.18)" : "scale(1)",
          }}
        >
          👎 Не моё
        </button>
      </div>
    </div>
  );
}

// ── Пустое состояние ─────────────────────────────────────
function EmptyFeed() {
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", padding: "60px 24px", textAlign: "center",
    }}>
      <div style={{ fontSize: 52, marginBottom: 16 }}>🔮</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text1)", marginBottom: 8 }}>
        Лента готовится...
      </div>
      <div style={{ fontSize: 13, color: "var(--text2)", lineHeight: 1.6, maxWidth: 260 }}>
        Твой персональный поток мудрости появится утром. Звёзды уже выстраиваются в нужном порядке.
      </div>
    </div>
  );
}

// ── Основная страница ────────────────────────────────────
export default function Feed({ state, showToast }) {
  const { user } = state;
  const [feed,    setFeed]    = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  const loadFeed = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await BackendAPI.fetchFeed();
      setFeed(data || []);
    } catch (e) {
      console.warn("[Feed]", e.message);
      setError("Не удалось загрузить ленту");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadFeed(); }, [loadFeed]);

  const grouped = groupByDate(feed);

  return (
    <div style={{ padding: "0 16px 16px" }}>
      <AppHeader
        title="✨ Моя лента"
        luckPoints={user?.luck_points ?? 0}
        streak={user?.streak_days ?? 0}
      />

      {loading && (
        <div style={{ textAlign: "center", padding: "48px 0", color: "var(--text2)", fontSize: 13 }}>
          Загружаем мудрость...
        </div>
      )}

      {error && (
        <div style={{
          background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)",
          borderRadius: 12, padding: 16, textAlign: "center", color: "#ef4444", fontSize: 13,
          marginBottom: 16,
        }}>
          {error}
          <button
            onClick={loadFeed}
            style={{
              display: "block", margin: "8px auto 0", background: "none",
              border: "1px solid rgba(239,68,68,0.3)", borderRadius: 8,
              padding: "4px 12px", color: "#ef4444", cursor: "pointer", fontSize: 12,
            }}
          >
            Попробовать снова
          </button>
        </div>
      )}

      {!loading && !error && feed.length === 0 && <EmptyFeed />}

      {!loading && grouped.map(([date, posts]) => (
        <div key={date} style={{ marginBottom: 4 }}>
          {/* Разделитель даты */}
          <div style={{
            display: "flex", alignItems: "center", gap: 8, marginBottom: 12,
          }}>
            <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.06)" }} />
            <span style={{ fontSize: 11, color: "var(--text2)", whiteSpace: "nowrap" }}>
              {formatDate(date)}
            </span>
            <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.06)" }} />
          </div>

          {/* Посты за день (сортировка: вечер → день → утро для обратного хрона) */}
          {[...posts]
            .sort((a, b) => {
              const order = { evening: 0, afternoon: 1, morning: 2 };
              return (order[a.slot] ?? 3) - (order[b.slot] ?? 3);
            })
            .map(post => (
              <FeedCard
                key={post.id}
                post={post}
              />
            ))
          }
        </div>
      ))}
    </div>
  );
}
