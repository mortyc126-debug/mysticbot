// ============================================================
// МИСТИЧЕСКОЕ РАССЛЕДОВАНИЕ — еженедельная персональная история
// Гадания разблокируют части сюжета. Нельзя уйти, не узнав развязку.
// API: /api/claude (Grok) — генерирует историю под пользователя
// ============================================================

import { useState, useEffect, useCallback } from "react";
import { Card, Btn, AppHeader, SLabel, LoadingSpinner } from "../components/UI";
import TelegramSDK from "../api/telegram";

// ── Получить начало текущей недели (понедельник) ──────────────
function getWeekStartISO() {
  const now = new Date();
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1);
  const mon = new Date(now.setDate(diff));
  return mon.toISOString().slice(0, 10);
}

// ── Генерация истории через Grok ──────────────────────────────
async function generateStory({ user, oracle }) {
  const initData = TelegramSDK.getInitData();
  const headers = { "Content-Type": "application/json" };
  if (initData) headers["x-telegram-init-data"] = initData;

  const name       = user.name || "Путник";
  const sign       = user.sun_sign || "неизвестный знак";
  const focus      = (user.life_focus || []).join(", ") || "саморазвитие";
  const themes     = (oracle?.active_storylines || []).slice(0, 2).join(", ") || "любовь и путь";
  const mood       = oracle?.mood_trend || "стабильное";
  const weekNum    = Math.ceil((new Date() - new Date(new Date().getFullYear(), 0, 1)) / 604800000);

  // Один из шести архетипов расследования (меняется каждую неделю)
  const archetypes = [
    { hook: "скрытый союзник", question: "кто стоит на твоей стороне незаметно" },
    { hook: "тайное послание", question: "какой знак судьба посылает тебе прямо сейчас" },
    { hook: "потерянный ключ", question: "что мешает тебе двигаться вперёд" },
    { hook: "зеркальный двойник", question: "какую часть себя ты не хочешь видеть" },
    { hook: "старый долг", question: "что из прошлого требует завершения" },
    { hook: "невидимая нить", question: "какая связь определяет твой путь прямо сейчас" },
  ];
  const archetype = archetypes[weekNum % archetypes.length];

  const systemPrompt = `Ты — мистический рассказчик. Пишешь персонализированные истории-расследования в жанре мистического детектива.
Стиль: атмосферный, вовлекающий, как хорошая короткая повесть. Никаких упоминаний технологий или ИИ.
Пользователь: ${name}, ${sign}, интересы: ${focus}, темы в жизни: ${themes}, настроение: ${mood}.
Тема недели: «${archetype.hook}» — ${archetype.question}.`;

  const userPrompt = `Создай трёхчастное мистическое расследование для пользователя в формате JSON:

{
  "title": "Название (5-7 слов, интригующее)",
  "hook": "Крючок-анонс в 1 предложение (как тизер фильма)",
  "part1": "Часть 1: Завязка (5-7 предложений). Атмосферное начало. Установи тайну, которую нельзя не раскрыть. Намёк на главный вопрос. Закончи фразой-интригой, не раскрывая тайну. Используй имя ${name}.",
  "part1_cliffhanger": "Одна фраза-крючок в конце части 1 (вопрос или тревожное открытие)",
  "part2": "Часть 2: Развитие (5-7 предложений). Первая подсказка становится яснее. Новый поворот всё усложняет. Тайна углубляется. Заканчивается новым вопросом.",
  "part2_cliffhanger": "Одна фраза-крючок в конце части 2",
  "part3": "Часть 3: Развязка (6-8 предложений). Полное раскрытие тайны. Персональный смысл для ${name} — что это означает в её/его жизни прямо сейчас. Практическое откровение или знак. Завершается ощущением завершённости и нового понимания."
}

Ответ — только валидный JSON без лишнего текста.`;

  const res = await fetch("/api/claude", {
    method: "POST",
    headers,
    body: JSON.stringify({
      systemPrompt,
      userPrompt,
      maxTokens: 1400,
      model: "grok-4-1-fast-reasoning",
    }),
  });
  if (!res.ok) throw new Error("Network error");
  const data = await res.json();
  const raw = data.text || "";
  // Вырезаем JSON из возможной markdown-обёртки
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("Invalid JSON response");
  return JSON.parse(jsonMatch[0]);
}

