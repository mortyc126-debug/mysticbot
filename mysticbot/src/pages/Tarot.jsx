import { useState } from "react";
import { Card, Btn, SLabel, AppHeader, Badge, TarotCardVisual, Modal } from "../components/UI";
import { MAJOR_ARCANA, SPREADS } from "../data/tarot";
import { interpretTarot, generatePredictionSeed } from "../hooks/useAppState";
import ClaudeAPI from "../api/claude";

function drawCards(count) {
  const shuffled = [...MAJOR_ARCANA].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count).map(c => ({ ...c, reversed: Math.random() > 0.75 }));
}

export default function Tarot({ state, showToast }) {
  const { user, canAccess, addLuck, addTarotReading, getContextForClaude,
          canDoReading, getReadingInfo, tarotHistory,
          confirmPrediction, getLastUnconfirmedReading, getEngagementHooks,
          markDailyCardUsed, addDailyEnergy, oracleMemory } = state;
  const [phase, setPhase] = useState("select"); // select | question | reveal | result
  const [selectedSpread, setSelectedSpread] = useState(null);
  const [question, setQuestion] = useState("");
  const [cards, setCards] = useState([]);
  const [interpretation, setInterpretation] = useState("");
  const [predictionSeed, setPredictionSeed] = useState("");
  const [loading, setLoading] = useState(false);
  const [showUpgrade, setShowUpgrade] = useState(false);

  const handleSelectSpread = (spread) => {
    if (!canAccess(spread.tier)) {
      setShowUpgrade(true);
      return;
    }
    // Проверка лимита гаданий
    if (!canDoReading(spread.id)) {
      const info = getReadingInfo(spread.id);
      const period = info.type === "weekly" ? "на этой неделе" : "сегодня";
      showToast(`⏳ Лимит исчерпан: ${info.used}/${info.max} ${period}`);
      return;
    }
    setSelectedSpread(spread);
    setPhase("question");
  };

  const handleDraw = async () => {
    if (!selectedSpread) return;
    setLoading(true);
    const drawn = drawCards(selectedSpread.cards);
    setCards(drawn);
    setPhase("reveal");

    const context = getContextForClaude();

    let interp = null;
    let seed = null;
    try {
      [interp, seed] = await Promise.all([
        ClaudeAPI.interpretTarot({ spread: selectedSpread, cards: drawn, question, userContext: context }),
        ClaudeAPI.generatePredictionSeedAI({ cards: drawn, question, userContext: context }),
      ]);
    } catch {
      interp = null;
      seed = null;
    }
    if (!interp) {
      interp = interpretTarot(drawn, question, user, selectedSpread, context, oracleMemory);
    }
    if (!seed) {
      seed = generatePredictionSeed(drawn, question, user, selectedSpread);
    }
    setInterpretation(interp);
    setPredictionSeed(seed);
    setLoading(false);
    setPhase("result");
    addLuck(1, "Гадание Таро");
    addDailyEnergy();
    // Карта дня (one_card) синхронизируется с главным экраном
    if (selectedSpread.id === "one_card") markDailyCardUsed();
    addTarotReading({
      spread: selectedSpread.name,
      spreadId: selectedSpread.id,
      question,
      cards: drawn.map((c, i) => ({
        name: c.name,
        position: selectedSpread.positions[i] || `Карта ${i+1}`,
        reversed: c.reversed,
      })),
      interpretation: interp,
      prediction_seed: seed,
    });
    showToast("🃏 +1 💫 за гадание!");
  };

  const handleReset = () => {
    setPhase("select");
    setSelectedSpread(null);
    setQuestion("");
    setCards([]);
    setInterpretation("");
    setPredictionSeed("");
  };

  return (
    <div>
      <AppHeader title="🃏 Гадание Таро" luckPoints={user.luck_points} streak={user.streak_days} />

      <div style={{ padding: "14px 14px 0", display: "flex", flexDirection: "column", gap: 14 }}>

        {/* ФАЗА: Выбор расклада */}
        {phase === "select" && (
          <>
            {/* === БАННЕР: ПОДТВЕРЖДЕНИЕ ПРЕДСКАЗАНИЯ === */}
            <UnconfirmedBanner
              reading={getLastUnconfirmedReading()}
              onConfirm={(id, result) => {
                confirmPrediction(id, result);
                if (result === "yes")    showToast("✨ +5 💫 Предсказание сбылось!");
                if (result === "partly") showToast("🌗 +2 💫 Частичное совпадение");
                if (result === "no")     showToast("🌑 Записано. Карты учтут это.");
              }}
            />

            {/* === ПАТТЕРН: ПОВТОРЯЮЩАЯСЯ КАРТА === */}
            <RepeatingCardBanner tarotHistory={tarotHistory} />

            {/* === ЭНЕРГЕТИЧЕСКОЕ ОКНО === */}
            <EnergyWindowBanner hooks={getEngagementHooks()} sign={user.sun_sign} />

            <SLabel>Выбери расклад</SLabel>
            {SPREADS.map(spread => {
              const accessible = canAccess(spread.tier);
              const info = getReadingInfo(spread.id);
              const limitReached = accessible && info.max > 0 && info.used >= info.max;
              return (
                <div key={spread.id} onClick={() => handleSelectSpread(spread)} style={{
                  background: "var(--card)", border: "1px solid var(--border)", borderRadius: 14,
                  padding: "12px 14px", cursor: "pointer", transition: "all 0.2s",
                  opacity: accessible && !limitReached ? 1 : 0.7,
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = "rgba(139,92,246,0.5)"}
                  onMouseLeave={e => e.currentTarget.style.borderColor = "var(--border)"}
                >
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 2 }}>
                      {spread.emoji} {spread.name}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text2)" }}>{spread.desc}</div>
                    {/* Отображение лимита */}
                    {accessible && info.max > 0 && info.max < 999 && (
                      <div style={{ fontSize: 10, color: limitReached ? "#f87171" : "var(--text2)", marginTop: 3 }}>
                        {limitReached ? "⏳ Лимит исчерпан" : `${info.used}/${info.max} ${info.type === "weekly" ? "в неделю" : "в день"}`}
                      </div>
                    )}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <Badge tier={spread.tier} />
                    {!accessible && <span style={{ fontSize: 14 }}>🔒</span>}
                    {limitReached && accessible && <span style={{ fontSize: 14 }}>⏳</span>}
                  </div>
                </div>
              );
            })}
          </>
        )}

        {/* ФАЗА: Вопрос */}
        {phase === "question" && selectedSpread && (
          <>
            <Card>
              <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 4 }}>
                {selectedSpread.emoji} {selectedSpread.name}
              </div>
              <div style={{ fontSize: 12, color: "var(--text2)", marginBottom: 12 }}>
                {selectedSpread.positions.join(" · ")}
              </div>
              <div style={{ fontSize: 13, color: "var(--text2)", marginBottom: 8, fontWeight: 600 }}>О чём хочешь спросить карты?</div>
              <textarea
                value={question}
                onChange={e => setQuestion(e.target.value)}
                placeholder="Напиши свой вопрос... (можно оставить пустым для общего прогноза)"
                style={{
                  width: "100%", minHeight: 80, padding: "10px 12px", borderRadius: 11,
                  background: "var(--bg3)", border: "1px solid var(--border)", color: "var(--text)",
                  fontSize: 13, lineHeight: 1.5, resize: "none", outline: "none", fontFamily: "inherit",
                }}
                onFocus={e => e.target.style.borderColor = "rgba(139,92,246,0.5)"}
                onBlur={e => e.target.style.borderColor = "var(--border)"}
              />
            </Card>
            <div style={{ display: "flex", gap: 9 }}>
              <Btn variant="ghost" onClick={handleReset} style={{ flex: 1 }}>← Назад</Btn>
              <Btn onClick={handleDraw} style={{ flex: 2 }}>🔮 Тасовать карты</Btn>
            </div>
          </>
        )}

        {/* ФАЗА: Анимация */}
        {phase === "reveal" && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 24, paddingTop: 40 }}>
            <div style={{ fontSize: 56, animation: "spin 2s linear infinite" }}>🔮</div>
            <div style={{ fontSize: 16, fontWeight: 700, textAlign: "center" }}>Карты тасуются...</div>
            <div style={{ fontSize: 13, color: "var(--text2)", textAlign: "center" }}>
              {user.sun_sign} общается со звёздами
            </div>
            <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
              {Array.from({ length: selectedSpread?.cards > 3 ? 3 : selectedSpread?.cards || 1 }).map((_, i) => (
                <TarotCardVisual key={i} card={null} size="md" revealed={false} />
              ))}
            </div>
          </div>
        )}

        {/* ФАЗА: Результат */}
        {phase === "result" && (
          <>
            <Card>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text2)", marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                {selectedSpread?.emoji} {selectedSpread?.name}
              </div>

              {/* Карточки */}
              {cards.length <= 3 ? (
                <div style={{ display: "flex", gap: 8, justifyContent: "center", marginBottom: 14 }}>
                  {cards.map((card, i) => (
                    <TarotCardVisual key={i} card={card} position={selectedSpread?.positions[i]} size={cards.length === 1 ? "lg" : "md"} revealed={true} />
                  ))}
                </div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: cards.length > 6 ? "repeat(5, 1fr)" : "repeat(3, 1fr)", gap: 8, marginBottom: 14 }}>
                  {cards.map((card, i) => (
                    <TarotCardVisual key={i} card={card} position={selectedSpread?.positions[i]} size="sm" revealed={true} />
                  ))}
                </div>
              )}

              {/* Сводка по картам — прямые/перевёрнутые */}
              {cards.length > 0 && (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
                  {cards.map((c, i) => (
                    <div key={i} style={{
                      fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 8,
                      background: c.reversed ? "rgba(239,68,68,0.1)" : "rgba(139,92,246,0.1)",
                      border: `1px solid ${c.reversed ? "rgba(239,68,68,0.3)" : "rgba(139,92,246,0.25)"}`,
                      color: c.reversed ? "#f87171" : "#a78bfa",
                    }}>
                      {c.emoji} {c.reversed ? "↕" : "↑"}
                    </div>
                  ))}
                  <div style={{ fontSize: 10, color: "var(--text2)", alignSelf: "center", marginLeft: 2 }}>
                    {cards.filter(c => c.reversed).length > 0
                      ? `${cards.filter(c => c.reversed).length} перевёрнутых`
                      : "все прямые"}
                  </div>
                </div>
              )}

              {/* Интерпретация */}
              <div style={{ background: "var(--bg3)", borderRadius: 12, padding: 12, fontSize: 13, lineHeight: 1.65, color: "var(--text2)", marginBottom: 12 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", marginBottom: 6 }}>✨ Интерпретация</div>
                {interpretation}
              </div>

              {question && (
                <div style={{ fontSize: 12, color: "var(--text2)", marginBottom: 12, fontStyle: "italic" }}>
                  «{question}»
                </div>
              )}

              <Btn variant="ghost" size="sm" onClick={handleReset}>🔄 Новое гадание</Btn>
            </Card>

            {/* Карты из расклада (детально) */}
            <SLabel>📖 Детали расклада</SLabel>
            {cards.map((card, i) => (
              <div key={i} style={{
                background: "var(--card)",
                border: `1px solid ${card.reversed ? "rgba(239,68,68,0.25)" : "var(--border)"}`,
                borderRadius: 13, padding: "12px 13px",
                display: "flex", gap: 12, alignItems: "flex-start",
              }}>
                {/* Иконка карты — перевёрнута на 180° если reversed */}
                <div style={{
                  fontSize: 26, width: 44, height: 44, flexShrink: 0,
                  background: card.reversed ? "rgba(239,68,68,0.1)" : "rgba(139,92,246,0.1)",
                  borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center",
                  transform: card.reversed ? "rotate(180deg)" : "none",
                  border: card.reversed ? "1px solid rgba(239,68,68,0.3)" : "none",
                }}>
                  {card.emoji}
                </div>
                <div style={{ flex: 1 }}>
                  {/* Позиция расклада */}
                  <div style={{ fontSize: 11, color: "var(--text2)", marginBottom: 3 }}>
                    {selectedSpread?.positions[i] || `Карта ${i + 1}`}
                  </div>
                  {/* Название + бейдж перевёрнутой */}
                  <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 5 }}>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>{card.name}</div>
                    {card.reversed
                      ? <span style={{ fontSize: 9, fontWeight: 700, color: "#f87171", background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 6, padding: "1px 6px" }}>↕ перевёрнута</span>
                      : <span style={{ fontSize: 9, fontWeight: 700, color: "#a78bfa", background: "rgba(139,92,246,0.1)", border: "1px solid rgba(139,92,246,0.25)", borderRadius: 6, padding: "1px 6px" }}>прямая</span>
                    }
                  </div>
                  {/* Ключевые слова */}
                  <div style={{ fontSize: 11, color: "var(--accent)", marginBottom: 5 }}>{card.keywords}</div>
                  {/* Значение — reversed или upright */}
                  <div style={{ fontSize: 12, color: "var(--text2)", lineHeight: 1.55 }}>
                    {card.reversed ? card.meaning_rev : card.meaning_up}
                  </div>
                </div>
              </div>
            ))}

            {/* === КРЮЧОК НА ЗАВТРА: SEED ПРЕДСКАЗАНИЯ === */}
            {predictionSeed && (
              <div style={{
                background: "linear-gradient(135deg,rgba(139,92,246,0.12),rgba(245,158,11,0.08))",
                border: "1px solid rgba(139,92,246,0.3)",
                borderRadius: 16, padding: "14px 16px",
                animation: "fadeInUp 0.5s ease",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <span style={{ fontSize: 20 }}>🔭</span>
                  <div style={{ fontSize: 12, fontWeight: 800, color: "var(--accent)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                    Знак, которого стоит ждать
                  </div>
                </div>
                <div style={{ fontSize: 13, color: "var(--text)", lineHeight: 1.65 }}>
                  {predictionSeed}
                </div>
                <div style={{ fontSize: 11, color: "var(--text2)", marginTop: 10, padding: "6px 10px", background: "rgba(139,92,246,0.06)", borderRadius: 8 }}>
                  ✦ Вернись завтра и отметь — сбылось ли. Это влияет на точность твоих следующих раскладов.
                </div>
              </div>
            )}

            <div style={{ height: 8 }} />
          </>
        )}
      </div>

      {/* Upgrade Modal */}
      <Modal open={showUpgrade} onClose={() => setShowUpgrade(false)} title="🔒 Нужна подписка">
        <div style={{ fontSize: 13, color: "var(--text2)", marginBottom: 16, lineHeight: 1.6 }}>
          Этот расклад доступен в Премиум тарифе. Открой все расклады, хиромантию и персонального астролога!
        </div>
        <div style={{ display: "flex", gap: 12, marginBottom: 14 }}>
          <div style={{ flex: 1, textAlign: "center", background: "var(--bg3)", borderRadius: 12, padding: "10px 8px" }}>
            <div style={{ fontSize: 22, fontWeight: 900, color: "var(--accent)" }}>249₽</div>
            <div style={{ fontSize: 11, color: "var(--text2)" }}>VIP / мес</div>
          </div>
          <div style={{ flex: 1, textAlign: "center", background: "linear-gradient(135deg,#1a0a2e,#0a1628)", borderRadius: 12, padding: "10px 8px", border: "1px solid rgba(245,158,11,0.25)" }}>
            <div style={{ fontSize: 22, fontWeight: 900, color: "var(--gold2)" }}>499₽</div>
            <div style={{ fontSize: 11, color: "var(--text2)" }}>Премиум / мес</div>
          </div>
        </div>
        <Btn variant="gold" onClick={() => { setShowUpgrade(false); showToast("💳 Оплата будет доступна скоро!"); }}>
          {/* TODO: TELEGRAM PAYMENTS */}
          👑 Активировать Премиум
        </Btn>
        <div style={{ height: 10 }} />
        <Btn variant="ghost" onClick={() => setShowUpgrade(false)}>Закрыть</Btn>
      </Modal>
    </div>
  );
}

