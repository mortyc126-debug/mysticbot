// ============================================================
// ХИРОМАНТИЯ — чтение по ладони (фото)
// API: src/api/claude.js → analyzePalmistry (Claude Vision)
// Доступ: только Премиум
// ============================================================

import { useState, useRef } from "react";
import { Card, Btn, SLabel, AppHeader, Badge, LoadingSpinner, LockOverlay } from "../components/UI";
import ClaudeAPI from "../api/claude";
import PhotosAPI from "../api/photos";
import TelegramSDK from "../api/telegram";

// Линии ладони — локальный фоллбэк (пока Claude API не подключён)
const PALM_LINES = [
  {
    name: "Линия жизни",
    emoji: "❤️",
    meaning: "Отражает жизненную силу, здоровье и общий жизненный путь. Длина и изгиб говорят о запасе витальной энергии.",
  },
  {
    name: "Линия ума",
    emoji: "🧠",
    meaning: "Показывает стиль мышления, интеллектуальные способности и подход к принятию решений.",
  },
  {
    name: "Линия сердца",
    emoji: "💜",
    meaning: "Связана с эмоциональным миром, отношениями и чувственной жизнью.",
  },
  {
    name: "Линия судьбы",
    emoji: "⭐",
    meaning: "Указывает на карьеру, жизненное призвание и степень влияния судьбы на твой путь.",
  },
];

// Локальный фоллбэк чтения (пока Claude API не подключён)
function getLocalPalmReading(user) {
  const sign = user.sun_sign || "Рыбы";
  const focus = (user.life_focus || []).join(", ") || "саморазвитие";
  return {
    lines: PALM_LINES.map(l => ({
      ...l,
      reading: `Для ${sign} в сфере ${focus}: ${l.meaning}`,
    })),
    summary: `Ладонь несёт в себе карту твоей жизни, ${user.name || ""}. Знак ${sign} усиливает интуитивные линии. Стихия указывает на ${focus} как ключевую область. Помни: линии — не приговор, а подсказка.`,
    prediction: `В ближайшее время твои линии указывают на период трансформации. Доверяй внутреннему голосу — он сейчас особенно точен.`,
  };
}

const STEPS = ["intro", "upload", "result"];

