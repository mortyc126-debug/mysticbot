import { useState } from "react";

// Миниатюра карты для детальной секции расклада
function CardThumb({ card }) {
  const [err, setErr] = useState(false);
  const isReversed = card?.reversed;
  return (
    <div style={{
      width: 44, height: 64, borderRadius: 8, flexShrink: 0, overflow: "hidden",
      background: err ? (isReversed ? "rgba(239,68,68,0.1)" : "rgba(139,92,246,0.1)") : "transparent",
      border: isReversed ? "1px solid rgba(239,68,68,0.3)" : "1px solid rgba(139,92,246,0.25)",
      display: "flex", alignItems: "center", justifyContent: "center",
      transform: isReversed ? "rotate(180deg)" : "none",
      boxShadow: isReversed ? "0 0 8px rgba(239,68,68,0.15)" : "0 2px 10px rgba(139,92,246,0.2)",
    }}>
      {!err ? (
        <img
          src={`/tarot/${card.id}.png`}
          alt={card.name}
          onError={() => setErr(true)}
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
        />
      ) : (
        <span style={{ fontSize: 22 }}>{card.emoji}</span>
      )}
    </div>
  );
}
import { Card, Btn, SLabel, AppHeader, Badge, TarotCardVisual, Modal } from "../components/UI";
import { ALL_CARDS, SPREADS } from "../data/tarot";
import { interpretTarot } from "../hooks/useAppState";
import ClaudeAPI from "../api/claude";

function drawCards(count) {
  const shuffled = [...ALL_CARDS].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count).map(c => ({ ...c, reversed: Math.random() > 0.65 }));
}

export default function Tarot({ state, showToast }) {
  const { user, canAccess, addLuck, addTarotReading, getContextForClaude,
          canDoReading, getReadingInfo, tarotHistory,
          markDailyCardUsed, addDailyEnergy, oracleMemory, getReferralCode,
          shopPurchases, useShopPurchase } = state;
  const [phase, setPhase] = useState("select"); // select | question | reveal | result
  const [selectedSpread, setSelectedSpread] = useState(null);
  const [question, setQuestion] = useState("");
  const [cards, setCards] = useState([]);
  const [interpretation, setInterpretation] = useState("");
  const [loading, setLoading] = useState(false);
  const [showUpgrade, setShowUpgrade] = useState(false);
  // Тип покупки из магазина, которая будет списана при draw (null = бесплатная попытка)
  const [sessionShopKey, setSessionShopKey] = useState(null);

  // Маппинг: тип расклада → ключ покупки в магазине, которая разблокирует доступ к нему
  const SPREAD_SHOP_MAP = {
    three_cards:  "tarot_three",
    relationship: "tarot_three",
  };

  const handleSelectSpread = (spread) => {
    let shopKey = null;

    // 1. Проверяем доступ к тарифу
    if (!canAccess(spread.tier)) {
      // Фоллбэк: проверяем покупки из магазина удачи для VIP/Premium раскладов
      const shopKeyForSpread = SPREAD_SHOP_MAP[spread.id];
      if (shopKeyForSpread && (shopPurchases?.[shopKeyForSpread] || 0) > 0) {
        shopKey = shopKeyForSpread; // Будет списано при draw
      } else {
        setShowUpgrade(true);
        return;
      }
    }

    // 2. Проверяем лимит бесплатных гаданий (только если используем бесплатную попытку)
    if (!shopKey && !canDoReading(spread.id)) {
      // Бесплатные попытки исчерпаны — проверяем покупки из магазина
      const extraPurchased = shopPurchases?.tarot_extra || 0;
      const spreadShopKey = SPREAD_SHOP_MAP[spread.id];
      const spreadPurchased = spreadShopKey ? (shopPurchases?.[spreadShopKey] || 0) : 0;

      if (extraPurchased > 0) {
        shopKey = "tarot_extra";
      } else if (spreadPurchased > 0) {
        shopKey = spreadShopKey;
      } else {
        const info = getReadingInfo(spread.id);
        const period = info.type === "weekly" ? "на этой неделе" : "сегодня";
        showToast(`⏳ Лимит исчерпан: ${info.used}/${info.max} ${period}`);
        return;
      }
    }

    setSessionShopKey(shopKey);
    setSelectedSpread(spread);
    setPhase("question");
  };

  const handleDraw = async () => {
    if (!selectedSpread) return;
    // Списываем купленную попытку из магазина (если используется)
    if (sessionShopKey) {
      useShopPurchase?.(sessionShopKey);
      setSessionShopKey(null);
    }
    setLoading(true);
    const drawn = drawCards(selectedSpread.cards);
    setCards(drawn);
    setPhase("reveal");

    const context = getContextForClaude();

    let interp = null;
    try {
      interp = await ClaudeAPI.interpretTarot({ spread: selectedSpread, cards: drawn, question, userContext: context });
    } catch {
      interp = null;
    }
    if (!interp) {
      interp = interpretTarot(drawn, question, user, selectedSpread, context, oracleMemory);
    }
    setInterpretation(interp);
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
    });
    showToast("🃏 +1 💫 за гадание!");
  };

  const handleReset = () => {
    setPhase("select");
    setSelectedSpread(null);
    setQuestion("");
    setCards([]);
    setInterpretation("");
    setSessionShopKey(null);
  };

  const handleShareResult = () => {
    const firstCard = cards[0];
    const snippet = interpretation ? interpretation.slice(0, 120).replace(/\n/g, " ") + "…" : "";
    const text = `🃏 Расклад «${selectedSpread?.name}» — карты открыли мне кое-что важное!\n${firstCard ? `${firstCard.emoji} ${firstCard.name}${firstCard.reversed ? " (перевёрнута)" : ""}\n` : ""}«${snippet}»\n\nПроверь своё предсказание в Мистикуме 🔮`;
    const link = `https://t.me/mysticumbot?start=${getReferralCode()}`;
    const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`;
    window.open(shareUrl, "_blank");
  };

  return (
    <div>
      <AppHeader title="🃏 Гадание Таро" luckPoints={user.luck_points} streak={user.streak_days} />

      <div style={{ padding: "14px 14px 0", display: "flex", flexDirection: "column", gap: 14 }}>

        {/* ФАЗА: Выбор расклада */}
        {phase === "select" && (
          <>
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

              <div style={{ display: "flex", gap: 8 }}>
                <Btn variant="ghost" size="sm" onClick={handleReset} style={{ flex: 1 }}>🔄 Новое гадание</Btn>
                <Btn variant="ghost" size="sm" onClick={handleShareResult} style={{ flex: 1 }}>📤 Поделиться</Btn>
              </div>
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
                {/* Миниатюра карты */}
                <CardThumb card={card} />
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