// ── Иконки прогресса ──────────────────────────────────────────
const PROGRESS_LABELS = [
  "🔍 Тайна ждёт тебя",
  "📖 Первая подсказка раскрыта",
  "🌀 Ещё шаг до развязки",
  "✨ Расследование завершено",
];

// ── Компонент ─────────────────────────────────────────────────
export default function Investigation({ state, showToast }) {
  const { user, goBack, setCurrentPage, investigation, setInvestigation, getContextForClaude } = state;

  const [generating, setGenerating] = useState(false);
  const [error, setError]           = useState(null);
  const [expanded, setExpanded]     = useState(null); // "part1" | "part2" | "part3"

  const weekStart = getWeekStartISO();
  // Инвалидируем если другая неделя
  const currentInv = investigation?.weekStart === weekStart ? investigation : null;
  const progress   = currentInv?.progress || 0;
  const story      = currentInv?.story || null;

  // Авто-генерация при первом открытии (если нет истории на эту неделю)
  useEffect(() => {
    if (!currentInv && !generating) {
      handleGenerate();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleGenerate = useCallback(async () => {
    if (generating) return;
    setGenerating(true);
    setError(null);
    TelegramSDK.haptic.impact("medium");

    try {
      const ctx = getContextForClaude?.() || {};
      const oracle = ctx.oracle_memory || {};
      const story = await generateStory({ user, oracle });

      const newInv = {
        weekStart,
        story,
        progress: currentInv?.progress || 0,
        generated: true,
      };
      setInvestigation(newInv);
      // Сохраняем локально
      try { localStorage.setItem("investigation", JSON.stringify(newInv)); } catch {}
      TelegramSDK.haptic.notification("success");
    } catch (err) {
      setError("Звёзды временно молчат. Попробуй снова через минуту.");
      console.error("[Investigation]", err);
    }
    setGenerating(false);
  }, [generating, user, weekStart, currentInv, getContextForClaude, setInvestigation]);

  // ── Рендер ──────────────────────────────────────────────────
  return (
    <div>
      <AppHeader title="🔍 Расследование" luckPoints={user.luck_points} streak={user.streak_days} />
      <div style={{ padding: "14px 14px 100px", display: "flex", flexDirection: "column", gap: 16 }}>
        <button onClick={goBack || (() => setCurrentPage("home"))} style={{
          background: "none", border: "none", color: "var(--text2)", fontSize: 13,
          cursor: "pointer", textAlign: "left", display: "flex", alignItems: "center", gap: 6, padding: 0,
        }}>← Назад</button>

        {/* Заголовок */}
        <div style={{ textAlign: "center", padding: "8px 0" }}>
          <div style={{ fontSize: 52, marginBottom: 10, animation: "float 3s ease-in-out infinite" }}>🔍</div>
          <h2 style={{ fontSize: 18, fontWeight: 900, marginBottom: 6 }}>Мистическое расследование</h2>
          <p style={{ fontSize: 12, color: "var(--text2)", lineHeight: 1.6 }}>
            Каждую неделю — новая тайна. Три гадания раскрывают историю полностью.
          </p>
        </div>

        {/* Прогресс */}
        {story && (
          <Card style={{ background: "rgba(99,102,241,0.07)", border: "1px solid rgba(99,102,241,0.25)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 700 }}>Прогресс недели</span>
              <span style={{ fontSize: 12, color: progress >= 3 ? "#4ade80" : "#818cf8", fontWeight: 800 }}>
                {progress}/3 гадания
              </span>
            </div>
            <div style={{ background: "var(--border)", borderRadius: 10, height: 6, overflow: "hidden", marginBottom: 8 }}>
              <div style={{
                height: "100%", borderRadius: 10,
                background: progress >= 3
                  ? "linear-gradient(90deg,#4ade80,#22c55e)"
                  : "linear-gradient(90deg,#6366f1,#8b5cf6)",
                width: `${Math.min((progress / 3) * 100, 100)}%`,
                transition: "width 0.6s ease",
              }} />
            </div>
            <div style={{ fontSize: 11, color: progress >= 3 ? "#4ade80" : "var(--text2)" }}>
              {PROGRESS_LABELS[Math.min(progress, 3)]}
            </div>
          </Card>
        )}

        {/* Генерация */}
        {generating && (
          <Card style={{ textAlign: "center", padding: 32 }}>
            <LoadingSpinner />
            <div style={{ fontSize: 13, color: "var(--text2)", marginTop: 12 }}>
              Звёзды ткут твою историю...
            </div>
          </Card>
        )}

        {error && !generating && (
          <Card style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)", textAlign: "center" }}>
            <div style={{ fontSize: 13, color: "#f87171", marginBottom: 12 }}>{error}</div>
            <Btn variant="primary" size="sm" onClick={handleGenerate}>🔄 Попробовать снова</Btn>
          </Card>
        )}

        {/* История */}
        {story && !generating && (
          <>
            {/* Название */}
            <div style={{
              background: "linear-gradient(135deg,rgba(99,102,241,0.12),rgba(139,92,246,0.08))",
              border: "1px solid rgba(99,102,241,0.3)",
              borderRadius: 18, padding: "18px 18px",
            }}>
              <div style={{ fontSize: 10, color: "#818cf8", fontWeight: 700, marginBottom: 6, letterSpacing: 1 }}>
                РАССЛЕДОВАНИЕ НЕДЕЛИ
              </div>
              <div style={{ fontSize: 18, fontWeight: 900, lineHeight: 1.3, marginBottom: 10 }}>
                {story.title}
              </div>
              <div style={{ fontSize: 13, color: "var(--text2)", fontStyle: "italic", lineHeight: 1.6 }}>
                {story.hook}
              </div>
            </div>

            {/* Часть 1 — всегда открыта */}
            <StoryPart
              num={1}
              title="Завязка"
              text={story.part1}
              cliffhanger={story.part1_cliffhanger}
              unlocked={true}
              expanded={expanded === "part1"}
              onToggle={() => setExpanded(expanded === "part1" ? null : "part1")}
            />

            {/* Часть 2 — после 1 гадания */}
            <StoryPart
              num={2}
              title="Развитие"
              text={story.part2}
              cliffhanger={story.part2_cliffhanger}
              unlocked={progress >= 1}
              expanded={expanded === "part2"}
              onToggle={() => setExpanded(expanded === "part2" ? null : "part2")}
              lockLabel="1 гадание для разблокировки"
              onDoReading={() => { TelegramSDK.haptic.impact("light"); setCurrentPage("tarot"); }}
            />

            {/* Часть 3 — после 3 гаданий (развязка) */}
            <StoryPart
              num={3}
              title="Развязка · Тайна раскрыта"
              text={story.part3}
              unlocked={progress >= 3}
              expanded={expanded === "part3"}
              onToggle={() => setExpanded(expanded === "part3" ? null : "part3")}
              lockLabel={`ещё ${3 - progress} ${progress === 2 ? "гадание" : "гадания"} до развязки`}
              isReveal
              onDoReading={() => { TelegramSDK.haptic.impact("light"); setCurrentPage("tarot"); }}
            />

            {/* Призыв к действию */}
            {progress < 3 && (
              <div style={{
                background: "rgba(99,102,241,0.06)", border: "1px solid rgba(99,102,241,0.2)",
                borderRadius: 14, padding: "14px 16px", textAlign: "center",
              }}>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>
                  🃏 Сделай гадание — узнай продолжение
                </div>
                <div style={{ fontSize: 11, color: "var(--text2)", marginBottom: 12 }}>
                  Осталось {3 - progress} из 3 гаданий для полного раскрытия
                </div>
                <Btn variant="primary" onClick={() => { TelegramSDK.haptic.impact("medium"); setCurrentPage("tarot"); }}>
                  🔮 Перейти к гаданию
                </Btn>
              </div>
            )}

            {/* Завершено */}
            {progress >= 3 && (
              <Card style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.3)", textAlign: "center" }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>✨</div>
                <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 4 }}>Расследование завершено!</div>
                <div style={{ fontSize: 12, color: "var(--text2)" }}>
                  Следующая история появится в начале новой недели.
                </div>
              </Card>
            )}

            {/* Перегенерация */}
            <button onClick={handleGenerate} style={{
              background: "none", border: "none", color: "var(--text2)", fontSize: 11,
              cursor: "pointer", textAlign: "center", width: "100%", opacity: 0.6,
            }}>
              🔄 Сгенерировать новую историю
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ── Компонент части истории ───────────────────────────────────
function StoryPart({ num, title, text, cliffhanger, unlocked, expanded, onToggle, lockLabel, isReveal, onDoReading }) {
  const numColors = ["", "#6366f1", "#8b5cf6", "#f59e0b"];

  if (!unlocked) {
    return (
      <div style={{
        background: "rgba(0,0,0,0.3)", border: "1px solid var(--border)",
        borderRadius: 16, padding: "16px", position: "relative", overflow: "hidden",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 32, height: 32, borderRadius: "50%", background: "var(--bg3)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 14, fontWeight: 900, color: "var(--text2)", flexShrink: 0,
          }}>{num}</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text2)", opacity: 0.6 }}>{title}</div>
            <div style={{ fontSize: 11, color: "var(--text2)", marginTop: 2 }}>🔒 {lockLabel}</div>
          </div>
          {onDoReading && (
            <button onClick={onDoReading} style={{
              fontSize: 11, fontWeight: 700, padding: "6px 12px", borderRadius: 8,
              background: isReveal ? "linear-gradient(135deg,#f59e0b,#d97706)" : "rgba(99,102,241,0.15)",
              border: isReveal ? "none" : "1px solid rgba(99,102,241,0.3)",
              color: isReveal ? "white" : "#818cf8", cursor: "pointer", whiteSpace: "nowrap",
            }}>
              {isReveal ? "✨ Раскрыть" : "Гадать →"}
            </button>
          )}
        </div>
        {/* Размытый preview для интриги */}
        <div style={{ marginTop: 12, filter: "blur(4px)", pointerEvents: "none", userSelect: "none", opacity: 0.4 }}>
          <div style={{ fontSize: 12, lineHeight: 1.7 }}>
            {text?.slice(0, 80) || ""}...
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      background: isReveal
        ? "linear-gradient(135deg,rgba(245,158,11,0.08),rgba(139,92,246,0.06))"
        : "var(--bg2)",
      border: `1px solid ${isReveal ? "rgba(245,158,11,0.3)" : "rgba(99,102,241,0.2)"}`,
      borderRadius: 16, overflow: "hidden",
    }}>
      {/* Заголовок части */}
      <div
        onClick={onToggle}
        style={{
          padding: "14px 16px", cursor: "pointer",
          display: "flex", alignItems: "center", gap: 10,
        }}
      >
        <div style={{
          width: 32, height: 32, borderRadius: "50%", flexShrink: 0,
          background: isReveal
            ? "linear-gradient(135deg,#f59e0b,#d97706)"
            : `rgba(${num === 1 ? "99,102,241" : "139,92,246"},0.15)`,
          border: `1px solid ${numColors[num]}40`,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 14, fontWeight: 900, color: isReveal ? "white" : numColors[num],
        }}>{isReveal ? "✨" : num}</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: isReveal ? "var(--gold)" : "var(--text)" }}>
            {title}
          </div>
          {!expanded && text && (
            <div style={{ fontSize: 11, color: "var(--text2)", marginTop: 1, lineHeight: 1.4 }}>
              {text.slice(0, 60)}...
            </div>
          )}
        </div>
        <span style={{ fontSize: 14, color: "var(--text2)", transition: "transform 0.2s", transform: expanded ? "rotate(180deg)" : "none" }}>
          ▾
        </span>
      </div>

      {/* Текст части */}
      {expanded && (
        <div style={{ padding: "0 16px 16px", animation: "pageEnter 0.3s ease" }}>
          <p style={{ fontSize: 13, lineHeight: 1.75, color: "var(--text)", margin: 0, marginBottom: cliffhanger ? 12 : 0 }}>
            {text}
          </p>
          {cliffhanger && (
            <div style={{
              marginTop: 12, padding: "10px 14px",
              background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.25)",
              borderRadius: 10, fontStyle: "italic",
              fontSize: 12, color: "#818cf8", lineHeight: 1.6,
            }}>
              {cliffhanger}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