export default function Palmistry({ state, showToast }) {
  const { user, canAccess, setCurrentPage, addLuck, addDailyEnergy, updateOracleMemory,
          shopPurchases, useShopPurchase } = state;

  const [step, setStep]               = useState("intro");
  // Две ладони: правая (настоящее) и левая (потенциал)
  const [rightPhoto, setRightPhoto]   = useState(null);   // { url, base64, mime }
  const [leftPhoto, setLeftPhoto]     = useState(null);
  const [loading, setLoading]         = useState(false);
  const [result, setResult]           = useState(null);
  const rightRef = useRef(null);
  const leftRef  = useRef(null);

  const readPhotoFile = (file) => new Promise((resolve, reject) => {
    if (!file?.type.startsWith("image/")) { reject(new Error("Не изображение")); return; }
    if (file.size > 10 * 1024 * 1024) { reject(new Error("Слишком большое (>10МБ)")); return; }
    const reader = new FileReader();
    reader.onload = (ev) => resolve({
      url: URL.createObjectURL(file),
      base64: ev.target.result.split(",")[1],
      mime: file.type,
    });
    reader.readAsDataURL(file);
  });

  const handleFileChange = (hand) => async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const photo = await readPhotoFile(file);
      if (hand === "right") setRightPhoto(photo);
      else setLeftPhoto(photo);
      if (step === "intro") setStep("upload");
      TelegramSDK.haptic.impact("light");
    } catch (err) {
      showToast(`❌ ${err.message}`);
    }
  };

  const isPremium = canAccess("premium");
  const palmistryPurchased = shopPurchases?.palmistry || 0;
  const canAnalyze = isPremium || palmistryPurchased > 0;

  const handleAnalyze = async () => {
    if (!rightPhoto && !leftPhoto) { showToast("Загрузи хотя бы одно фото ладони"); return; }

    // Списываем купленную попытку
    if (!isPremium && palmistryPurchased > 0) {
      useShopPurchase?.("palmistry");
    }

    setLoading(true);
    TelegramSDK.haptic.impact("medium");

    // Передаём правую ладонь приоритетно, или левую если правой нет
    const mainPhoto = rightPhoto || leftPhoto;

    try {
      const aiResult = await ClaudeAPI.analyzePalmistry({
        imageBase64: mainPhoto.base64,
        mimeType: mainPhoto.mime,
        userContext: state.getContextForClaude(),
        handNote: rightPhoto && leftPhoto ? "Правая и левая ладонь" : rightPhoto ? "Правая ладонь" : "Левая ладонь",
      });

      const palmResult = aiResult || getLocalPalmReading(user);
      setResult(palmResult);
      if (palmResult?.summary) {
        updateOracleMemory?.({ palmistry_summary: palmResult.summary.slice(0, 400) });
      }

      // Сохраняем фото в Supabase Storage (фоново, не блокируем UI)
      if (user?.telegram_id && mainPhoto.base64) {
        PhotosAPI.uploadPhoto({
          telegramId: user.telegram_id,
          type: "palmistry",
          base64: mainPhoto.base64,
          mimeType: mainPhoto.mime,
          reading: palmResult?.summary?.slice(0, 2000),
        }).catch(e => console.warn("[Palmistry] photo save failed:", e.message));
      }
    } catch {
      const fallback = getLocalPalmReading(user);
      setResult(fallback);
    }

    setLoading(false);
    setStep("result");
    addLuck(3, "Хиромантия");
    addDailyEnergy();
    showToast("🖐 +3 💫 Ладонь прочитана!");
    TelegramSDK.haptic.notification("success");
  };

  const handleReset = () => {
    setStep("intro");
    setRightPhoto(null);
    setLeftPhoto(null);
    setResult(null);
    if (rightRef.current) rightRef.current.value = "";
    if (leftRef.current)  leftRef.current.value = "";
  };

  return (
    <div>
      <AppHeader title="🖐 Хиромантия" luckPoints={user.luck_points} streak={user.streak_days} />

      <div style={{ padding: "14px 14px 0", display: "flex", flexDirection: "column", gap: 14 }}>

        {/* Назад */}
        <button
          onClick={() => setCurrentPage("profile")}
          style={{
            background: "none", border: "none", color: "var(--text2)",
            fontSize: 13, cursor: "pointer", textAlign: "left",
            display: "flex", alignItems: "center", gap: 6, padding: 0,
          }}
        >
          ← Назад
        </button>

        {/* === ВВОДНЫЙ ЭКРАН === */}
        {step === "intro" && (
          <>
            <div style={{ textAlign: "center", padding: "16px 0 4px" }}>
              <div style={{ fontSize: 60, marginBottom: 12, animation: "float 3s ease-in-out infinite" }}>
                🖐
              </div>
              <h2 style={{ fontSize: 20, fontWeight: 800, marginBottom: 8 }}>Хиромантия</h2>
              <p style={{ fontSize: 13, color: "var(--text2)", lineHeight: 1.65, marginBottom: 8 }}>
                Каждая линия на твоей ладони — это страница книги жизни. Оракул прочтёт твою судьбу, характер и потенциал по уникальному рисунку линий.
              </p>
              <div style={{ display: "inline-block", marginBottom: 12 }}>
                <Badge tier="premium" />
              </div>
            </div>

            {/* Что раскроет чтение */}
            <Card style={{ background: "rgba(139,92,246,0.06)", border: "1px solid rgba(139,92,246,0.2)" }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10, color: "var(--accent)" }}>
                ✨ Что раскроет чтение
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {[
                  { emoji: "❤️", label: "Линия жизни", desc: "Энергия и здоровье" },
                  { emoji: "🧠", label: "Линия ума", desc: "Мышление и таланты" },
                  { emoji: "💜", label: "Линия сердца", desc: "Любовь и эмоции" },
                  { emoji: "⭐", label: "Линия судьбы", desc: "Призвание и путь" },
                ].map(({ emoji, label, desc }) => (
                  <div key={label} style={{
                    background: "var(--bg3)", borderRadius: 10, padding: "10px 8px",
                    textAlign: "center",
                  }}>
                    <div style={{ fontSize: 22, marginBottom: 4 }}>{emoji}</div>
                    <div style={{ fontSize: 10, fontWeight: 700, marginBottom: 2 }}>{label}</div>
                    <div style={{ fontSize: 10, color: "var(--text2)" }}>{desc}</div>
                  </div>
                ))}
              </div>
            </Card>

            {/* Как это работает */}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {[
                { step: "01", text: "Сфотографируй ладонь при хорошем освещении", icon: "📸" },
                { step: "02", text: "Оракул анализирует рисунок линий и бугров", icon: "🔬" },
                { step: "03", text: "Получаешь персональное чтение за 20 секунд", icon: "🔮" },
              ].map(({ step: s, text, icon }) => (
                <div key={s} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{
                    width: 32, height: 32, borderRadius: "50%", flexShrink: 0,
                    background: "rgba(139,92,246,0.15)", border: "1px solid rgba(139,92,246,0.3)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 14,
                  }}>{icon}</div>
                  <div style={{ fontSize: 13, color: "var(--text)", lineHeight: 1.4 }}>{text}</div>
                </div>
              ))}
            </div>

            {!canAnalyze ? (
              <Card style={{ position: "relative", overflow: "hidden" }}>
                <div style={{ filter: "blur(2px)", pointerEvents: "none" }}>
                  <SLabel>📸 Как сделать хорошее фото</SLabel>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 10 }}>
                    {["Хорошее освещение (дневной свет)", "Ладонь расправлена, пальцы вместе", "Камера прямо над ладонью", "Правая рука — настоящее, левая — потенциал"].map((tip, i) => (
                      <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                        <div style={{
                          width: 22, height: 22, borderRadius: "50%",
                          background: "rgba(139,92,246,0.15)", border: "1px solid rgba(139,92,246,0.3)",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          fontSize: 10, fontWeight: 800, color: "var(--accent)", flexShrink: 0,
                        }}>
                          {i + 1}
                        </div>
                        <div style={{ fontSize: 13, color: "var(--text)", lineHeight: 1.5 }}>{tip}</div>
                      </div>
                    ))}
                  </div>
                </div>
                <LockOverlay tier="premium" onUpgrade={() => setCurrentPage("profile")} />
              </Card>
            ) : (
              <>
                <Card>
                  <SLabel>📸 Как сделать хорошее фото</SLabel>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 12 }}>
                    {[
                      { tip: "Хорошее освещение (дневной свет)", icon: "☀️" },
                      { tip: "Ладонь расправлена, пальцы вместе", icon: "🖐" },
                      { tip: "Камера прямо над ладонью", icon: "📷" },
                      { tip: "Правая рука — настоящее, левая — потенциал", icon: "🔄" },
                    ].map(({ tip, icon }, i) => (
                      <div key={i} style={{ display: "flex", gap: 10, alignItems: "center" }}>
                        <span style={{ fontSize: 18 }}>{icon}</span>
                        <div style={{ fontSize: 13, color: "var(--text)", lineHeight: 1.5 }}>{tip}</div>
                      </div>
                    ))}
                  </div>
                </Card>

                <SLabel>🖐 Линии ладони</SLabel>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  {PALM_LINES.map(l => (
                    <Card key={l.name} style={{ padding: 12 }}>
                      <div style={{ fontSize: 20, marginBottom: 6 }}>{l.emoji}</div>
                      <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 4 }}>{l.name}</div>
                      <div style={{ fontSize: 10, color: "var(--text2)", lineHeight: 1.5 }}>
                        {l.meaning.slice(0, 60)}...
                      </div>
                    </Card>
                  ))}
                </div>

                {/* Скрытые file inputs — только галерея, без камеры */}
                <input ref={rightRef} type="file" accept="image/*" onChange={handleFileChange("right")} style={{ display: "none" }} />
                <input ref={leftRef}  type="file" accept="image/*" onChange={handleFileChange("left")}  style={{ display: "none" }} />

                <div style={{ display: "flex", gap: 10 }}>
                  <div
                    onClick={() => rightRef.current?.click()}
                    style={{
                      flex: 1, borderRadius: 14, border: `2px dashed ${rightPhoto ? "var(--accent)" : "var(--border)"}`,
                      padding: "14px 10px", textAlign: "center", cursor: "pointer",
                      background: rightPhoto ? "rgba(139,92,246,0.08)" : "var(--bg3)", transition: "all 0.2s",
                    }}
                  >
                    {rightPhoto
                      ? <img src={rightPhoto.url} alt="Правая" style={{ width: "100%", height: 80, objectFit: "cover", borderRadius: 8 }} />
                      : <><div style={{ fontSize: 28, marginBottom: 4 }}>🖐</div><div style={{ fontSize: 11, color: "var(--text2)" }}>Правая ладонь</div><div style={{ fontSize: 10, color: "var(--accent)" }}>настоящее</div></>
                    }
                  </div>
                  <div
                    onClick={() => leftRef.current?.click()}
                    style={{
                      flex: 1, borderRadius: 14, border: `2px dashed ${leftPhoto ? "var(--accent)" : "var(--border)"}`,
                      padding: "14px 10px", textAlign: "center", cursor: "pointer",
                      background: leftPhoto ? "rgba(139,92,246,0.08)" : "var(--bg3)", transition: "all 0.2s",
                    }}
                  >
                    {leftPhoto
                      ? <img src={leftPhoto.url} alt="Левая" style={{ width: "100%", height: 80, objectFit: "cover", borderRadius: 8 }} />
                      : <><div style={{ fontSize: 28, marginBottom: 4, transform: "scaleX(-1)" }}>🖐</div><div style={{ fontSize: 11, color: "var(--text2)" }}>Левая ладонь</div><div style={{ fontSize: 10, color: "var(--accent)" }}>потенциал</div></>
                    }
                  </div>
                </div>
                {(rightPhoto || leftPhoto) && (
                  <Btn onClick={() => { setStep("upload"); }}>
                    🔮 Читать ладони
                  </Btn>
                )}
              </>
            )}
          </>
        )}

        {/* === ЭКРАН С ФОТО === */}
        {step === "upload" && (
          <>
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text2)", textAlign: "center", marginBottom: 8 }}>
              {rightPhoto && leftPhoto ? "Обе ладони загружены ✓" : "Фото загружено ✓"}
            </div>
            <div style={{ display: "flex", gap: 10, marginBottom: 4 }}>
              {[{ photo: rightPhoto, label: "Правая 🖐", ref: rightRef, hand: "right" },
                { photo: leftPhoto,  label: "Левая 🖐",  ref: leftRef,  hand: "left" }].map(({ photo, label, ref, hand }) => (
                <div key={hand} style={{ flex: 1, borderRadius: 14, overflow: "hidden", border: "1px solid var(--border)", background: "var(--bg3)", cursor: "pointer" }}
                  onClick={() => ref.current?.click()}>
                  {photo
                    ? <img src={photo.url} alt={label} style={{ width: "100%", height: 120, objectFit: "cover" }} />
                    : <div style={{ height: 120, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4 }}>
                        <span style={{ fontSize: 28 }}>🖐</span>
                        <span style={{ fontSize: 10, color: "var(--text2)" }}>{label}</span>
                        <span style={{ fontSize: 10, color: "var(--accent)" }}>+ загрузить</span>
                      </div>
                  }
                </div>
              ))}
            </div>

            {loading ? (
              <div style={{ textAlign: "center", padding: "24px 0" }}>
                <LoadingSpinner size={36} label="Звёзды читают твои ладони..." />
                <div style={{ fontSize: 12, color: "var(--text2)", marginTop: 12 }}>
                  Анализирую линии жизни, ума, сердца и судьбы...
                </div>
              </div>
            ) : (
              <>
                <Btn onClick={handleAnalyze}>
                  🔮 Прочитать {rightPhoto && leftPhoto ? "обе ладони" : "ладонь"}
                </Btn>
                <Btn variant="ghost" onClick={handleReset}>
                  ← Начать заново
                </Btn>
              </>
            )}
          </>
        )}

        {/* === РЕЗУЛЬТАТ === */}
        {step === "result" && result && (
          <>
            <div style={{ textAlign: "center", padding: "8px 0" }}>
              <div style={{ fontSize: 13, color: "var(--accent)", fontWeight: 700 }}>
                ✦ Чтение завершено
              </div>
            </div>

            {/* Линии ладони */}
            <SLabel>🖐 Линии ладони</SLabel>
            {(result.lines || PALM_LINES).map((l, i) => (
              <Card key={i}>
                <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                  <span style={{ fontSize: 24 }}>{l.emoji}</span>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 4 }}>{l.name}</div>
                    <div style={{ fontSize: 12, color: "var(--text2)", lineHeight: 1.6 }}>
                      {l.reading || l.meaning}
                    </div>
                  </div>
                </div>
              </Card>
            ))}

            {/* Общий вывод */}
            <SLabel>✨ Общий вывод</SLabel>
            <Card glow>
              <div style={{ fontSize: 13, lineHeight: 1.7, color: "var(--text)", marginBottom: 12 }}>
                {result.summary}
              </div>
              {result.prediction && (
                <div style={{
                  background: "rgba(139,92,246,0.08)", borderRadius: 10, padding: "10px 12px",
                  fontSize: 12, color: "var(--accent)", lineHeight: 1.6,
                  border: "1px solid rgba(139,92,246,0.2)",
                }}>
                  🔮 {result.prediction}
                </div>
              )}
            </Card>

            <Btn variant="ghost" onClick={handleReset}>
              ↺ Новое чтение
            </Btn>
          </>
        )}
      </div>
    </div>
  );
}
