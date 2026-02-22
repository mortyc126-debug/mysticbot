// ============================================================
// РУНЫ — страница рунических гаданий
// Данные: src/data/tarot.js → RUNES (24 руны Старшего Футарка)
// API: src/api/claude.js → interpretRune (подключить позже)
// ============================================================

import { useState } from "react";
import { Card, Btn, SLabel, AppHeader, Badge, Modal, LoadingSpinner } from "../components/UI";
import { RUNES } from "../data/tarot";
import ClaudeAPI from "../api/claude";
import TelegramSDK from "../api/telegram";

const RUNE_MODES = [
  {
    id: "single",
    name: "Одна руна",
    emoji: "ᚠ",
    count: 1,
    tier: "vip",
    desc: "Краткий ответ на конкретный вопрос",
    fullDesc: "Одна руна — прямое послание от древней мудрости. Идеально для ежедневного запроса или конкретного вопроса. Руна укажет на ключевую энергию момента.",
    positions: ["Послание"],
    duration: "~2 минуты",
  },
  {
    id: "three",
    name: "Три руны",
    emoji: "ᚠ ᚢ ᚦ",
    count: 3,
    tier: "premium",
    desc: "Глубокий расклад: прошлое · настоящее · будущее",
    fullDesc: "Три руны раскрывают полную картину: откуда ты пришёл, где находишься и куда движешься. Идеален для жизненных ситуаций, требующих глубокого понимания.",
    positions: ["Прошлое", "Настоящее", "Будущее"],
    duration: "~5 минут",
  },
];

// Локальный фоллбэк толкования (используется пока Claude API не подключён)
function getLocalInterpretation(runes, question) {
  if (runes.length === 1) {
    const r = runes[0];
    const qPart = question ? ` В контексте твоего вопроса — прочти это послание внимательно.` : "";
    return `Руна ${r.name} говорит: ${r.meaning.toLowerCase()}.${qPart} Доверься тому, что чувствуешь прямо сейчас — руны не ошибаются.`;
  }
  return (
    `В прошлом — ${runes[0].name} (${runes[0].meaning.toLowerCase()}). ` +
    `В настоящем — ${runes[1].name} (${runes[1].meaning.toLowerCase()}). ` +
    `В будущем — ${runes[2].name} (${runes[2].meaning.toLowerCase()}). ` +
    `Эта цепочка указывает на трансформацию. Прошлое дало почву, настоящее — инструмент, а будущее уже формируется твоими намерениями.`
  );
}