// ============================================================
// БАННЕР: ПОДТВЕРЖДЕНИЕ ВЧЕРАШНЕГО ПРЕДСКАЗАНИЯ
// ============================================================
function UnconfirmedBanner({ reading, onConfirm }) {
  if (!reading) return null;
  const date = new Date(reading.date).toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
  return (
    <div style={{
      background: "linear-gradient(135deg,rgba(245,158,11,0.1),rgba(139,92,246,0.08))",
      border: "1px solid rgba(245,158,11,0.35)",
      borderRadius: 16, padding: "14px 16px",
      animation: "fadeInUp 0.4s ease",
    }}>
      <div style={{ fontSize: 12, fontWeight: 800, color: "var(--gold2)", marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
        <span>🔭</span> Предсказание от {date}
      </div>
      <div style={{ fontSize: 12, color: "var(--text)", lineHeight: 1.6, marginBottom: 12 }}>
        {reading.prediction_seed}
      </div>
      <div style={{ fontSize: 11, color: "var(--text2)", marginBottom: 10, fontWeight: 600 }}>
        Это сбылось?
      </div>
      <div style={{ display: "flex", gap: 7 }}>
        {[
          ["yes",    "✅ Да",        "#4ade80", "rgba(34,197,94,0.12)",  "rgba(34,197,94,0.3)"],
          ["partly", "🌗 Частично",  "var(--gold2)", "rgba(245,158,11,0.1)", "rgba(245,158,11,0.3)"],
          ["no",     "❌ Нет",       "#f87171", "rgba(239,68,68,0.1)", "rgba(239,68,68,0.3)"],
        ].map(([val, label, color, bg, border]) => (
          <button key={val} onClick={() => onConfirm(reading.id, val)} style={{
            flex: 1, padding: "8px 4px", borderRadius: 10, border: `1px solid ${border}`,
            background: bg, color, fontSize: 11, fontWeight: 700, cursor: "pointer",
          }}>
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// БАННЕР: ПОВТОРЯЮЩАЯСЯ КАРТА
// ============================================================
function RepeatingCardBanner({ tarotHistory }) {
  if (!tarotHistory || tarotHistory.length < 2) return null;
  const freq = {};
  tarotHistory.slice(0, 7).forEach(r =>
    (r.cards || []).forEach(c => { freq[c.name] = (freq[c.name] || 0) + 1; })
  );
  const [cardName, count] = Object.entries(freq).find(([, n]) => n >= 2) || [];
  if (!cardName) return null;

  // Найти карточку для её emoji
  const allCards = tarotHistory.flatMap(r => r.cards || []);
  const emoji = allCards.find(c => c.name === cardName)?.emoji || "🃏";

  return (
    <div style={{
      background: "rgba(139,92,246,0.08)",
      border: "1px solid rgba(139,92,246,0.25)",
      borderRadius: 14, padding: "11px 14px",
      display: "flex", alignItems: "center", gap: 12,
    }}>
      <span style={{ fontSize: 28 }}>{emoji}</span>
      <div>
        <div style={{ fontSize: 12, fontWeight: 800, color: "var(--accent)", marginBottom: 3 }}>
          ✦ Карта возвращается снова
        </div>
        <div style={{ fontSize: 11, color: "var(--text2)", lineHeight: 1.55 }}>
          «{cardName}» появилась в {count} из твоих последних раскладов. Это не случайность — она несёт послание, которое ты ещё не услышал(а).
        </div>
      </div>
    </div>
  );
}

// ============================================================
// БАННЕР: ЭНЕРГЕТИЧЕСКОЕ ОКНО
// ============================================================
function EnergyWindowBanner({ hooks, sign }) {
  const { isWindowOpen, hoursLeft, peakHour } = hooks;
  const ampm = peakHour >= 18 ? "вечером" : peakHour >= 12 ? "днём" : "утром";
  const peakStr = `${peakHour}:00`;

  if (isWindowOpen) {
    return (
      <div style={{
        background: "linear-gradient(135deg,rgba(34,197,94,0.1),rgba(139,92,246,0.06))",
        border: "1px solid rgba(34,197,94,0.3)",
        borderRadius: 14, padding: "11px 14px",
        display: "flex", alignItems: "center", gap: 10,
      }}>
        <span style={{ fontSize: 22 }}>⚡</span>
        <div>
          <div style={{ fontSize: 12, fontWeight: 800, color: "#4ade80", marginBottom: 2 }}>
            Энергетическое окно открыто
          </div>
          <div style={{ fontSize: 11, color: "var(--text2)" }}>
            Для {sign} сейчас лучшее время гадания — точность карт максимальна.
          </div>
        </div>
      </div>
    );
  }

  if (hoursLeft <= 6) {
    return (
      <div style={{
        background: "rgba(245,158,11,0.07)",
        border: "1px solid rgba(245,158,11,0.2)",
        borderRadius: 14, padding: "11px 14px",
        display: "flex", alignItems: "center", gap: 10,
      }}>
        <span style={{ fontSize: 20 }}>🕐</span>
        <div style={{ fontSize: 11, color: "var(--text2)" }}>
          Энергетический пик {sign} — {peakStr} {ampm}.
          <span style={{ color: "var(--gold2)", fontWeight: 700 }}> Через {hoursLeft}ч</span> карты будут сильнее.
        </div>
      </div>
    );
  }

  return null;
}