export default function Runes({ state, showToast }) {
  const { user, canAccess, setCurrentPage, goBack, addLuck, addDailyEnergy,
          shopPurchases, useShopPurchase } = state;

  const [mode, setMode]                   = useState(null);
  const [question, setQuestion]           = useState("");
  const [drawnRunes, setDrawnRunes]       = useState([]);
  const [revealed, setRevealed]           = useState(false);
  const [loading, setLoading]             = useState(false);
  const [interpretation, setInterpretation] = useState(null);
  const [selectedRune, setSelectedRune]   = useState(null); // для справочника
  // флаг: текущий сеанс открыт через купленную попытку
  const [sessionFromPurchase, setSessionFromPurchase] = useState(false);

  const runePurchased = shopPurchases?.runes || 0;

  const handleSelectMode = (m) => {
    const hasPurchase = m.tier === "vip" && runePurchased > 0;
    if (!canAccess(m.tier) && !hasPurchase) {
      showToast(m.tier === "vip"
        ? `⭐ Нужен VIP тариф или купи в Магазине удачи (ᚠ 25 💫)`
        : "👑 Нужен Премиум тариф");
      TelegramSDK.haptic.notification("warning");
      return;
    }
    setSessionFromPurchase(!canAccess(m.tier) && hasPurchase);
    setMode(m);
    setDrawnRunes([]);
    setRevealed(false);
    setInterpretation(null);
    setQuestion("");
  };

  const handleDraw = () => {
    const shuffled = [...RUNES].sort(() => Math.random() - 0.5);
    setDrawnRunes(shuffled.slice(0, mode.count));
    setRevealed(false);
    setInterpretation(null);
    TelegramSDK.haptic.impact("medium");
  };

  const handleReveal = async () => {
    // Списываем купленную попытку при первом раскрытии сеанса
    if (sessionFromPurchase) {
      useShopPurchase?.("runes");
      setSessionFromPurchase(false);
    }
    setRevealed(true);
    TelegramSDK.haptic.impact("light");
    setLoading(true);

    try {
      const result = await ClaudeAPI.interpretRune({
        runes: drawnRunes,
        question,
        userContext: state.getContextForClaude(),
      });
      setInterpretation(result || getLocalInterpretation(drawnRunes, question));
    } catch {
      setInterpretation(getLocalInterpretation(drawnRunes, question));
    }

    setLoading(false);
    addLuck(2, "Гадание на рунах");
    addDailyEnergy();
    showToast("ᚠ +2 💫 Руны говорят!");
  };

  const handleReset = () => {
    setDrawnRunes([]);
    setRevealed(false);
    setInterpretation(null);
  };

  return (
    <div>
      <AppHeader title="ᚠ Руны" luckPoints={user.luck_points} streak={user.streak_days} />

      <div style={{ padding: "14px 14px 0", display: "flex", flexDirection: "column", gap: 14 }}>

        {/* Назад */}
        <button
          onClick={goBack}
          style={{
            background: "none", border: "none", color: "var(--text2)",
            fontSize: 13, cursor: "pointer", textAlign: "left",
            display: "flex", alignItems: "center", gap: 6, padding: 0,
          }}
        >
          ← Назад к Таро
        </button>

        {/* === ВЫБОР РЕЖИМА === */}
        {!mode && (
          <>
            <div style={{ textAlign: "center", padding: "12px 0 4px" }}>
              <div style={{ fontSize: 56, marginBottom: 8, animation: "float 3s ease-in-out infinite" }}>᛭</div>
              <h2 style={{ fontSize: 20, fontWeight: 800, marginBottom: 6 }}>Рунические гадания</h2>
              <p style={{ fontSize: 13, color: "var(--text2)", lineHeight: 1.65, marginBottom: 10 }}>
                Руны Старшего Футарка — алфавит судьбы, которому более 2000 лет.
                Каждый символ несёт в себе архетипическую силу.
              </p>
              <div style={{ display: "flex", justifyContent: "center", gap: 12, flexWrap: "wrap", marginBottom: 4 }}>
                {[
                  ["🌱", "Природная мудрость"],
                  ["🔮", "Точный ответ"],
                  ["⚡", "Мгновенная связь"],
                ].map(([e, t]) => (
                  <div key={t} style={{ fontSize: 11, color: "var(--text2)", display: "flex", alignItems: "center", gap: 4 }}>
                    <span>{e}</span><span>{t}</span>
                  </div>
                ))}
              </div>
            </div>

            <SLabel>⚡ Выбери расклад</SLabel>

            {RUNE_MODES.map(m => {
              const accessible = canAccess(m.tier) || (m.tier === "vip" && runePurchased > 0);
              return (
                <Card
                  key={m.id}
                  onClick={() => handleSelectMode(m)}
                  glow={accessible}
                  style={{ cursor: "pointer" }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 4, display: "flex", alignItems: "center", gap: 6 }}>
                        {m.name}
                        {m.tier === "vip" && runePurchased > 0 && !canAccess(m.tier) && (
                          <span style={{ fontSize: 10, fontWeight: 800, color: "#4ade80", background: "rgba(74,222,128,0.12)", border: "1px solid rgba(74,222,128,0.3)", borderRadius: 6, padding: "1px 6px" }}>
                            {runePurchased}×
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 12, color: "var(--text2)", marginBottom: 4 }}>{m.desc}</div>
                      {m.duration && <div style={{ fontSize: 10, color: "var(--text2)", opacity: 0.7 }}>⏱ {m.duration}</div>}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
                      <Badge tier={m.tier} />
                      <div style={{ fontSize: 18, color: "var(--accent)", letterSpacing: 4 }}>{m.emoji}</div>
                    </div>
                  </div>
                  {!accessible && (
                    <div style={{
                      marginTop: 10, fontSize: 11, color: "var(--text2)",
                      background: "var(--bg3)", borderRadius: 8, padding: "6px 10px",
                    }}>
                      🔒 Нужен {m.tier === "vip" ? "VIP тариф или купи в Магазине удачи (25 💫)" : "Премиум тариф"}
                    </div>
                  )}
                </Card>
              );
            })}

            {/* Справочник рун */}
            <SLabel>📖 Справочник рун</SLabel>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
              {RUNES.map(r => (
                <Card
                  key={r.name}
                  onClick={() => setSelectedRune(r)}
                  style={{ padding: "10px 6px", textAlign: "center", cursor: "pointer" }}
                >
                  <div style={{
                    fontSize: 24, marginBottom: 4, color: "var(--accent)",
                    fontFamily: "serif",
                  }}>
                    {r.symbol}
                  </div>
                  <div style={{ fontSize: 9, color: "var(--text2)", fontWeight: 700, lineHeight: 1.3 }}>
                    {r.name}
                  </div>
                </Card>
              ))}
            </div>
          </>
        )}

        {/* === ПРОЦЕСС ГАДАНИЯ === */}
        {mode && (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontSize: 16, fontWeight: 800 }}>{mode.name}</div>
              <button
                onClick={() => setMode(null)}
                style={{
                  background: "none", border: "none", color: "var(--text2)",
                  fontSize: 20, cursor: "pointer", lineHeight: 1,
                }}
              >
                ✕
              </button>
            </div>

            {/* Шаг 1: Вытащить руны */}
            {drawnRunes.length === 0 && (
              <>
                <div style={{ textAlign: "center", padding: "20px 0" }}>
                  <div style={{
                    fontSize: 72, marginBottom: 16,
                    animation: "float 3s ease-in-out infinite",
                    cursor: "pointer",
                    filter: "drop-shadow(0 0 20px rgba(139,92,246,0.5))",
                  }}>
                    🎒
                  </div>
                  <p style={{ fontSize: 13, color: "var(--text2)", marginBottom: 20, lineHeight: 1.6 }}>
                    Сосредоточься на вопросе.<br />Когда будешь готов — вытащи руну.
                  </p>

                  <input
                    value={question}
                    onChange={e => setQuestion(e.target.value)}
                    placeholder="Твой вопрос (необязательно)..."
                    maxLength={200}
                    style={{
                      width: "100%", padding: "11px 14px", borderRadius: 12, fontSize: 13,
                      background: "var(--bg3)", border: "1px solid var(--border)",
                      color: "var(--text)", outline: "none", marginBottom: 16,
                    }}
                  />
                  <Btn onClick={handleDraw}>
                    ᚠ Вытащить {mode.count === 1 ? "руну" : "руны"}
                  </Btn>
                </div>
              </>
            )}

            {/* Шаг 2: Показать лицом вниз / открыть */}
            {drawnRunes.length > 0 && (
              <>
                <div style={{
                  display: "flex", gap: 12, justifyContent: "center",
                  padding: "16px 0", flexWrap: "wrap",
                }}>
                  {drawnRunes.map((rune, i) => (
                    <div key={i} style={{ textAlign: "center" }}>
                      <div style={{
                        width: 88, height: 110,
                        background: revealed
                          ? "linear-gradient(160deg,#1a0a2e,#2d1b69)"
                          : "linear-gradient(160deg,#12121a,#1a1a27)",
                        border: `1px solid ${revealed ? "rgba(139,92,246,0.6)" : "rgba(139,92,246,0.2)"}`,
                        borderRadius: 14,
                        display: "flex", flexDirection: "column",
                        alignItems: "center", justifyContent: "center", gap: 8,
                        animation: `cardFlip 0.4s ease ${i * 0.12}s both`,
                        boxShadow: revealed ? "0 0 20px rgba(139,92,246,0.25)" : "none",
                        transition: "all 0.3s",
                        margin: "0 auto",
                      }}>
                        {revealed ? (
                          <>
                            <div style={{
                              fontSize: 30, color: "var(--accent)", fontFamily: "serif",
                              animation: "runeReveal 0.5s ease both",
                            }}>
                              {rune.symbol}
                            </div>
                            <div style={{
                              fontSize: 9, color: "rgba(255,255,255,0.7)",
                              textAlign: "center", padding: "0 6px",
                            }}>
                              {rune.name}
                            </div>
                          </>
                        ) : (
                          <div style={{ fontSize: 28, color: "rgba(139,92,246,0.3)" }}>✦</div>
                        )}
                      </div>
                      {mode.count > 1 && (
                        <div style={{ fontSize: 10, color: "var(--text2)", marginTop: 6 }}>
                          {mode.positions[i]}
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {!revealed && (
                  <Btn onClick={handleReveal}>
                    Открыть {mode.count === 1 ? "руну" : "руны"}
                  </Btn>
                )}

                {revealed && loading && (
                  <div style={{ textAlign: "center", padding: "20px 0" }}>
                    <LoadingSpinner size={32} label="Руны открывают послание..." />
                  </div>
                )}

                {revealed && !loading && interpretation && (
                  <>
                    <Card glow>
                      {/* Список вытащенных рун */}
                      {drawnRunes.map((rune, i) => (
                        <div key={i} style={{
                          marginBottom: 12, paddingBottom: 12,
                          borderBottom: i < drawnRunes.length - 1 ? "1px solid var(--border)" : "none",
                        }}>
                          <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 6 }}>
                            <span style={{ fontSize: 26, color: "var(--accent)", fontFamily: "serif" }}>
                              {rune.symbol}
                            </span>
                            <div>
                              <div style={{ fontSize: 14, fontWeight: 800 }}>{rune.name}</div>
                              {mode.count > 1 && (
                                <div style={{ fontSize: 10, color: "var(--text2)" }}>
                                  {mode.positions[i]}
                                </div>
                              )}
                            </div>
                          </div>
                          <div style={{ fontSize: 11, color: "var(--text2)", lineHeight: 1.5 }}>
                            {rune.meaning}
                          </div>
                        </div>
                      ))}

                      {/* Интерпретация */}
                      <div style={{
                        fontSize: 13, lineHeight: 1.7, color: "var(--text)",
                        paddingTop: drawnRunes.length > 0 ? 8 : 0,
                        borderTop: "1px solid var(--border)",
                      }}>
                        {interpretation}
                      </div>
                    </Card>

                    <div style={{ display: "flex", gap: 8 }}>
                      <Btn variant="ghost" onClick={handleReset} style={{ flex: 1 }}>
                        ↺ Снова
                      </Btn>
                      <Btn variant="ghost" onClick={() => setMode(null)} style={{ flex: 1 }}>
                        ← Меню
                      </Btn>
                    </div>
                  </>
                )}
              </>
            )}
          </>
        )}
      </div>

      {/* === МОДАЛЬНОЕ ОКНО СПРАВОЧНИКА === */}
      <Modal
        open={!!selectedRune}
        onClose={() => setSelectedRune(null)}
        title={selectedRune ? `${selectedRune.symbol}  ${selectedRune.name}` : ""}
      >
        {selectedRune && (
          <div>
            <div style={{ textAlign: "center", marginBottom: 20 }}>
              <div style={{
                fontSize: 72, color: "var(--accent)", fontFamily: "serif",
                filter: "drop-shadow(0 0 16px rgba(139,92,246,0.5))",
                marginBottom: 8,
              }}>
                {selectedRune.symbol}
              </div>
              <div style={{ fontSize: 18, fontWeight: 800 }}>{selectedRune.name}</div>
            </div>
            <div style={{
              background: "var(--bg3)", borderRadius: 12, padding: "12px 14px",
              fontSize: 13, color: "var(--text)", lineHeight: 1.7,
            }}>
              {selectedRune.meaning}
            </div>
            <div style={{ marginTop: 16 }}>
              <Btn
                variant="primary"
                onClick={() => {
                  setSelectedRune(null);
                  if (!mode) handleSelectMode(RUNE_MODES[0]);
                }}
              >
                Использовать в гадании
              </Btn>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
