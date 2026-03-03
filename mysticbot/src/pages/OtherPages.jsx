// =====================
// ASTROLOGY PAGE
// =====================
import { useState, useEffect, useRef } from "react";
import { Card, Btn, SLabel, AppHeader, Badge, Modal, pluralizeDays } from "../components/UI";
import ClaudeAPI from "../api/claude";
import { ZODIAC_SIGNS, ALL_CARDS } from "../data/tarot";
import { getMasteryLevel, MASTERY_LEVELS, DAILY_PLANETS_STUB, MYSTICAL_CALENDAR_2026, SPREAD_NAMES,
         getPersonalizedPlanetInfluence, getPersonalizedRitual,
         getDailyCache, setDailyCache, ACHIEVEMENTS_LIST } from "../hooks/useAppState";
import { DREAM_SYMBOLS } from "../data/dreamSymbols";
import { openSubscriptionPayment, openLuckPayment, LUCK_PACKAGES } from "../api/payments";

function CollectionCardImg({ id, emoji, name }) {
  const [err, setErr] = useState(false);
  if (err) return <div style={{ fontSize: 26, marginBottom: 4 }}>{emoji}</div>;
  return (
    <img
      src={`/tarot/${id}.jpg`}
      alt={name}
      onError={() => setErr(true)}
      style={{ width: "100%", aspectRatio: "2/3", objectFit: "contain", display: "block", borderRadius: "8px 8px 0 0" }}
    />
  );
}

export function Astrology({ state, showToast }) {
  const { user, canAccess,
          canCheckCompat, getCompatInfo, useCompatCheck,
          canReferralCompat, getReferralCompatInfo, useReferralCompat,
          getReferralCode, addLuck, addDailyEnergy, updateOracleMemory,
          oracleMemory, shopPurchases, useShopPurchase, unlockAchievement } = state;
  const [selectedSign, setSelectedSign] = useState(
    ZODIAC_SIGNS.find(z => z.sign === user.sun_sign) || ZODIAC_SIGNS[11]
  );
  const [compatSign, setCompatSign] = useState(null);
  const [compatType, setCompatType] = useState("basic"); // "basic" | "detailed"
  const [compatResult, setCompatResult] = useState(null);
  const [compatLoading, setCompatLoading] = useState(false);
  const [showPartnerForm, setShowPartnerForm] = useState(false);
  const [partnerData, setPartnerData] = useState({ name: "", birthDate: "", birthTime: "", city: "", country: "" });
  const [calMonth, setCalMonth] = useState(new Date().getMonth() + 1); // 1-12
  const calYear = new Date().getFullYear();
  const [planets, setPlanets] = useState(DAILY_PLANETS_STUB);

  // Модальное окно для события календаря
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [eventForecast, setEventForecast] = useState(null);
  const [eventForecastLoading, setEventForecastLoading] = useState(false);
  // Модальное окно для планеты
  const [selectedPlanet, setSelectedPlanet] = useState(null);
  const [planetForecast, setPlanetForecast] = useState(null);
  const [planetForecastLoading, setPlanetForecastLoading] = useState(false);

  // Загружаем планеты из дневного кэша или через Claude
  useEffect(() => {
    const cached = getDailyCache("planets");
    if (cached) { setPlanets(cached); return; }
    const todayStr = new Date().toLocaleDateString("ru-RU", { year: "numeric", month: "long", day: "numeric" });
    ClaudeAPI.generateDailyPlanets(todayStr)
      .then(data => { if (data) { setPlanets(data); setDailyCache("planets", data); } })
      .catch(() => {});
  }, []);

  // Загружаем прогноз для события когда открывается модальное окно
  useEffect(() => {
    if (!selectedEvent) { setEventForecast(null); return; }
    const sign = user.sun_sign || "unknown";
    const cacheKey = `event_${selectedEvent.date}_${sign}`;
    const cached = getDailyCache(cacheKey);
    if (cached) { setEventForecast(cached); return; }
    setEventForecastLoading(true);
    ClaudeAPI.getEventForecast({ event: selectedEvent, userContext: { sun_sign: sign } })
      .then(text => {
        if (text) { setEventForecast(text); setDailyCache(cacheKey, text); }
        setEventForecastLoading(false);
      })
      .catch(() => setEventForecastLoading(false));
  }, [selectedEvent, user.sun_sign]);

  // Загружаем прогноз для планеты когда открывается модальное окно
  useEffect(() => {
    if (!selectedPlanet) { setPlanetForecast(null); return; }
    const sign = user.sun_sign || "unknown";
    const isVip = canAccess("vip");
    const cacheKey = `planet_${selectedPlanet.name}_${sign}_${isVip ? "vip" : "free"}`;
    const cached = getDailyCache(cacheKey);
    if (cached) { setPlanetForecast(cached); return; }
    setPlanetForecastLoading(true);
    ClaudeAPI.generatePlanetForecast({
      planetName: selectedPlanet.name,
      planetData: selectedPlanet.data,
      userSign: sign,
      isVip,
      userContext: { sun_sign: sign, life_focus_priority: (user.life_focus || []).join(", ") },
    })
      .then(text => {
        if (text) { setPlanetForecast(text); setDailyCache(cacheKey, text); }
        setPlanetForecastLoading(false);
      })
      .catch(() => setPlanetForecastLoading(false));
  }, [selectedPlanet, user.sun_sign]);
  // Натальная карта
  const [natalLoading, setNatalLoading] = useState(false);
  const [natalResult, setNatalResult] = useState(oracleMemory?.natal_summary || null);

  const handleGenerateNatalChart = async () => {
    // Проверяем загрузку ДО списания попытки — иначе двойной клик тратит покупку впустую
    if (natalLoading) return;
    const natalPurchased = shopPurchases?.natal_chart || 0;
    if (!canAccess("premium") && natalPurchased <= 0) {
      showToast("👑 Нужен Премиум или купи в Магазине удачи (⭐ 30 💫)");
      return;
    }
    // Списываем купленную попытку если нет Премиума
    if (!canAccess("premium") && natalPurchased > 0) {
      useShopPurchase?.("natal_chart");
    }
    setNatalLoading(true);
    try {
      const result = await ClaudeAPI.generateNatalChart({
        birthDate: user.birth_date,
        birthTime: user.birth_time,
        birthPlace: user.birth_place,
        userContext: { name: user.name, sun_sign: user.sun_sign },
      });
      if (result?.description) {
        setNatalResult(result.description);
        updateOracleMemory?.(prev => ({ ...prev, natal_summary: result.description.slice(0, 600) }));
      } else {
        showToast("Не удалось получить карту. Попробуй позже.");
      }
    } catch {
      showToast("Ошибка при генерации. Попробуй позже.");
    } finally {
      setNatalLoading(false);
    }
  };

  // Реферальная ссылка
  const [showReferral, setShowReferral] = useState(false);

  const getCompat = (a, b) => {
    const el = { "Огонь": 0, "Земля": 1, "Воздух": 2, "Вода": 3 };
    const diff = Math.abs(el[a.element] - el[b.element]);
    return [95, 60, 80, 70][diff % 4];
  };

  const runCompatAI = async (type, pd) => {
    setCompatResult(null);
    setCompatLoading(true);
    const result = await ClaudeAPI.analyzeCompatibility({
      sign1: selectedSign.sign,
      sign2: compatSign.sign,
      detailed: type === "detailed",
      partnerData: pd || null,
      userContext: {
        name: user.name,
        sun_sign: user.sun_sign,
        relationship_status: user.relationship_status,
        oracle_memory: user.oracle_memory,
      },
    });
    setCompatResult(result);
    setCompatLoading(false);
  };

  const handleCompatCheck = (type) => {
    if (!compatSign) { showToast("Выбери знак для проверки"); return; }
    if (!canCheckCompat(type)) {
      const info = getCompatInfo(type);
      showToast(`⏳ Лимит ${type === "detailed" ? "детальных" : "обычных"} проверок: ${info.used}/${info.max} в неделю`);
      return;
    }
    if (type === "detailed" && !canAccess("vip")) {
      showToast("⭐ Детальный анализ доступен в VIP тарифе");
      return;
    }
    if (type === "detailed") {
      setShowPartnerForm(true);
      return;
    }
    useCompatCheck(type);
    setCompatType(type);
    addLuck(1, "Проверка совместимости");
    addDailyEnergy();
    unlockAchievement?.("first_compat");
    runCompatAI(type, null);
  };

  const handleDetailedSubmit = () => {
    setShowPartnerForm(false);
    useCompatCheck("detailed");
    setCompatType("detailed");
    addLuck(1, "Детальная совместимость");
    addDailyEnergy();
    runCompatAI("detailed", partnerData);
  };

  const handleReferralCompat = () => {
    if (!compatSign) { showToast("Выбери знак для проверки"); return; }
    if (!canReferralCompat()) {
      const info = getReferralCompatInfo();
      if (!info.hasFriends) {
        showToast("👥 Пригласи друга для бесплатных проверок!");
        return;
      }
      showToast(`⏳ Лимит реферальных проверок: ${info.used}/${info.max} в день`);
      return;
    }
    useReferralCompat();
    setCompatType("basic");
    runCompatAI("basic", null);
  };

  const handleShareCompat = () => {
    if (!compatResult || !compatSign) return;
    const percent = compatResult.percent;
    const mood = percent >= 80 ? "🔥 Огонь!" : percent >= 60 ? "💫 Хорошая пара" : "🌗 Есть нюансы";
    const text = `${mood} Совместимость ${selectedSign.sign} + ${compatSign.sign} = ${percent}%\n«${(compatResult.description || "").slice(0, 100).replace(/\n/g, " ")}…»\n\nПроверь свою совместимость в Мистикуме 🔮`;
    const link = `https://t.me/mysticumbot?start=${getReferralCode()}`;
    const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`;
    window.open(shareUrl, "_blank");
  };

  const compatBasicInfo = getCompatInfo("basic");
  const compatDetailedInfo = getCompatInfo("detailed");
  const referralInfo = getReferralCompatInfo();

  // События текущего месяца из реального календаря
  const monthEvents = MYSTICAL_CALENDAR_2026.filter(e => {
    const d = new Date(e.date);
    return d.getFullYear() === calYear && d.getMonth() + 1 === calMonth;
  });

  const monthNames = ["Янв","Фев","Мар","Апр","Май","Июн","Июл","Авг","Сен","Окт","Ноя","Дек"];
  const typeColors = {
    new_moon:  { bg: "rgba(139,92,246,0.12)", border: "rgba(139,92,246,0.3)", color: "#a78bfa" },
    full_moon: { bg: "rgba(245,158,11,0.12)", border: "rgba(245,158,11,0.3)", color: "#fbbf24" },
    portal:    { bg: "rgba(34,197,94,0.1)",   border: "rgba(34,197,94,0.3)",  color: "#4ade80" },
    eclipse:   { bg: "rgba(239,68,68,0.1)",   border: "rgba(239,68,68,0.3)",  color: "#f87171" },
    solar:     { bg: "rgba(251,191,36,0.08)", border: "rgba(251,191,36,0.2)", color: "#fde68a" },
    equinox:   { bg: "rgba(139,92,246,0.15)", border: "rgba(139,92,246,0.4)", color: "#c4b5fd" },
    solstice:  { bg: "rgba(245,158,11,0.15)", border: "rgba(245,158,11,0.4)", color: "#fcd34d" },
    celtic:    { bg: "rgba(34,197,94,0.12)",  border: "rgba(34,197,94,0.35)", color: "#6ee7b7" },
  };

  const typeNames = {
    new_moon: "🌑 Новолуние", full_moon: "🌕 Полнолуние", portal: "✨ Энергетический портал",
    eclipse: "🌗 Затмение", solar: "☀️ Солнце в знаке", equinox: "🌿 Равноденствие",
    solstice: "☀️ Солнцестояние", celtic: "🔥 Кельтский праздник",
  };

  const planetDescriptions = {
    "Солнце": "Солнце определяет основную энергию дня, влияет на самовыражение и жизненную силу.",
    "Луна": "Луна управляет эмоциями, интуицией и подсознательными процессами. Лунная фаза влияет на настроение и восприимчивость.",
    "Меркурий": "Меркурий отвечает за коммуникации, мышление, обучение и деловые контакты.",
    "Венера": "Венера управляет любовью, красотой, отношениями и финансами.",
    "Марс": "Марс даёт энергию действия, мотивацию, решительность и сексуальную энергию.",
    "Юпитер": "Юпитер — планета расширения, удачи, мудрости и духовного роста.",
    "Сатурн": "Сатурн — учитель зодиака. Ограничения, дисциплина, структура и кармические уроки.",
  };

  const planetsList = [
    { key: "Солнце", emoji: "☀️", data: planets.sun },
    { key: "Луна", emoji: "🌙", data: planets.moon },
    { key: "Меркурий", emoji: "☿", data: planets.mercury },
    { key: "Венера", emoji: "♀", data: planets.venus },
    { key: "Марс", emoji: "♂", data: planets.mars },
    { key: "Юпитер", emoji: "♃", data: planets.jupiter },
    { key: "Сатурн", emoji: "♄", data: planets.saturn },
  ];

  return (
    <div>
      <AppHeader title="🌟 Астрология" luckPoints={user.luck_points} streak={user.streak_days} />
      <div style={{ padding: "14px 14px 0", display: "flex", flexDirection: "column", gap: 14 }}>

        {/* Натальная карта (Премиум) */}
        <SLabel>⭐ Натальная карта</SLabel>
        <div style={{ position: "relative" }}>
          <Card>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 700 }}>Твоя карта на эту неделю</div>
              <Badge tier="premium" />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: 12 }}>
              {[["☀️","Солнце",user.sun_sign||"не определено"],["🌙","Луна",user.moon_sign||"не определено"],["⬆️","Асц.",user.ascendant||(user.birth_time?"вычисляется…":"нет времени рождения")]].map(([e,l,v]) => (
                <div key={l} style={{ textAlign: "center", background: "var(--bg3)", borderRadius: 11, padding: 10 }}>
                  <div style={{ fontSize: 22, marginBottom: 4 }}>{e}</div>
                  <div style={{ fontSize: 10, color: "var(--text2)" }}>{l}</div>
                  <div style={{ fontSize: 12, fontWeight: 700 }}>{v}</div>
                </div>
              ))}
            </div>
            {natalResult && (
              <div style={{ fontSize: 12, color: "var(--text2)", lineHeight: 1.6, marginBottom: 10, padding: "10px 12px", background: "var(--bg3)", borderRadius: 11 }}>
                {natalResult}
              </div>
            )}
            <Btn variant="primary" size="sm" onClick={handleGenerateNatalChart} disabled={natalLoading}>
              {natalLoading ? "⏳ Составляю карту..." : natalResult ? "🔄 Обновить карту" : "🔄 Получить натальную карту"}
            </Btn>
          </Card>
          {!canAccess("premium") && (
            <div style={{ position: "absolute", inset: 0, background: "rgba(10,10,15,0.85)", backdropFilter: "blur(4px)", borderRadius: 18, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, cursor: "pointer" }} onClick={() => showToast("👑 Нужен Премиум тариф — 499₽/мес")}>
              <span style={{ fontSize: 28 }}>🔒</span>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text2)" }}>Доступно в Премиум</div>
              <div style={{ background: "linear-gradient(135deg,#f59e0b,#d97706)", color: "white", padding: "7px 16px", borderRadius: 10, fontSize: 12, fontWeight: 700 }}>499₽ / мес</div>
            </div>
          )}
        </div>

        {/* Совместимость */}
        <SLabel>💕 Совместимость знаков</SLabel>
        <Card>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 700 }}>Проверить совместимость</div>
            <div style={{ display: "flex", gap: 4 }}>
              <span style={{ fontSize: 9, color: "var(--text2)", alignSelf: "center" }}>
                {compatBasicInfo.used}/{compatBasicInfo.max}/нед
              </span>
              <Badge tier="free" />
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12 }}>
            <div style={{ flex: 1, background: "var(--bg3)", borderRadius: 11, padding: "10px 8px", textAlign: "center" }}>
              <div style={{ fontSize: 22 }}>{selectedSign.symbol}</div>
              <div style={{ fontSize: 11, fontWeight: 700 }}>{selectedSign.sign}</div>
              <div style={{ fontSize: 10, color: "var(--text2)" }}>Ты</div>
            </div>
            <div style={{ fontSize: 20, color: "var(--text2)" }}>💫</div>
            <select onChange={e => setCompatSign(ZODIAC_SIGNS.find(z => z.sign === e.target.value))} style={{ flex: 1, padding: "10px 8px", borderRadius: 11, background: "var(--bg3)", border: "1px solid var(--border)", color: "var(--text)", fontSize: 11, fontWeight: 700 }}>
              <option value="">Выбрать...</option>
              {ZODIAC_SIGNS.map(z => <option key={z.sign}>{z.sign}</option>)}
            </select>
          </div>

          {/* Кнопки проверки */}
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            <Btn variant="primary" size="sm" style={{ flex: 1 }} onClick={() => handleCompatCheck("basic")}>
              💕 Обычная
            </Btn>
            <Btn variant={canAccess("vip") ? "gold" : "ghost"} size="sm" style={{ flex: 1 }}
              onClick={() => handleCompatCheck("detailed")}>
              {canAccess("vip") ? "⭐ Детальная" : "🔒 Детальная"}
            </Btn>
          </div>


          {/* Результат совместимости */}
          {compatLoading && (
            <div style={{ textAlign: "center", padding: "18px 0", animation: "fadeInUp 0.3s ease" }}>
              <div style={{ fontSize: 22, marginBottom: 6 }}>🔮</div>
              <div style={{ fontSize: 12, color: "var(--text2)" }}>Звёзды читают ваши пути…</div>
            </div>
          )}

          {compatSign && !compatLoading && compatResult && (
            <div style={{ animation: "fadeInUp 0.3s ease" }}>
              {/* Заголовок + главный процент */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 700 }}>{selectedSign.sign} + {compatSign.sign}</span>
                <span style={{ fontSize: 18, fontWeight: 900, color: "var(--gold2)" }}>{compatResult.percent}%</span>
              </div>
              <div style={{ background: "var(--bg3)", borderRadius: 10, height: 7, overflow: "hidden", marginBottom: 12 }}>
                <div style={{ height: "100%", borderRadius: 10, background: "linear-gradient(90deg,#8b5cf6,#f59e0b)", width: `${compatResult.percent}%`, transition: "width 0.8s ease" }} />
              </div>

              {/* Под-показатели */}
              {(compatResult.love || compatResult.friendship || compatResult.communication) && (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 6, marginBottom: 12 }}>
                  {[
                    { label: "Любовь", icon: "💕", val: compatResult.love },
                    { label: "Дружба", icon: "🤝", val: compatResult.friendship },
                    { label: "Общение", icon: "💬", val: compatResult.communication },
                    ...(compatType === "detailed" && compatResult.passion ? [{ label: "Страсть", icon: "🔥", val: compatResult.passion }] : []),
                  ].filter(x => x.val != null).slice(0, compatType === "detailed" ? 4 : 3).map(({ label, icon, val }) => (
                    <div key={label} style={{ background: "var(--bg3)", borderRadius: 10, padding: "8px 6px", textAlign: "center" }}>
                      <div style={{ fontSize: 14, marginBottom: 2 }}>{icon}</div>
                      <div style={{ fontSize: 14, fontWeight: 900, color: "var(--gold2)", marginBottom: 1 }}>{val}%</div>
                      <div style={{ fontSize: 9, color: "var(--text2)" }}>{label}</div>
                      <div style={{ background: "var(--bg2)", borderRadius: 4, height: 3, overflow: "hidden", marginTop: 4 }}>
                        <div style={{ height: "100%", borderRadius: 4, background: "linear-gradient(90deg,#8b5cf6,#f59e0b)", width: `${val}%`, transition: "width 0.8s ease" }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Текст анализа */}
              <div style={{ fontSize: 12, color: "var(--text2)", background: "var(--bg3)", borderRadius: 9, padding: "10px 12px", lineHeight: 1.65 }}>
                {compatType === "detailed" && (
                  <div style={{ fontSize: 11, fontWeight: 700, color: "var(--accent)", marginBottom: 6 }}>⭐ Детальный анализ</div>
                )}
                {compatResult.description}
              </div>

              {/* Поделиться результатом */}
              <button onClick={handleShareCompat} style={{
                marginTop: 10, width: "100%", padding: "8px 12px", borderRadius: 10,
                background: "rgba(139,92,246,0.08)", border: "1px solid rgba(139,92,246,0.25)",
                color: "var(--accent)", fontSize: 12, fontWeight: 700, cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              }}>
                📤 Поделиться результатом с другом
              </button>
            </div>
          )}

          {/* Подсказка до первого запроса */}
          {compatSign && !compatLoading && !compatResult && (
            <div style={{ fontSize: 11, color: "var(--text2)", background: "var(--bg3)", borderRadius: 9, padding: "7px 10px", display: "flex", gap: 6 }}>
              <span>✨</span>
              <span>Нажми "Обычная" для краткого анализа или "Детальная" (VIP) для глубокого разбора с данными партнёра.</span>
            </div>
          )}

          {/* Лимиты */}
          <div style={{ marginTop: 10, display: "flex", gap: 6, flexWrap: "wrap" }}>
            <div style={{ fontSize: 9, color: "var(--text2)", background: "var(--bg3)", borderRadius: 6, padding: "2px 6px" }}>
              Обычная: {compatBasicInfo.used}/{compatBasicInfo.max}/нед
            </div>
            {canAccess("vip") && (
              <div style={{ fontSize: 9, color: "var(--gold2)", background: "rgba(245,158,11,0.08)", borderRadius: 6, padding: "2px 6px" }}>
                Детальная: {compatDetailedInfo.used}/{compatDetailedInfo.max}/нед
              </div>
            )}
          </div>

        </Card>

        {/* Планеты сегодня */}
        <SLabel>🪐 Планеты сегодня</SLabel>
        <Card>
          <div style={{ fontSize: 11, color: "var(--text2)", background: "var(--bg3)", borderRadius: 9, padding: "7px 10px", marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>✨ Нажми на планету для интерпретации</span>
            {canAccess("vip")
              ? <span style={{ fontSize: 9, color: "var(--gold2)", fontWeight: 700 }}>⭐ VIP — персональный</span>
              : <span style={{ fontSize: 9, color: "var(--text2)" }}>Общий прогноз</span>
            }
          </div>
          {planetsList.map(({ key, emoji, data }) => {
            const pos = key === "Луна" ? `${data.sign} (${data.phase})` : `${data.sign}${data.retrograde ? " ℞" : ""}`;
            return (
              <div key={key} onClick={() => setSelectedPlanet({ name: key, emoji, data, pos })}
                style={{ display: "flex", gap: 10, paddingBottom: 10, marginBottom: 10, borderBottom: "1px solid var(--border)", cursor: "pointer", transition: "all 0.15s" }}
                onMouseEnter={e => e.currentTarget.style.background = "rgba(139,92,246,0.05)"}
                onMouseLeave={e => e.currentTarget.style.background = "transparent"}
              >
                <div style={{ fontSize: 13, fontWeight: 700, minWidth: 90 }}>{emoji} {key}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, color: "var(--accent)", marginBottom: 2 }}>{pos}</div>
                  <div style={{ fontSize: 11, color: "var(--text2)" }}>{data.influence}</div>
                </div>
                <div style={{ fontSize: 12, color: "var(--text2)", alignSelf: "center" }}>→</div>
              </div>
            );
          })}
        </Card>

        {/* Мистический календарь */}
        <SLabel>📅 Мистический календарь 2026</SLabel>
        <Card>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <button onClick={() => setCalMonth(m => Math.max(1, m-1))} style={{ background: "var(--bg3)", border: "1px solid var(--border)", borderRadius: 8, padding: "5px 10px", color: "var(--text)", cursor: "pointer", fontSize: 14 }}>←</button>
            <span style={{ fontSize: 14, fontWeight: 700 }}>{monthNames[calMonth-1]} {calYear}</span>
            <button onClick={() => setCalMonth(m => Math.min(12, m+1))} style={{ background: "var(--bg3)", border: "1px solid var(--border)", borderRadius: 8, padding: "5px 10px", color: "var(--text)", cursor: "pointer", fontSize: 14 }}>→</button>
          </div>
          {monthEvents.length === 0 ? (
            <div style={{ textAlign: "center", padding: "20px 0", color: "var(--text2)", fontSize: 12 }}>Нет событий в этом месяце</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {monthEvents.map((ev, i) => {
                const d = new Date(ev.date);
                const colors = typeColors[ev.type] || typeColors.portal;
                const isToday = d.toDateString() === new Date().toDateString();
                const isPast = d < new Date() && !isToday;
                const isFuture = d > new Date() && !isToday;
                return (
                  <div key={i}
                    onClick={() => isToday ? setSelectedEvent(ev) : null}
                    style={{
                      background: colors.bg, border: `1px solid ${colors.border}`, borderRadius: 11, padding: "10px 12px",
                      display: "flex", gap: 10, transition: "all 0.15s",
                      cursor: isToday ? "pointer" : "default",
                      opacity: isPast ? 0.5 : 1,
                    }}
                    onMouseEnter={e => isToday && (e.currentTarget.style.transform = "translateY(-1px)")}
                    onMouseLeave={e => isToday && (e.currentTarget.style.transform = "translateY(0)")}
                  >
                    <div style={{ textAlign: "center", flexShrink: 0, minWidth: 30 }}>
                      <div style={{ fontSize: 17, fontWeight: 900, color: colors.color }}>{d.getDate()}</div>
                      <div style={{ fontSize: 9, color: "var(--text2)" }}>{["вс","пн","вт","ср","чт","пт","сб"][d.getDay()]}</div>
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: colors.color, marginBottom: 3 }}>
                        {ev.label}
                        {isToday && <span style={{ marginLeft: 6, fontSize: 9, background: "#4ade80", color: "#000", borderRadius: 5, padding: "1px 5px", fontWeight: 700 }}>сегодня</span>}
                        {isPast && <span style={{ marginLeft: 6, fontSize: 9, color: "var(--text2)" }}>прошло</span>}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--text2)" }}>🕯️ {ev.ritual}</div>
                    </div>
                    {isToday && <div style={{ fontSize: 12, color: "#4ade80", alignSelf: "center", fontWeight: 700 }}>→</div>}
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <div style={{ height: 8 }} />
      </div>

      {/* Модальное окно: Событие календаря (только сегодня — персональный прогноз) */}
      <Modal open={!!selectedEvent} onClose={() => setSelectedEvent(null)} title={selectedEvent?.label || ""}>
        {selectedEvent && (
          <div>
            <div style={{ fontSize: 10, color: "var(--text2)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>
              {typeNames[selectedEvent.type] || selectedEvent.type}
            </div>

            {/* Персональный прогноз — генерируется Claude */}
            <div style={{ background: "linear-gradient(135deg,rgba(139,92,246,0.08),rgba(245,158,11,0.05))", border: "1px solid rgba(139,92,246,0.2)", borderRadius: 14, padding: 14, marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--accent)", marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
                <span>🔮</span> Персональный прогноз для {user.sun_sign || "тебя"}
              </div>
              <div style={{ fontSize: 12, color: "var(--text2)", lineHeight: 1.7, whiteSpace: "pre-line" }}>
                {eventForecastLoading
                  ? <span style={{ opacity: 0.7 }}>✨ Составляю прогноз...</span>
                  : (eventForecast || <span style={{ opacity: 0.5 }}>Прогноз загружается...</span>)
                }
              </div>
            </div>

            <div style={{ background: "var(--bg3)", borderRadius: 12, padding: 12, marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--gold2)", marginBottom: 6 }}>
                🕯️ Персональный ритуал:
              </div>
              <div style={{ fontSize: 12, color: "var(--text2)", lineHeight: 1.6 }}>
                {getPersonalizedRitual(selectedEvent, user.sun_sign)}
              </div>
            </div>

            <div style={{ fontSize: 10, color: "var(--text2)", textAlign: "center", marginBottom: 10, fontStyle: "italic" }}>
              ✨ Прогноз составлен с учётом твоего знака, стихии и приоритетов
            </div>
            <Btn variant="ghost" onClick={() => setSelectedEvent(null)}>Закрыть</Btn>
          </div>
        )}
      </Modal>

      {/* Модальное окно: Планета */}
      <Modal open={!!selectedPlanet} onClose={() => setSelectedPlanet(null)} title={selectedPlanet ? `${selectedPlanet.emoji} ${selectedPlanet.name}` : ""}>
        {selectedPlanet && (
          <div>
            <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
              <div style={{ fontSize: 11, background: "rgba(139,92,246,0.1)", border: "1px solid rgba(139,92,246,0.25)", borderRadius: 8, padding: "4px 10px", color: "var(--accent)" }}>
                {selectedPlanet.pos}
              </div>
              {selectedPlanet.data.retrograde && (
                <div style={{ fontSize: 11, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)", borderRadius: 8, padding: "4px 10px", color: "#f87171" }}>
                  ℞ Ретроград
                </div>
              )}
              {canAccess("vip") && (
                <div style={{ fontSize: 11, background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.25)", borderRadius: 8, padding: "4px 10px", color: "var(--gold2)" }}>
                  ⭐ VIP
                </div>
              )}
            </div>
            <div style={{ fontSize: 13, color: "var(--text2)", lineHeight: 1.7, marginBottom: 14 }}>
              {planetDescriptions[selectedPlanet.name] || ""}
            </div>

            {/* Прогноз: VIP — персональный, free — общий */}
            <div style={{ background: canAccess("vip") ? "linear-gradient(135deg,rgba(139,92,246,0.08),rgba(245,158,11,0.05))" : "var(--bg3)", borderRadius: 12, padding: 12, marginBottom: 14, border: canAccess("vip") ? "1px solid rgba(245,158,11,0.2)" : "none" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: canAccess("vip") ? "var(--gold2)" : "var(--accent)", marginBottom: 6 }}>
                {canAccess("vip") ? "⭐ Персональный прогноз" : "🔮 Общий прогноз"} для {user.sun_sign || "тебя"}:
              </div>
              <div style={{ fontSize: 12, color: "var(--text2)", lineHeight: 1.7, whiteSpace: "pre-line" }}>
                {planetForecastLoading
                  ? <span style={{ opacity: 0.7 }}>✨ Составляю прогноз...</span>
                  : (planetForecast || <span style={{ opacity: 0.5 }}>Прогноз загружается...</span>)
                }
              </div>
            </div>

            {!canAccess("vip") && (
              <div style={{ fontSize: 11, color: "var(--text2)", textAlign: "center", marginBottom: 10, background: "rgba(245,158,11,0.06)", borderRadius: 9, padding: "6px 10px" }}>
                ⭐ <span style={{ color: "var(--gold2)", fontWeight: 700 }}>VIP тариф</span> — детальный персональный прогноз по каждой планете
              </div>
            )}
            <Btn variant="ghost" onClick={() => setSelectedPlanet(null)}>Закрыть</Btn>
          </div>
        )}
      </Modal>

      {/* Модальное окно: Реферальная ссылка */}
      <Modal open={showReferral} onClose={() => setShowReferral(false)} title="🎁 Пригласи друга">
        <div style={{ fontSize: 13, color: "var(--text2)", lineHeight: 1.6, marginBottom: 14 }}>
          Поделись ссылкой — и получи щедрый бонус, когда друг зарегистрируется:
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
          <div style={{ background: "linear-gradient(135deg,rgba(245,158,11,0.1),rgba(139,92,246,0.08))", border: "1px solid rgba(245,158,11,0.3)", borderRadius: 11, padding: "9px 12px", display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 22 }}>🥇</span>
            <div>
              <div style={{ fontSize: 12, fontWeight: 800, color: "#fbbf24", marginBottom: 2 }}>1-й друг — <b>+3 дня Премиум</b></div>
              <div style={{ fontSize: 10, color: "var(--text2)" }}>Полный доступ ко всем функциям приложения</div>
            </div>
          </div>
          <div style={{ background: "rgba(139,92,246,0.07)", border: "1px solid rgba(139,92,246,0.2)", borderRadius: 11, padding: "9px 12px", display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 22 }}>👥</span>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--accent)", marginBottom: 2 }}>2-й и далее — <b>+1 день Премиум</b></div>
              <div style={{ fontSize: 10, color: "var(--text2)" }}>+ 5 бесплатных проверок совместимости/день</div>
            </div>
          </div>
        </div>
        <div style={{ background: "var(--bg3)", borderRadius: 12, padding: 12, marginBottom: 14, textAlign: "center" }}>
          <div style={{ fontSize: 10, color: "var(--text2)", marginBottom: 6 }}>Твой реферальный код:</div>
          <div style={{ fontSize: 20, fontWeight: 900, color: "var(--accent)", letterSpacing: "0.12em", marginBottom: 10 }}>
            {getReferralCode()}
          </div>
          <div style={{ fontSize: 11, color: "var(--accent)", background: "rgba(139,92,246,0.1)", border: "1px solid rgba(139,92,246,0.2)", borderRadius: 8, padding: "7px 10px", marginBottom: 12, wordBreak: "break-all", fontFamily: "monospace" }}>
            https://t.me/mysticumbot?start={getReferralCode()}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Btn
              variant="primary" size="sm" style={{ flex: 1 }}
              onClick={() => {
                const link = `https://t.me/mysticumbot?start=${getReferralCode()}`;
                if (navigator.clipboard?.writeText) {
                  navigator.clipboard.writeText(link)
                    .then(() => showToast("🔗 Ссылка скопирована!"))
                    .catch(() => showToast("📋 Скопируй ссылку вручную"));
                } else {
                  showToast("📋 Скопируй ссылку вручную");
                }
              }}
            >
              📋 Скопировать
            </Btn>
            <Btn
              variant="ghost" size="sm" style={{ flex: 1 }}
              onClick={() => {
                const link = `https://t.me/mysticumbot?start=${getReferralCode()}`;
                const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent("🔮 Мистикум — персональный оракул! Таро, гороскопы, совместимость")}`;
                window.open(shareUrl, "_blank");
              }}
            >
              📤 Поделиться
            </Btn>
          </div>
        </div>
        {(user.referral_friends || []).length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6 }}>
              Приглашённые друзья ({(user.referral_friends || []).length}):
            </div>
            {(user.referral_friends || []).map((f, i) => (
              <div key={i} style={{ fontSize: 11, color: "var(--text2)", padding: "4px 0", display: "flex", gap: 6, alignItems: "center" }}>
                <span>{i === 0 ? "👑" : "👤"}</span>
                <span style={{ flex: 1 }}>{f.name} · {new Date(f.date).toLocaleDateString("ru-RU")}</span>
                {i === 0 && <span style={{ fontSize: 10, color: "#fbbf24", fontWeight: 700 }}>+3 дня Премиум</span>}
                {i > 0 && <span style={{ fontSize: 10, color: "var(--accent)", fontWeight: 700 }}>+1 день</span>}
              </div>
            ))}
          </div>
        )}
        <Btn variant="ghost" onClick={() => setShowReferral(false)}>Закрыть</Btn>
      </Modal>

      {/* Модальное окно: Данные партнёра для детального анализа */}
      <Modal open={showPartnerForm} onClose={() => setShowPartnerForm(false)} title="⭐ Данные партнёра">
        <div style={{ fontSize: 12, color: "var(--text2)", marginBottom: 14, lineHeight: 1.5 }}>
          Заполни данные партнёра для глубокого персонального анализа. Все поля необязательны — чем больше данных, тем точнее прогноз.
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
          {[
            { key: "name",      label: "Имя партнёра",       placeholder: "Например: Алекс",       type: "text"  },
            { key: "birthDate", label: "Дата рождения",       placeholder: "ДД.ММ.ГГГГ",            type: "date"  },
            { key: "birthTime", label: "Время рождения",      placeholder: "ЧЧ:ММ (если знаешь)",   type: "time"  },
            { key: "city",      label: "Город рождения",      placeholder: "Например: Москва",       type: "text"  },
            { key: "country",   label: "Страна рождения",     placeholder: "Например: Россия",       type: "text"  },
          ].map(({ key, label, placeholder, type }) => (
            <div key={key}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text2)", marginBottom: 4 }}>{label}</div>
              <input
                type={type}
                placeholder={placeholder}
                value={partnerData[key]}
                onChange={e => setPartnerData(pd => ({ ...pd, [key]: e.target.value }))}
                style={{
                  width: "100%", padding: "10px 12px", borderRadius: 11, fontSize: 13,
                  background: "var(--bg3)", border: "1px solid var(--border)", color: "var(--text)",
                  boxSizing: "border-box", outline: "none",
                }}
              />
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Btn variant="ghost" size="sm" style={{ flex: 1 }} onClick={() => setShowPartnerForm(false)}>Отмена</Btn>
          <Btn variant="gold" size="sm" style={{ flex: 2 }} onClick={handleDetailedSubmit}>
            🔮 Запустить анализ
          </Btn>
        </div>
      </Modal>
    </div>
  );
}

// =====================
// DIARY PAGE
// =====================
export function DiaryPage({ state, showToast }) {
  const { user, diary, addDiaryEntry, tarotHistory, canAccess,
          canAddDiaryEntry, getDiaryLimit, getDiaryUsedToday, getContextForClaude,
          addLuck, addDailyEnergy, updateOracleMemory,
          shopPurchases, useShopPurchase, unlockAchievement } = state;
  const [tab, setTab] = useState("diary");
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ mood: "😊", title: "", text: "", predicted_accurate: "" });

  const moods = ["😊","🙂","😐","😔","😤","🌙","✨"];

  const handleSave = () => {
    if (!form.text.trim()) return;
    if (!canAddDiaryEntry()) {
      const limit = getDiaryLimit();
      showToast(`⏳ Лимит записей: ${limit} в день`);
      return;
    }
    addDiaryEntry({ ...form });
    addDailyEnergy();
    setForm({ mood: "😊", title: "", text: "", predicted_accurate: "" });
    setShowAdd(false);
    showToast("📔 Записано! +3 💫");
  };

  const diaryUsed = getDiaryUsedToday();
  const diaryLimit = getDiaryLimit();

  return (
    <div>
      <AppHeader title="📔 Дневник судьбы" luckPoints={user.luck_points} streak={user.streak_days} />
      <div style={{ padding: "14px 14px 0", display: "flex", flexDirection: "column", gap: 14 }}>

        {/* Tabs */}
        <div style={{ display: "flex", background: "var(--bg3)", borderRadius: 14, padding: 3 }}>
          {[["diary","📔 Дневник"],["dreams","😴 Сонник"],["stats","📊 Статистика"]].map(([id, label]) => (
            <div key={id} onClick={() => setTab(id)} style={{
              flex: 1, textAlign: "center", padding: "8px 4px", borderRadius: 11, cursor: "pointer",
              background: tab === id ? "var(--accent)" : "transparent",
              color: tab === id ? "white" : "var(--text2)",
              fontSize: 11, fontWeight: tab === id ? 800 : 600, transition: "all 0.2s",
            }}>{label}</div>
          ))}
        </div>

        {/* ДНЕВНИК */}
        {tab === "diary" && (
          <>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <Btn onClick={() => setShowAdd(true)} style={{ flex: 1 }} disabled={!canAddDiaryEntry()}>
                {canAddDiaryEntry() ? "✍️ Добавить запись +3 💫" : "⏳ Лимит записей исчерпан"}
              </Btn>
            </div>
            <div style={{ fontSize: 10, color: "var(--text2)", textAlign: "center" }}>
              Записей сегодня: {diaryUsed}/{diaryLimit}
            </div>

            {showAdd && (
              <Card>
                <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>Новая запись</div>
                <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                  {moods.map(m => (
                    <div key={m} onClick={() => setForm(f => ({ ...f, mood: m }))} style={{
                      fontSize: 22, cursor: "pointer", padding: 4, borderRadius: 8,
                      background: form.mood === m ? "rgba(139,92,246,0.2)" : "transparent",
                      border: form.mood === m ? "1px solid rgba(139,92,246,0.5)" : "1px solid transparent",
                    }}>{m}</div>
                  ))}
                </div>
                <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Заголовок (необязательно)" style={{ width: "100%", padding: "9px 12px", borderRadius: 10, background: "var(--bg3)", border: "1px solid var(--border)", color: "var(--text)", fontSize: 13, marginBottom: 8, outline: "none", fontFamily: "inherit" }} />
                <textarea value={form.text} onChange={e => setForm(f => ({ ...f, text: e.target.value }))} placeholder="Что произошло сегодня? Что сбылось из прогноза?" style={{ width: "100%", minHeight: 80, padding: "9px 12px", borderRadius: 10, background: "var(--bg3)", border: "1px solid var(--border)", color: "var(--text)", fontSize: 13, resize: "none", outline: "none", fontFamily: "inherit", marginBottom: 8 }} />
                <div style={{ fontSize: 12, color: "var(--text2)", marginBottom: 8 }}>Прогноз сбылся?</div>
                <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                  {[["yes","✅ Да"],["partly","⚡ Частично"],["no","❌ Нет"]].map(([v, l]) => (
                    <div key={v} onClick={() => setForm(f => ({ ...f, predicted_accurate: v }))} style={{ flex: 1, textAlign: "center", padding: "7px 4px", borderRadius: 9, cursor: "pointer", fontSize: 11, fontWeight: 600, background: form.predicted_accurate === v ? "rgba(139,92,246,0.15)" : "var(--bg3)", border: `1px solid ${form.predicted_accurate === v ? "rgba(139,92,246,0.5)" : "var(--border)"}` }}>{l}</div>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <Btn variant="ghost" size="sm" style={{ flex: 1 }} onClick={() => setShowAdd(false)}>Отмена</Btn>
                  <Btn size="sm" style={{ flex: 2 }} onClick={handleSave} disabled={!form.text.trim()}>Сохранить</Btn>
                </div>
              </Card>
            )}

            {diary.length === 0 ? (
              <div style={{ textAlign: "center", padding: "40px 0", color: "var(--text2)" }}>
                <div style={{ fontSize: 48, marginBottom: 12 }}>📔</div>
                <div style={{ fontSize: 14, marginBottom: 4 }}>Дневник пуст</div>
                <div style={{ fontSize: 12 }}>Добавь первую запись и получи +3 💫</div>
              </div>
            ) : diary.map(entry => (
              <div key={entry.id} style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 13, padding: "12px 13px" }}>
                <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                  <div style={{ fontSize: 22, width: 36, height: 36, background: "rgba(139,92,246,0.1)", borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{entry.mood}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 2 }}>{entry.title || new Date(entry.date).toLocaleDateString("ru-RU")}</div>
                    <div style={{ fontSize: 12, color: "var(--text2)", lineHeight: 1.5 }}>{entry.text}</div>
                    <div style={{ fontSize: 10, color: "var(--text2)", marginTop: 5 }}>
                      {new Date(entry.date).toLocaleDateString("ru-RU")}
                      {entry.predicted_accurate === "yes" && " · ✅ Прогноз сбылся"}
                      {entry.predicted_accurate === "partly" && " · ⚡ Частично"}
                      {entry.predicted_accurate === "no" && " · ❌ Не сбылось"}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </>
        )}

        {/* СОННИК */}
        {tab === "dreams" && <DreamSearch canAccess={canAccess} showToast={showToast} user={user} getContextForClaude={getContextForClaude} addLuck={addLuck} addDailyEnergy={addDailyEnergy} updateOracleMemory={updateOracleMemory} shopPurchases={shopPurchases} useShopPurchase={useShopPurchase} unlockAchievement={unlockAchievement} />}

        {/* СТАТИСТИКА */}
        {tab === "stats" && <DiaryStats diary={diary} tarotHistory={tarotHistory} user={user} />}

        <div style={{ height: 8 }} />
      </div>
    </div>
  );
}

function DreamSearch({ canAccess, showToast, user, getContextForClaude, addLuck, addDailyEnergy, updateOracleMemory, shopPurchases, useShopPurchase, unlockAchievement }) {
  const [query, setQuery] = useState("");
  const [dreamText, setDreamText] = useState("");
  const [analysisResult, setAnalysisResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState("search"); // "search" | "analyze"
  const [showAll, setShowAll] = useState(false);

  const filtered = query
    ? DREAM_SYMBOLS.filter(d => d.symbol.toLowerCase().includes(query.toLowerCase()) || d.meaning.toLowerCase().includes(query.toLowerCase()))
    : DREAM_SYMBOLS;

  const displayedDreams = showAll ? filtered : filtered.slice(0, 12);

  const dreamPurchased = shopPurchases?.dream || 0;
  const canAnalyze = canAccess("premium") || dreamPurchased > 0;

  const handleAnalyze = async () => {
    if (!dreamText.trim()) return;
    // Списываем купленную попытку ДО запроса (атомарно)
    if (!canAccess("premium")) {
      const spent = useShopPurchase?.("dream");
      if (!spent) { showToast("🌙 Нужен Премиум или купи анализ в Магазине удачи"); return; }
    }
    setLoading(true);

    let resultText = null;
    try {
      const context = getContextForClaude ? getContextForClaude() : { sun_sign: user?.sun_sign };
      const result = await ClaudeAPI.analyzeDream({ dreamText, userContext: context });
      if (result?.summary) resultText = result.summary;
    } catch { /* fallback */ }

    if (!resultText) {
      resultText = `Твой сон несёт важное послание подсознания. Образы, возникшие в нём, отражают внутренние процессы и текущие жизненные ситуации.\n\nЭмоциональный фон сна говорит о периоде перемен и поиска. Подсознание преобразует переживания в символические картины.\n\nПослание: обрати внимание на то, что чувствовал во сне — эти эмоции отражают твоё истинное состояние.`;
    }

    setAnalysisResult({ text: resultText });
    // Сохраняем сон в память оракула (fire-and-forget)
    updateOracleMemory?.(prev => ({
      ...prev,
      dream_history: [
        { date: new Date().toISOString(), text: dreamText.slice(0, 300) },
        ...(prev.dream_history || []),
      ].slice(0, 10),
    }));
    setLoading(false);
    addLuck?.(2, "Анализ сна");
    addDailyEnergy?.();
    unlockAchievement?.("first_dream");
    showToast("🌙 +2 💫 Сон разгадан!");
  };

  return (
    <>
      {/* Переключатель: поиск / анализ */}
      <div style={{ display: "flex", background: "var(--bg3)", borderRadius: 12, padding: 3, marginBottom: 14 }}>
        {[["search", "🔍 Поиск символов"], ["analyze", "🔮 Анализ сна"]].map(([id, label]) => (
          <div key={id} onClick={() => setTab(id)} style={{
            flex: 1, textAlign: "center", padding: "8px 4px", borderRadius: 9, cursor: "pointer",
            background: tab === id ? "var(--accent)" : "transparent",
            color: tab === id ? "white" : "var(--text2)",
            fontSize: 12, fontWeight: tab === id ? 800 : 600, transition: "all 0.2s",
          }}>{label}</div>
        ))}
      </div>

      {/* ПОИСК СИМВОЛОВ */}
      {tab === "search" && (
        <>
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Поиск: вода, змея, полёт, дом, лестница..."
            style={{
              width: "100%", padding: "11px 14px", borderRadius: 12,
              background: "var(--bg3)", border: "1px solid var(--border)",
              color: "var(--text)", fontSize: 13, outline: "none",
              fontFamily: "inherit", marginBottom: 4,
            }}
            onFocus={e => e.target.style.borderColor = "rgba(139,92,246,0.5)"}
            onBlur={e => e.target.style.borderColor = "var(--border)"}
          />
          {query && filtered.length === 0 ? null : query ? (
            <div style={{ fontSize: 10, color: "var(--text2)", marginBottom: 8, textAlign: "center" }}>
              {filtered.length > 12 ? `Показано 12 из ${filtered.length}` : ""}
            </div>
          ) : null}
          {displayedDreams.map(d => (
            <div key={d.symbol} style={{
              background: "var(--card)", border: "1px solid var(--border)",
              borderRadius: 13, padding: "12px 13px", marginBottom: 8,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <span style={{ fontSize: 22 }}>{d.emoji}</span>
                <span style={{ fontSize: 13, fontWeight: 700 }}>{d.symbol}</span>
              </div>
              <div style={{ fontSize: 12, color: "var(--text2)", lineHeight: 1.6 }}>{d.meaning}</div>
            </div>
          ))}
          {!showAll && filtered.length > 12 && (
            <Btn variant="ghost" size="sm" onClick={() => setShowAll(true)}>
              Показать все ({filtered.length})
            </Btn>
          )}
          {filtered.length === 0 && (
            <div style={{ textAlign: "center", padding: "30px 0", color: "var(--text2)", fontSize: 13 }}>
              Символ не найден в базе.<br />
              <span style={{ fontSize: 12 }}>Используй анализ сна для уникальных образов ✨</span>
            </div>
          )}
        </>
      )}

      {/* ДЕТАЛЬНЫЙ АНАЛИЗ СНА (Премиум) */}
      {tab === "analyze" && (
        <div style={{ position: "relative" }}>
          <div style={{
            background: "var(--card)", border: "1px solid rgba(245,158,11,0.25)",
            borderRadius: 16, padding: 14, marginBottom: 12,
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 700 }}>👑 Глубокий анализ сна</div>
              <span style={{
                fontSize: 9, fontWeight: 700, color: "#fbbf24",
                background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.25)",
                borderRadius: 9, padding: "2px 7px", textTransform: "uppercase",
              }}>Премиум</span>
            </div>
            <div style={{ fontSize: 12, color: "var(--text2)", marginBottom: 12, lineHeight: 1.55 }}>
              Опиши свой сон подробно — мы выделим символы, расшифруем послание подсознания и дадим персональные рекомендации с учётом твоего знака зодиака
            </div>
            <textarea
              value={dreamText}
              onChange={e => setDreamText(e.target.value)}
              placeholder="Опиши свой сон как можно подробнее: что происходило, кто был рядом, какие чувства испытывал..."
              disabled={!canAccess("premium")}
              style={{
                width: "100%", minHeight: 100, padding: "10px 12px", borderRadius: 11,
                background: "var(--bg3)", border: "1px solid var(--border)",
                color: "var(--text)", fontSize: 12, resize: "none", outline: "none",
                fontFamily: "inherit", marginBottom: 10, lineHeight: 1.55,
                opacity: canAccess("premium") ? 1 : 0.5,
              }}
              onFocus={e => e.target.style.borderColor = "rgba(245,158,11,0.4)"}
              onBlur={e => e.target.style.borderColor = "var(--border)"}
            />

            {canAnalyze ? (
              <button
                onClick={handleAnalyze}
                disabled={loading || !dreamText.trim()}
                style={{
                  width: "100%", padding: "11px", border: "none", borderRadius: 12,
                  background: loading || !dreamText.trim()
                    ? "rgba(245,158,11,0.3)"
                    : "linear-gradient(135deg,#f59e0b,#d97706)",
                  color: "white", fontSize: 13, fontWeight: 700, cursor: loading || !dreamText.trim() ? "not-allowed" : "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                  transition: "all 0.2s",
                }}
              >
                {loading
                  ? <><span style={{ animation: "spin 1s linear infinite", display: "inline-block" }}>🔮</span> Расшифровываю...</>
                  : dreamPurchased > 0 && !canAccess("premium")
                    ? `🔮 Расшифровать сон (${dreamPurchased} куплено)`
                    : "🔮 Расшифровать сон"}
              </button>
            ) : (
              <button
                onClick={() => showToast("👑 Нужен Премиум или купи анализ в Магазине удачи (🌙 12 💫)")}
                style={{
                  width: "100%", padding: "11px", border: "none", borderRadius: 12,
                  background: "linear-gradient(135deg,#f59e0b,#d97706)",
                  color: "white", fontSize: 13, fontWeight: 700, cursor: "pointer",
                }}
              >
                👑 Открыть в Премиум или купить в Магазине
              </button>
            )}
          </div>

          {/* Результат анализа */}
          {analysisResult && (
            <div style={{ animation: "fadeInUp 0.4s ease" }}>
              {/* Детальный анализ */}
              <div style={{
                background: "var(--card)", border: "1px solid rgba(245,158,11,0.2)",
                borderRadius: 14, padding: 14,
              }}>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
                  <span>✨</span> Послание подсознания
                </div>
                <div style={{ fontSize: 13, color: "var(--text2)", lineHeight: 1.7 }}>
                  {analysisResult.text.split("\n\n").map((para, i) => (
                    <p key={i} style={{ marginBottom: i < analysisResult.text.split("\n\n").length - 1 ? 10 : 0 }}>{para}</p>
                  ))}
                </div>
              </div>

              <div style={{
                marginTop: 10, fontSize: 11, color: "var(--text2)", textAlign: "center",
                padding: "8px", background: "var(--bg3)", borderRadius: 10,
              }}>
                ✨ Интерпретация составлена с учётом символов и твоего знака ({user?.sun_sign || "Рыбы"})
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}

function DiaryStats({ diary, tarotHistory, user }) {
  const total = diary.length;
  const confirmed = diary.filter(d => d.predicted_accurate === "yes").length;
  const partly    = diary.filter(d => d.predicted_accurate === "partly").length;
  const accuracy  = total > 0 ? Math.round(((confirmed + partly * 0.5) / total) * 100) : 0;
  const mastery   = getMasteryLevel(tarotHistory?.length || user.total_readings || 0);
  const readings  = tarotHistory?.length || user.total_readings || 0;

  // Маппинг старых ID на красивые названия
  const getSpreadName = (spread) => {
    if (!spread) return "🔮 Неизвестный расклад";
    // Если уже красивое название — вернуть как есть
    if (spread.includes(" ")) return spread;
    // Маппинг ID на имена
    return SPREAD_NAMES[spread] || `🔮 ${spread}`;
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <Card>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>📊 Твоя статистика</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 10 }}>
          {[
            ["📔","Записей в дневнике", total],
            ["✅","Точность прогнозов", `${accuracy}%`],
            ["🔥","Серия дней",        `${user.streak_days || 0}д`],
            ["🔮","Всего гаданий",      readings],
          ].map(([e,l,v]) => (
            <div key={l} style={{ background: "var(--bg3)", borderRadius: 12, padding: "12px 10px", textAlign: "center" }}>
              <div style={{ fontSize: 24, marginBottom: 4 }}>{e}</div>
              <div style={{ fontSize: 18, fontWeight: 900, background: "linear-gradient(135deg,#8b5cf6,#f59e0b)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>{v}</div>
              <div style={{ fontSize: 10, color: "var(--text2)", marginTop: 2 }}>{l}</div>
            </div>
          ))}
        </div>
      </Card>

      {/* Уровень мастерства */}
      <Card>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>
          {mastery.emoji} {mastery.level}
        </div>
        {mastery.next && (
          <>
            <div style={{ background: "var(--bg3)", borderRadius: 20, height: 5, overflow: "hidden", marginBottom: 6 }}>
              <div style={{
                height: "100%", borderRadius: 20,
                background: "linear-gradient(90deg,#8b5cf6,#f59e0b)",
                width: `${Math.min(((readings - mastery.current) / (mastery.next - mastery.current)) * 100, 100)}%`,
                transition: "width 0.8s ease",
              }} />
            </div>
            <div style={{ fontSize: 11, color: "var(--text2)" }}>
              {readings} / {mastery.next} гаданий до следующего уровня
            </div>
          </>
        )}
      </Card>

      {/* История гаданий */}
      {tarotHistory?.length > 0 && (
        <Card>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>🃏 История гаданий</div>
          {tarotHistory.slice(0, 5).map(r => (
            <div key={r.id} style={{ paddingBottom: 10, marginBottom: 10, borderBottom: "1px solid var(--border)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <span style={{ fontSize: 12, fontWeight: 700 }}>{getSpreadName(r.spread || r.spreadId)}</span>
                <span style={{ fontSize: 10, color: "var(--text2)" }}>{new Date(r.date).toLocaleDateString("ru-RU")}</span>
              </div>
              {r.question && (
                <div style={{ fontSize: 11, color: "var(--accent)", marginBottom: 4, fontStyle: "italic" }}>«{r.question}»</div>
              )}
              <div style={{ fontSize: 11, color: "var(--text2)" }}>
                {r.cards?.slice(0, 3).map(c => `${c.name}${c.reversed ? "↕" : ""}`).join(" · ")}
                {r.cards?.length > 3 && ` + ещё ${r.cards.length - 3}`}
              </div>
            </div>
          ))}
        </Card>
      )}

      {total > 0 && (
        <Card>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>🎯 Точность прогнозов</div>
          {[
            ["✅ Сбылись",    confirmed, "#4ade80", "rgba(34,197,94,0.08)",  "rgba(34,197,94,0.2)"],
            ["⚡ Частично",   partly,    "var(--gold2)", "rgba(245,158,11,0.08)", "rgba(245,158,11,0.2)"],
            ["❌ Не сбылись", total - confirmed - partly, "#f87171", "rgba(239,68,68,0.08)", "rgba(239,68,68,0.2)"],
          ].map(([label, count, color, bg, border]) => (
            <div key={label} style={{ background: bg, border: `1px solid ${border}`, borderRadius: 10, padding: "10px 12px", marginBottom: 8, display: "flex", justifyContent: "space-between" }}>
              <span style={{ fontSize: 12 }}>{label}</span>
              <span style={{ fontSize: 12, fontWeight: 700, color }}>{count}</span>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

// =====================
// PROFILE PAGE
// =====================
export function Profile({ state, showToast }) {
  const { user, updateUser, canAccess, setCurrentPage, spendLuck, tarotHistory, claimLevelReward,
          activatePromoCode, isAdmin, createCustomPromo, getCustomPromos, deleteCustomPromo,
          shopPurchases, addShopPurchase } = state;
  const mastery = getMasteryLevel(user.total_readings || 0);
  const sign = ZODIAC_SIGNS.find(z => z.sign === user.sun_sign) || ZODIAC_SIGNS[11];
  const totalReadings = tarotHistory?.length || user.total_readings || 0;
  const [showLevelModal, setShowLevelModal] = useState(false);
  const [showPromoModal, setShowPromoModal] = useState(false);
  const [showCollectionModal, setShowCollectionModal] = useState(false);
  const [showAchievementsModal, setShowAchievementsModal] = useState(false);

  // Модалка: уточнить время рождения для расчёта Асцендента
  const [showBirthTimeModal, setShowBirthTimeModal] = useState(false);
  const [birthTimeInput, setBirthTimeInput] = useState(user.birth_time || "");
  const [birthTimeLoading, setBirthTimeLoading] = useState(false);

  const handleSaveBirthTime = async () => {
    if (!birthTimeInput || birthTimeLoading) return;
    setBirthTimeLoading(true);
    try {
      const result = await ClaudeAPI.calculateNatalSigns({
        birthDate: user.birth_date,
        birthTime: birthTimeInput,
        birthPlace: user.birth_place || null,
        sunSign: user.sun_sign,
      });
      if (result) {
        updateUser({ ...result, birth_time: birthTimeInput });
        showToast("⬆️ Асцендент рассчитан: " + (result.ascendant || "не определено"));
      } else {
        showToast("⚠️ Не удалось рассчитать. Попробуй ещё раз.");
      }
    } catch {
      showToast("⚠️ Ошибка расчёта. Попробуй позже.");
    } finally {
      setBirthTimeLoading(false);
      setShowBirthTimeModal(false);
    }
  };
  // Магазин удачи (трата очков) — открывается кликом по 💫 в хедере
  const [showLuckShopModal, setShowLuckShopModal] = useState(false);
  // Покупка очков удачи — открывается кликом на + рядом с балансом
  const [showBuyLuckModal, setShowBuyLuckModal] = useState(false);
  // Магазин тарифов — открывается кликом на + рядом с планом
  const [showPlanModal, setShowPlanModal] = useState(false);

  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [promoCode, setPromoCode] = useState("");
  const [promoResult, setPromoResult] = useState(null);

  // Админ: создание промокода
  const [newPromo, setNewPromo] = useState({ code: "", tier: "vip", duration: 30, maxUses: 1 });
  const [adminMsg, setAdminMsg] = useState(null);

  // Админ: статистика пользователей
  const [userStats, setUserStats] = useState(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const statsLoadingRef = useRef(false); // синхронный guard против двойных кликов

  const loadUserStats = () => {
    if (statsLoadingRef.current) return;
    statsLoadingRef.current = true;
    setStatsLoading(true);
    import("../api/backend").then(({ fetchUserStats }) =>
      fetchUserStats().then(data => {
        setUserStats(data);
        setStatsLoading(false);
        statsLoadingRef.current = false;
      }).catch(() => { setStatsLoading(false); statsLoadingRef.current = false; })
    ).catch(() => { setStatsLoading(false); statsLoadingRef.current = false; });
  };
  const [customPromosList, setCustomPromosList] = useState([]);
  const [promosLoading, setPromosLoading] = useState(false);
  const [promoActivating, setPromoActivating] = useState(false);
  const [promoCreating, setPromoCreating] = useState(false);

  // Оплата через ЮKassa
  const [paymentLoading, setPaymentLoading] = useState(null);

  const handleSubscribe = async (tier) => {
    if (paymentLoading) return;
    setPaymentLoading(tier);
    const result = await openSubscriptionPayment(tier);
    setPaymentLoading(null);
    if (!result.success) {
      showToast(result.error || "Не удалось открыть страницу оплаты");
    } else {
      showToast("Открываем ЮKassa. После оплаты подписка активируется автоматически.");
    }
  };

  const handleLuckPurchase = async (packageId) => {
    if (paymentLoading) return;
    setPaymentLoading(packageId);
    const result = await openLuckPayment(packageId);
    setPaymentLoading(null);
    if (!result.success) {
      showToast(result.error || "Не удалось открыть страницу оплаты");
    } else {
      showToast("Открываем ЮKassa. После оплаты звёзды начислятся автоматически.");
    }
  };

  const refreshPromos = async () => {
    setPromosLoading(true);
    try {
      const promos = await getCustomPromos();
      setCustomPromosList(Array.isArray(promos) ? promos : []);
    } catch {
      setCustomPromosList([]);
    } finally {
      setPromosLoading(false);
    }
  };

  // Загружаем промокоды при монтировании (если админ)
  useEffect(() => {
    if (isAdmin()) refreshPromos();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handlePromoActivate = async () => {
    if (!promoCode.trim() || promoActivating) return;
    setPromoActivating(true);
    const result = await activatePromoCode(promoCode);
    setPromoActivating(false);
    setPromoResult(result);
    if (result.success) {
      setPromoCode("");
      const tierName = result.admin ? "Полный доступ (Админ)" : result.tier === "premium" ? "Премиум" : "VIP";
      const daysWord = result.duration === 1 ? "день" : result.duration >= 2 && result.duration <= 4 ? "дня" : "дней";
      showToast(`🎉 Промокод активирован! ${tierName} на ${result.admin ? "неограниченный срок" : `${result.duration} ${daysWord}`}`);
    }
  };

  const handleCreatePromo = async () => {
    if (promoCreating) return;
    setPromoCreating(true);
    const result = await createCustomPromo(newPromo.code, newPromo.tier, newPromo.duration, newPromo.maxUses);
    setPromoCreating(false);
    if (result.success) {
      setAdminMsg({ type: "ok", text: `Промокод ${newPromo.code.toUpperCase()} создан!` });
      setNewPromo({ code: "", tier: "vip", duration: 30, maxUses: 1 });
      await refreshPromos();
    } else {
      setAdminMsg({ type: "err", text: result.error });
    }
    setTimeout(() => setAdminMsg(null), 3000);
  };

  const handleDeletePromo = async (code) => {
    await deleteCustomPromo(code);
    await refreshPromos();
    showToast(`🗑️ Промокод ${code} удалён`);
  };

  const tiers = [
    {
      id: "vip", name: "⭐ VIP", price: "249₽/мес",
      color: "var(--accent)", borderColor: "rgba(139,92,246,0.3)",
      features: ["Персональный гороскоп на день", "Расклад на 3 карты · Расклад Отношения (5 карт)", "Совместимость знаков (детальный анализ)", "Лунный календарь с рекомендациями", "✨ Аура — определение цвета", "ᚠ Руны — гадание (1 руна)", "2× очки удачи за действия"]
    },
    {
      id: "premium", name: "👑 Премиум", price: "499₽/мес",
      color: "var(--gold2)", borderColor: "rgba(245,158,11,0.28)",
      features: ["Всё из VIP", "Натальная карта (1 раз в неделю)", "🖐 Хиромантия по фото руки", "📸 Аура по фото + анализ чакр", "🌙 Расшифровка снов от оракула", "🔮 Персональный оракул (чат)", "Все расклады Таро (Кельтский крест, Звезда, Подкова)", "Руны: все расклады (1 и 3 руны)"]
    },
  ];

  const handleClaimLevel = (level) => {
    const ok = claimLevelReward(level.level, level.reward);
    if (ok) {
      showToast(`🎉 +${level.reward} 💫 за достижение «${level.level}»!`);
    }
  };

  return (
    <div>
      <AppHeader
        title="👤 Профиль"
        luckPoints={user.luck_points}
        streak={user.streak_days}
        userTier={canAccess("premium") ? "premium" : canAccess("vip") ? "vip" : "free"}
        onLuckClick={() => setShowLuckShopModal(true)}
        onLuckAddClick={() => setShowBuyLuckModal(true)}
        onPlanClick={() => setShowPlanModal(true)}
      />
      <div style={{ padding: "14px 14px 0", display: "flex", flexDirection: "column", gap: 14 }}>

        {/* Profile header */}
        <div style={{ textAlign: "center", padding: "8px 0 4px" }}>
          <div style={{ width: 66, height: 66, borderRadius: "50%", background: "linear-gradient(135deg,#8b5cf6,#f59e0b)", margin: "0 auto 10px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, boxShadow: "0 0 20px rgba(139,92,246,0.45)" }}>
            {sign.symbol}
          </div>
          <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 3 }}>{user.name}</div>
          <div style={{ fontSize: 12, color: "var(--text2)", marginBottom: 6 }}>{sign.sign} · {user.birth_place}</div>
          <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap", marginBottom: 10 }}>
            <span style={{ fontSize: 11, color: "var(--text2)" }}>☀️ {user.sun_sign}</span>
            <span style={{ fontSize: 11, color: "var(--text2)" }}>· 🌙 {user.moon_sign || "не определено"}</span>
            <span
              onClick={!user.ascendant ? () => setShowBirthTimeModal(true) : undefined}
              style={{
                fontSize: 11,
                color: user.ascendant ? "var(--text2)" : "var(--accent)",
                opacity: user.ascendant ? 1 : 0.85,
                cursor: user.ascendant ? "default" : "pointer",
                textDecoration: user.ascendant ? "none" : "underline dotted",
              }}
            >· ⬆️ {user.ascendant || (user.birth_time ? "вычисляется…" : "указать время →")}</span>
          </div>

          {/* Модалка: ввод времени рождения для Асцендента */}
          <Modal open={showBirthTimeModal} onClose={() => setShowBirthTimeModal(false)} title="⬆️ Время рождения">
            <div style={{ fontSize: 13, color: "var(--text2)", marginBottom: 16, lineHeight: 1.6 }}>
              Асцендент рассчитывается по точному времени рождения. Введи его — и звёзды откроют твой восходящий знак.
            </div>
            <input
              type="time"
              value={birthTimeInput}
              onChange={e => setBirthTimeInput(e.target.value)}
              style={{
                width: "100%", padding: "11px 14px", borderRadius: 12,
                background: "var(--bg3)", border: "1px solid var(--border)",
                color: "var(--text)", fontSize: 16, outline: "none",
                marginBottom: 14, boxSizing: "border-box",
              }}
            />
            <Btn
              variant="primary"
              size="md"
              onClick={handleSaveBirthTime}
              disabled={!birthTimeInput || birthTimeLoading}
              style={{ width: "100%" }}
            >
              {birthTimeLoading ? "Вычисляю…" : "Рассчитать Асцендент"}
            </Btn>
          </Modal>
          <div onClick={() => setShowLevelModal(true)} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: canAccess("premium") ? "rgba(245,158,11,0.12)" : "rgba(139,92,246,0.12)", border: `1px solid ${canAccess("premium") ? "rgba(245,158,11,0.25)" : "rgba(139,92,246,0.25)"}`, borderRadius: 18, padding: "5px 14px", cursor: "pointer" }}>
            <span style={{ fontSize: 14 }}>{mastery.emoji}</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: canAccess("premium") ? "var(--gold2)" : "var(--accent)" }}>
              {mastery.level} · {canAccess("premium") ? "Премиум" : canAccess("vip") ? "VIP" : "Бесплатный"}
            </span>
            <span style={{ fontSize: 10, color: "var(--text2)" }}>→</span>
          </div>
        </div>

        {/* Stats */}
        <Card>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8, marginBottom: 12 }}>
            {[
              [user.luck_points || 0, "💫", "Удача"],
              [user.streak_days || 0, "🔥", "Серия"],
              [totalReadings, "🔮", "Гаданий"],
              [mastery.emoji, "", "Уровень"],
            ].map(([v, e, l], idx) => (
              <div key={l} style={{ textAlign: "center", cursor: idx === 3 ? "pointer" : "default" }} onClick={() => idx === 3 && setShowLevelModal(true)}>
                <div style={{ fontSize: 18, fontWeight: 900, background: "linear-gradient(135deg,#8b5cf6,#f59e0b)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>{e}{v}</div>
                <div style={{ fontSize: 9, color: "var(--text2)", marginTop: 2 }}>{l}</div>
              </div>
            ))}
          </div>
          {/* Коллекция карт и достижения */}
          <div style={{ display: "flex", gap: 8 }}>
            <div onClick={() => setShowCollectionModal(true)} style={{
              flex: 1, background: "var(--bg3)", borderRadius: 10, padding: "9px 12px", cursor: "pointer",
              border: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 8,
            }}>
              <span style={{ fontSize: 20 }}>🃏</span>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700 }}>Коллекция</div>
                <div style={{ fontSize: 10, color: "var(--text2)" }}>
                  {(user.card_collection || []).length}/{ALL_CARDS.length} карт
                </div>
                <div style={{ background: "var(--border)", borderRadius: 10, height: 3, marginTop: 3, overflow: "hidden" }}>
                  <div style={{ height: "100%", background: "linear-gradient(90deg,#8b5cf6,#f59e0b)", borderRadius: 10,
                    width: `${Math.min(((user.card_collection || []).length / ALL_CARDS.length) * 100, 100)}%` }} />
                </div>
              </div>
            </div>
            <div onClick={() => setShowAchievementsModal(true)} style={{
              flex: 1, background: "var(--bg3)", borderRadius: 10, padding: "9px 12px", cursor: "pointer",
              border: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 8,
            }}>
              <span style={{ fontSize: 20 }}>🏅</span>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700 }}>Достижения</div>
                <div style={{ fontSize: 10, color: "var(--text2)" }}>
                  {(user.unlocked_achievements || []).length}/{ACHIEVEMENTS_LIST.length}
                </div>
              </div>
            </div>
          </div>
          {/* Опросники — раскрывают характер для Оракула */}
          <div onClick={() => setCurrentPage("quizzes")} style={{
            background: "rgba(139,92,246,0.06)", border: "1px solid rgba(139,92,246,0.2)",
            borderRadius: 10, padding: "9px 12px", cursor: "pointer",
            display: "flex", alignItems: "center", gap: 10,
          }}>
            <span style={{ fontSize: 22 }}>🧬</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 700 }}>Раскрой себя</div>
              <div style={{ fontSize: 10, color: "var(--text2)" }}>
                {(user.completed_quizzes || []).length}/7 пройдено · Оракул узнаёт тебя глубже
              </div>
              <div style={{ background: "var(--border)", borderRadius: 10, height: 3, marginTop: 3, overflow: "hidden" }}>
                <div style={{ height: "100%", borderRadius: 10,
                  background: "linear-gradient(90deg,#8b5cf6,#ec4899)",
                  width: `${Math.min(((user.completed_quizzes || []).length / 7) * 100, 100)}%` }} />
              </div>
            </div>
            <div style={{ fontSize: 14, color: "var(--text2)" }}>→</div>
          </div>
        </Card>

        {/* Subscription */}
        <SLabel>💎 Тарифы</SLabel>

        {/* Активная подписка — компактный блок */}
        {(canAccess("vip") || canAccess("premium")) && (() => {
          const activeTier = canAccess("premium") ? tiers[1] : tiers[0];
          const until = user.subscription_until ? new Date(user.subscription_until) : null;
          const daysLeft = until ? Math.max(0, Math.ceil((until - new Date()) / 86400000)) : null;
          return (
            <div style={{
              background: activeTier.id === "premium" ? "linear-gradient(135deg,#1a0a2e,#0a1628)" : "var(--card)",
              border: `1px solid ${activeTier.borderColor}`,
              borderRadius: 18, padding: 16, position: "relative", overflow: "hidden",
            }}>
              {activeTier.id === "premium" && <div style={{ position: "absolute", right: -8, top: -8, fontSize: 60, opacity: 0.08 }}>👑</div>}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <div style={{ fontSize: 16, fontWeight: 800, color: activeTier.color }}>{activeTier.name}</div>
                <span style={{ fontSize: 10, background: "rgba(34,197,94,0.15)", color: "#4ade80", border: "1px solid rgba(34,197,94,0.3)", padding: "2px 8px", borderRadius: 10, fontWeight: 700 }}>АКТИВНА</span>
              </div>
              {daysLeft !== null && (
                <div style={{ fontSize: 11, color: daysLeft <= 5 ? "#f87171" : "var(--text2)", marginBottom: 10 }}>
                  {daysLeft > 0 ? `Осталось: ${daysLeft} ${pluralizeDays(daysLeft)}` : "Подписка истекла"}
                </div>
              )}
              <Btn variant={activeTier.id === "premium" ? "gold" : "primary"} size="sm"
                disabled={!!paymentLoading}
                onClick={() => handleSubscribe(activeTier.id)}>
                {paymentLoading === activeTier.id ? "Открываем…" : "🔄 Продлить"}
              </Btn>
            </div>
          );
        })()}

        {/* Промо VIP — только для бесплатных */}
        {!canAccess("vip") && (() => {
          const t = tiers[0];
          return (
            <div key={t.id} style={{ background: "var(--card)", border: `1px solid ${t.borderColor}`, borderRadius: 18, padding: 16, position: "relative", overflow: "hidden" }}>
              <div style={{ fontSize: 16, fontWeight: 800, color: t.color, marginBottom: 8 }}>{t.name}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 12 }}>
                {t.features.map(f => (
                  <div key={f} style={{ fontSize: 11, color: "var(--text2)", display: "flex", alignItems: "center", gap: 5 }}>
                    <span style={{ color: "var(--accent)", fontSize: 9 }}>✦</span>{f}
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginBottom: 12 }}>
                <span style={{ fontSize: 24, fontWeight: 900, color: t.color }}>{t.price.split("/")[0]}</span>
                <span style={{ fontSize: 12, color: "var(--text2)" }}>/{t.price.split("/")[1]}</span>
              </div>
              <Btn variant="primary" size="sm"
                disabled={!!paymentLoading}
                onClick={() => handleSubscribe("vip")}>
                {paymentLoading === "vip" ? "Открываем…" : "Подключить VIP"}
              </Btn>
            </div>
          );
        })()}

        {/* Промо Премиум — для бесплатных и VIP */}
        {!canAccess("premium") && (() => {
          const t = tiers[1];
          return (
            <div key={t.id} style={{ background: "linear-gradient(135deg,#1a0a2e,#0a1628)", border: `1px solid ${t.borderColor}`, borderRadius: 18, padding: 16, position: "relative", overflow: "hidden" }}>
              <div style={{ position: "absolute", right: -8, top: -8, fontSize: 60, opacity: 0.08 }}>👑</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: t.color, marginBottom: 8 }}>{t.name}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 12 }}>
                {t.features.map(f => (
                  <div key={f} style={{ fontSize: 11, color: "var(--text2)", display: "flex", alignItems: "center", gap: 5 }}>
                    <span style={{ color: "var(--gold)", fontSize: 9 }}>✦</span>{f}
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginBottom: 12 }}>
                <span style={{ fontSize: 24, fontWeight: 900, color: t.color }}>{t.price.split("/")[0]}</span>
                <span style={{ fontSize: 12, color: "var(--text2)" }}>/{t.price.split("/")[1]}</span>
              </div>
              <Btn variant="gold" size="sm"
                disabled={!!paymentLoading}
                onClick={() => handleSubscribe("premium")}>
                {paymentLoading === "premium" ? "Открываем…" : "Подключить Премиум"}
              </Btn>
            </div>
          );
        })()}

        {/* Luck shop shortcut — теперь открывается кликом на 💫 в хедере */}
        <div
          onClick={() => setShowLuckShopModal(true)}
          style={{
            background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.2)",
            borderRadius: 14, padding: "12px 16px", cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 24 }}>💫</span>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--gold2)" }}>Магазин удачи</div>
              <div style={{ fontSize: 11, color: "var(--text2)" }}>У тебя: <b style={{ color: "var(--gold2)" }}>{user.luck_points} 💫</b> — нажми для трат</div>
            </div>
          </div>
          <div style={{ fontSize: 14, color: "var(--text2)" }}>→</div>
        </div>

        {/* Промокод */}
        <SLabel>🎁 Промокод</SLabel>
        <Card>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 2 }}>🎁 У тебя есть промокод?</div>
              <div style={{ fontSize: 11, color: "var(--text2)" }}>Активируй VIP или Премиум подписку</div>
            </div>
            <button onClick={() => setShowPromoModal(true)} style={{
              padding: "8px 16px", borderRadius: 10, fontSize: 12, fontWeight: 700,
              background: "linear-gradient(135deg,#8b5cf6,#6d28d9)", color: "white",
              border: "none", cursor: "pointer",
            }}>Ввести</button>
          </div>
        </Card>

        {/* Админ-панель промокодов (только для админа) */}
        {isAdmin() && (
          <>
            <SLabel>🛡️ Админ-панель</SLabel>
            <Card style={{ border: "1px solid rgba(239,68,68,0.25)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#f87171" }}>🛡️ Управление промокодами</div>
                <button onClick={() => { const next = !showAdminPanel; setShowAdminPanel(next); if (next) { refreshPromos(); loadUserStats(); } }} style={{
                  fontSize: 10, fontWeight: 700, padding: "4px 10px", borderRadius: 8,
                  background: showAdminPanel ? "rgba(239,68,68,0.12)" : "rgba(139,92,246,0.1)",
                  color: showAdminPanel ? "#f87171" : "var(--accent)",
                  border: `1px solid ${showAdminPanel ? "rgba(239,68,68,0.3)" : "rgba(139,92,246,0.25)"}`,
                  cursor: "pointer",
                }}>{showAdminPanel ? "Свернуть" : "Открыть"}</button>
              </div>

              {showAdminPanel && (
                <div>
                  {/* Статистика пользователей */}
                  <div style={{ background: "var(--bg3)", borderRadius: 12, padding: 12, marginBottom: 12 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text)" }}>📊 Пользователи</div>
                      <button onClick={loadUserStats} disabled={statsLoading} style={{
                        fontSize: 9, padding: "3px 8px", borderRadius: 6, cursor: "pointer",
                        background: "rgba(139,92,246,0.1)", color: "var(--accent)",
                        border: "1px solid rgba(139,92,246,0.25)",
                      }}>{statsLoading ? "⏳" : "🔄 Обновить"}</button>
                    </div>
                    {!userStats && !statsLoading && (
                      <div style={{ fontSize: 11, color: "var(--text2)", textAlign: "center", padding: "8px 0" }}>
                        Нажми "Обновить" для загрузки
                      </div>
                    )}
                    {statsLoading && (
                      <div style={{ fontSize: 11, color: "var(--text2)", textAlign: "center", padding: "8px 0" }}>
                        Загрузка…
                      </div>
                    )}
                    {userStats?.__error === 403 && !statsLoading && (
                      <div style={{ fontSize: 11, color: "#f87171", textAlign: "center", padding: "8px 0" }}>
                        ⛔ Нет доступа — добавьте ваш Telegram ID в ADMIN_TELEGRAM_IDS на Vercel
                      </div>
                    )}
                    {userStats && !userStats.__error && !statsLoading && (
                      <>
                        {/* Итого / онлайн */}
                        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                          <div style={{ flex: 1, background: "var(--bg2)", borderRadius: 9, padding: "8px 10px", textAlign: "center" }}>
                            <div style={{ fontSize: 18, fontWeight: 900, color: "var(--accent)" }}>{userStats.total}</div>
                            <div style={{ fontSize: 9, color: "var(--text2)", marginTop: 1 }}>всего</div>
                          </div>
                          <div style={{ flex: 1, background: "rgba(34,197,94,0.07)", borderRadius: 9, padding: "8px 10px", textAlign: "center", border: "1px solid rgba(34,197,94,0.2)" }}>
                            <div style={{ fontSize: 18, fontWeight: 900, color: "#4ade80" }}>{userStats.online}</div>
                            <div style={{ fontSize: 9, color: "var(--text2)", marginTop: 1 }}>онлайн (5 мин)</div>
                          </div>
                        </div>
                        {/* Разбивка по тарифам */}
                        {[
                          { key: "free",    label: "Базовые",  color: "var(--text2)", bg: "var(--bg2)" },
                          { key: "vip",     label: "VIP",      color: "var(--accent)", bg: "rgba(139,92,246,0.08)" },
                          { key: "premium", label: "Премиум",  color: "var(--gold2)",  bg: "rgba(245,158,11,0.08)" },
                        ].map(({ key, label, color, bg }) => (
                          <div key={key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: bg, borderRadius: 8, padding: "6px 10px", marginBottom: 5 }}>
                            <div style={{ fontSize: 11, fontWeight: 700, color }}>{label}</div>
                            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                              <span style={{ fontSize: 13, fontWeight: 900, color }}>{userStats[key]}</span>
                              <span style={{ fontSize: 9, color: "var(--text2)" }}>/</span>
                              <span style={{ fontSize: 11, color: "#4ade80", fontWeight: 700 }}>{userStats[`online_${key}`]} онлайн</span>
                            </div>
                          </div>
                        ))}
                      </>
                    )}
                  </div>

                  {/* Создание нового промокода */}
                  <div style={{ background: "var(--bg3)", borderRadius: 12, padding: 12, marginBottom: 12 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 8, color: "var(--text)" }}>
                      Создать промокод
                    </div>
                    <input
                      value={newPromo.code}
                      onChange={e => setNewPromo(p => ({ ...p, code: e.target.value }))}
                      placeholder="Код, напр. VIP-17022026"
                      style={{
                        width: "100%", padding: "9px 12px", borderRadius: 10,
                        background: "var(--bg)", border: "1px solid var(--border)",
                        color: "var(--text)", fontSize: 13, fontWeight: 700,
                        fontFamily: "monospace", outline: "none", marginBottom: 8,
                        textTransform: "uppercase", letterSpacing: "0.05em",
                      }}
                    />
                    <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                      {/* Тариф */}
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 10, color: "var(--text2)", marginBottom: 4 }}>Тариф</div>
                        <select
                          value={newPromo.tier}
                          onChange={e => setNewPromo(p => ({ ...p, tier: e.target.value }))}
                          style={{
                            width: "100%", padding: "7px 8px", borderRadius: 8,
                            background: "var(--bg)", border: "1px solid var(--border)",
                            color: "var(--text)", fontSize: 12,
                          }}
                        >
                          <option value="vip">VIP</option>
                          <option value="premium">Премиум</option>
                        </select>
                      </div>
                      {/* Длительность */}
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 10, color: "var(--text2)", marginBottom: 4 }}>Дней</div>
                        <input
                          type="number" min="1" max="365"
                          value={newPromo.duration}
                          onChange={e => setNewPromo(p => ({ ...p, duration: parseInt(e.target.value) || 30 }))}
                          style={{
                            width: "100%", padding: "7px 8px", borderRadius: 8,
                            background: "var(--bg)", border: "1px solid var(--border)",
                            color: "var(--text)", fontSize: 12,
                          }}
                        />
                      </div>
                      {/* Макс. активаций */}
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 10, color: "var(--text2)", marginBottom: 4 }}>Активаций</div>
                        <input
                          type="number" min="1" max="9999"
                          value={newPromo.maxUses}
                          onChange={e => setNewPromo(p => ({ ...p, maxUses: parseInt(e.target.value) || 1 }))}
                          style={{
                            width: "100%", padding: "7px 8px", borderRadius: 8,
                            background: "var(--bg)", border: "1px solid var(--border)",
                            color: "var(--text)", fontSize: 12,
                          }}
                        />
                      </div>
                    </div>

                    {adminMsg && (
                      <div style={{
                        fontSize: 11, textAlign: "center", marginBottom: 8, padding: "5px 8px", borderRadius: 8,
                        color: adminMsg.type === "ok" ? "#4ade80" : "#f87171",
                        background: adminMsg.type === "ok" ? "rgba(34,197,94,0.08)" : "rgba(239,68,68,0.08)",
                      }}>
                        {adminMsg.type === "ok" ? "✅" : "❌"} {adminMsg.text}
                      </div>
                    )}

                    <Btn size="sm" onClick={handleCreatePromo} disabled={!newPromo.code.trim() || promoCreating}>
                      {promoCreating ? "Создаём…" : "Создать промокод"}
                    </Btn>
                  </div>

                  {/* Список существующих промокодов */}
                  <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 8, color: "var(--text)" }}>
                    Мои промокоды ({customPromosList.length})
                  </div>
                  {promosLoading ? (
                    <div style={{ fontSize: 11, color: "var(--text2)", textAlign: "center", padding: "12px 0" }}>
                      Загрузка…
                    </div>
                  ) : customPromosList.length === 0 ? (
                    <div style={{ fontSize: 11, color: "var(--text2)", textAlign: "center", padding: "12px 0" }}>
                      Промокоды ещё не созданы
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {customPromosList.map(p => {
                        const exhausted = p.max_uses > 0 && (p.used_count || 0) >= p.max_uses;
                        return (
                          <div key={p.code} style={{
                            background: "var(--bg3)", borderRadius: 10, padding: "8px 10px",
                            border: `1px solid ${exhausted ? "rgba(239,68,68,0.2)" : "var(--border)"}`,
                            opacity: exhausted ? 0.6 : 1,
                          }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                              <div style={{ fontSize: 12, fontWeight: 700, fontFamily: "monospace", letterSpacing: "0.05em" }}>
                                {p.code}
                              </div>
                              <button onClick={() => handleDeletePromo(p.code)} style={{
                                fontSize: 9, padding: "2px 6px", borderRadius: 6,
                                background: "rgba(239,68,68,0.1)", color: "#f87171",
                                border: "1px solid rgba(239,68,68,0.25)", cursor: "pointer",
                              }}>Удалить</button>
                            </div>
                            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                              <span style={{
                                fontSize: 9, padding: "1px 6px", borderRadius: 5,
                                background: p.tier === "premium" ? "rgba(245,158,11,0.1)" : "rgba(139,92,246,0.1)",
                                color: p.tier === "premium" ? "var(--gold2)" : "var(--accent)",
                                border: `1px solid ${p.tier === "premium" ? "rgba(245,158,11,0.25)" : "rgba(139,92,246,0.25)"}`,
                                fontWeight: 700,
                              }}>{p.tier === "premium" ? "Премиум" : "VIP"}</span>
                              <span style={{ fontSize: 9, color: "var(--text2)" }}>{p.duration}д</span>
                              <span style={{
                                fontSize: 9, fontWeight: 700,
                                color: exhausted ? "#f87171" : "#4ade80",
                              }}>
                                {p.used_count || 0}/{p.max_uses} активаций
                              </span>
                              {p.last_used && (
                                <span style={{ fontSize: 9, color: "var(--text2)" }}>
                                  посл.: {new Date(p.last_used).toLocaleDateString("ru-RU")}
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </Card>
          </>
        )}

        {/* Support info */}
        <div style={{ background: "rgba(139,92,246,0.06)", border: "1px solid var(--border)", borderRadius: 14, padding: "12px 14px", fontSize: 11, color: "var(--text2)", lineHeight: 1.9 }}>
          💬 Если возникнут вопросы или проблемы — обращайся:
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}>
            <a
              href="https://t.me/helpmysticum"
              onClick={(e) => { e.preventDefault(); window.open("https://t.me/helpmysticum", "_blank"); }}
              style={{ color: "var(--accent)", textDecoration: "none", display: "flex", alignItems: "center", gap: 6, fontWeight: 600 }}
            >
              <span>📨</span> Telegram: @helpmysticum
            </a>
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span>✉️</span> Email: helpmysticum@gmail.com
            </span>
          </div>
        </div>

        <div style={{ height: 8 }} />
      </div>

      {/* ── Магазин удачи: трата очков ─────────────────────── */}
      <Modal open={showLuckShopModal} onClose={() => setShowLuckShopModal(false)} title="💫 Магазин удачи">
        <div style={{ fontSize: 12, color: "var(--text2)", marginBottom: 10 }}>
          У тебя: <span style={{ color: "var(--gold2)", fontWeight: 700 }}>{user.luck_points} 💫</span> — трать на разовые функции
        </div>
        {[
          { key: "tarot_extra",    item: "🎴 Доп. гадание Таро",     cost: 10, desc: "1 дополнительный расклад"  },
          { key: "compatibility",  item: "💕 Совместимость",          cost: 8,  desc: "1 бесплатная проверка"    },
          { key: "dream",          item: "🌙 Анализ сна",             cost: 12, desc: "Толкование от оракула"    },
          { key: "event_forecast", item: "🔮 Прогноз на событие",     cost: 15, desc: "Персональный прогноз"     },
          { key: "tarot_three",    item: "🃏 Расклад «Три карты»",    cost: 20, desc: "VIP расклад на 1 раз"     },
          { key: "runes",          item: "ᚠ Гадание на рунах",        cost: 25, desc: "VIP функция на 1 раз"     },
          { key: "aura",           item: "✨ Сканирование ауры",       cost: 30, desc: "VIP функция на 1 раз"     },
          { key: "natal_chart",    item: "⭐ Натальная карта",         cost: 30, desc: "Премиум расчёт на 1 раз"  },
          { key: "palmistry",      item: "🖐 Хиромантия (превью)",     cost: 50, desc: "Премиум анализ ладони"    },
          { key: "aura_deep",      item: "🌌 Аура: глубокий скан",     cost: 60, desc: "Премиум анализ ауры"      },
        ].map(({ key, item, cost, desc }) => {
          const canBuy = (user.luck_points || 0) >= cost;
          const owned  = shopPurchases?.[key] || 0;
          return (
            <div key={key} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: "1px solid var(--border)" }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 2, display: "flex", alignItems: "center", gap: 6 }}>
                  {item}
                  {owned > 0 && (
                    <span style={{ fontSize: 10, fontWeight: 800, color: "#4ade80", background: "rgba(74,222,128,0.12)", border: "1px solid rgba(74,222,128,0.3)", borderRadius: 6, padding: "1px 6px" }}>
                      {owned}×
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 10, color: "var(--text2)" }}>{desc}</div>
                <div style={{ fontSize: 10, color: canBuy ? "var(--gold2)" : "var(--text2)", fontWeight: 700, marginTop: 2 }}>{cost} 💫</div>
              </div>
              <button
                onClick={() => {
                  if (!canBuy) { showToast(`❌ Нужно ${cost} 💫, у тебя ${user.luck_points}`); return; }
                  const ok = spendLuck(cost);
                  if (ok) {
                    addShopPurchase(key);
                    showToast(`✅ ${item} добавлено! Теперь у тебя ${owned + 1}×`);
                  } else {
                    showToast(`❌ Не удалось потратить очки`);
                  }
                }}
                style={{
                  padding: "7px 14px", border: `1px solid ${canBuy ? "rgba(245,158,11,0.4)" : "var(--border)"}`,
                  borderRadius: 10, background: canBuy ? "rgba(245,158,11,0.1)" : "transparent",
                  color: canBuy ? "var(--gold2)" : "var(--text2)",
                  fontSize: 11, fontWeight: 700, cursor: canBuy ? "pointer" : "not-allowed",
                  transition: "all 0.2s", flexShrink: 0,
                }}
              >
                {canBuy ? "Купить" : "Мало 💫"}
              </button>
            </div>
          );
        })}
        <div style={{ height: 10 }} />
        <div style={{ fontSize: 11, color: "var(--text2)", textAlign: "center", marginBottom: 12 }}>
          Нет очков? Пополни — нажми <b style={{ color: "var(--gold2)" }}>+</b> рядом с балансом 💫 вверху
        </div>
        <Btn variant="ghost" onClick={() => setShowLuckShopModal(false)}>Закрыть</Btn>
      </Modal>

      {/* ── Покупка очков удачи ─────────────────────────────── */}
      <Modal open={showBuyLuckModal} onClose={() => setShowBuyLuckModal(false)} title="💫 Пополнить звёзды">
        <div style={{ fontSize: 13, color: "var(--text2)", marginBottom: 14, lineHeight: 1.6 }}>
          Очки удачи (💫) используются для разовых функций. Выбери пакет:
        </div>
        <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
          {LUCK_PACKAGES.map((pkg) => (
            <button
              key={pkg.id}
              disabled={!!paymentLoading}
              onClick={() => handleLuckPurchase(pkg.id)}
              style={{
                flex: 1, padding: "14px 8px", borderRadius: 14, cursor: paymentLoading ? "default" : "pointer",
                background: paymentLoading === pkg.id ? "rgba(245,158,11,0.2)" : "rgba(245,158,11,0.08)",
                border: "1px solid rgba(245,158,11,0.3)",
                display: "flex", flexDirection: "column", alignItems: "center", gap: 5,
                transition: "all 0.2s", opacity: paymentLoading && paymentLoading !== pkg.id ? 0.5 : 1,
              }}
            >
              <span style={{ fontSize: 22 }}>{pkg.emoji}</span>
              <span style={{ fontSize: 14, fontWeight: 800, color: "var(--gold2)" }}>
                {paymentLoading === pkg.id ? "…" : `${pkg.luck} 💫`}
              </span>
              <span style={{ fontSize: 12, color: "var(--text2)" }}>{pkg.price}₽</span>
            </button>
          ))}
        </div>
        <Btn variant="ghost" onClick={() => setShowBuyLuckModal(false)}>Закрыть</Btn>
      </Modal>

      {/* ── Магазин тарифов — открывается кнопкой + у плана ── */}
      <Modal open={showPlanModal} onClose={() => setShowPlanModal(false)} title="💎 Выбери тариф">
        <div style={{ fontSize: 13, color: "var(--text2)", marginBottom: 14, lineHeight: 1.6 }}>
          Разблокируй полный доступ к предсказаниям, натальной карте и персональному оракулу
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 14 }}>
          {tiers.map(t => {
            const isActive = (t.id === "vip" && canAccess("vip")) || (t.id === "premium" && canAccess("premium"));
            return (
              <div key={t.id} style={{
                background: t.id === "premium" ? "linear-gradient(135deg,#1a0a2e,#0a1628)" : "var(--card)",
                border: `2px solid ${isActive ? "#4ade80" : t.borderColor}`,
                borderRadius: 16, padding: 16, position: "relative", overflow: "hidden",
              }}>
                {t.id === "premium" && <div style={{ position: "absolute", right: -6, top: -6, fontSize: 50, opacity: 0.08 }}>👑</div>}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <div style={{ fontSize: 16, fontWeight: 800, color: t.color }}>{t.name}</div>
                  {isActive
                    ? <span style={{ fontSize: 10, background: "rgba(34,197,94,0.15)", color: "#4ade80", border: "1px solid rgba(34,197,94,0.3)", padding: "2px 8px", borderRadius: 10, fontWeight: 700 }}>АКТИВНА</span>
                    : <span style={{ fontSize: 15, fontWeight: 900, color: t.color }}>{t.price.split("/")[0]}<span style={{ fontSize: 11, color: "var(--text2)", fontWeight: 400 }}>/{t.price.split("/")[1]}</span></span>
                  }
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 3, marginBottom: 12 }}>
                  {t.features.slice(0, 4).map(f => (
                    <div key={f} style={{ fontSize: 11, color: "var(--text2)", display: "flex", gap: 5, alignItems: "center" }}>
                      <span style={{ color: t.id === "premium" ? "var(--gold)" : "var(--accent)", fontSize: 8 }}>✦</span>{f}
                    </div>
                  ))}
                </div>
                <Btn
                  variant={t.id === "premium" ? "gold" : "primary"}
                  size="sm"
                  disabled={!!paymentLoading || isActive}
                  onClick={() => { handleSubscribe(t.id); setShowPlanModal(false); }}
                >
                  {isActive ? "Активна" : paymentLoading === t.id ? "Открываем…" : `Подключить ${t.id === "premium" ? "Премиум" : "VIP"}`}
                </Btn>
              </div>
            );
          })}
        </div>
        <Btn variant="ghost" onClick={() => setShowPlanModal(false)}>Закрыть</Btn>
      </Modal>

      {/* Promo Code Modal */}
      <Modal open={showPromoModal} onClose={() => { setShowPromoModal(false); setPromoResult(null); }} title="🎁 Активация промокода">
        <div style={{ fontSize: 12, color: "var(--text2)", marginBottom: 14, lineHeight: 1.6 }}>
          Введи промокод для активации VIP или Премиум подписки
        </div>
        <input
          value={promoCode}
          onChange={e => setPromoCode(e.target.value.toUpperCase())}
          placeholder="MYSTIC-XXX-000"
          style={{
            width: "100%", padding: "12px 14px", borderRadius: 12,
            background: "var(--bg3)", border: "1px solid var(--border)",
            color: "var(--text)", fontSize: 15, fontWeight: 700,
            outline: "none", fontFamily: "monospace", textAlign: "center",
            letterSpacing: "0.1em", marginBottom: 10,
          }}
          onFocus={e => e.target.style.borderColor = "rgba(139,92,246,0.5)"}
          onBlur={e => e.target.style.borderColor = "var(--border)"}
          onKeyDown={e => e.key === "Enter" && handlePromoActivate()}
        />
        {promoResult && !promoResult.success && (
          <div style={{ fontSize: 12, color: "#f87171", textAlign: "center", marginBottom: 10, padding: "6px 10px", background: "rgba(239,68,68,0.08)", borderRadius: 8 }}>
            ❌ {promoResult.error}
          </div>
        )}
        {promoResult && promoResult.success && (
          <div style={{ fontSize: 12, color: "#4ade80", textAlign: "center", marginBottom: 10, padding: "8px 10px", background: "rgba(34,197,94,0.08)", borderRadius: 8 }}>
            ✅ Промокод активирован! {`${promoResult.tier === "premium" ? "Премиум" : "VIP"} на ${promoResult.duration} ${promoResult.duration === 1 ? "день" : promoResult.duration >= 2 && promoResult.duration <= 4 ? "дня" : "дней"}`}
          </div>
        )}
        <div style={{ display: "flex", gap: 8 }}>
          <Btn variant="ghost" size="sm" style={{ flex: 1 }} onClick={() => { setShowPromoModal(false); setPromoResult(null); }}>Закрыть</Btn>
          <Btn size="sm" style={{ flex: 2 }} onClick={handlePromoActivate} disabled={!promoCode.trim() || promoActivating}>{promoActivating ? "Проверка…" : "Активировать"}</Btn>
        </div>
      </Modal>

      {/* Level Progress Modal */}
      <Modal open={showLevelModal} onClose={() => setShowLevelModal(false)} title="🏆 Уровни мастерства">
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {MASTERY_LEVELS.map((level, idx) => {
            const isActive = mastery.level === level.level;
            const isUnlocked = totalReadings >= level.min;
            const claimed = (user.level_rewards_claimed || []).includes(level.level);
            return (
              <div key={level.level} style={{
                background: isActive ? "rgba(139,92,246,0.12)" : "var(--bg3)",
                border: `1px solid ${isActive ? "rgba(139,92,246,0.4)" : "var(--border)"}`,
                borderRadius: 12, padding: "10px 12px",
                opacity: isUnlocked ? 1 : 0.5,
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 18 }}>{level.emoji}</span>
                    <span style={{ fontSize: 13, fontWeight: 700 }}>{level.level}</span>
                    {isActive && <span style={{ fontSize: 9, background: "rgba(34,197,94,0.15)", color: "#4ade80", padding: "1px 6px", borderRadius: 6, fontWeight: 700 }}>ТЕКУЩИЙ</span>}
                  </div>
                  <span style={{ fontSize: 11, color: "var(--text2)" }}>{level.min}+ гаданий</span>
                </div>
                {/* Прогресс */}
                {level.next && isActive && (
                  <div style={{ marginBottom: 6 }}>
                    <div style={{ background: "rgba(139,92,246,0.15)", borderRadius: 20, height: 4, overflow: "hidden", marginBottom: 3 }}>
                      <div style={{
                        height: "100%", borderRadius: 20,
                        background: "linear-gradient(90deg,#8b5cf6,#f59e0b)",
                        width: `${Math.min(((totalReadings - level.min) / (level.next - level.min)) * 100, 100)}%`,
                      }} />
                    </div>
                    <div style={{ fontSize: 10, color: "var(--text2)" }}>{totalReadings} / {level.next}</div>
                  </div>
                )}
                {/* Награда */}
                {level.reward > 0 && (
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: 10, color: "var(--gold2)" }}>🎁 Награда: +{level.reward} 💫</span>
                    {isUnlocked && !claimed ? (
                      <button onClick={() => handleClaimLevel(level)} style={{
                        fontSize: 10, fontWeight: 700, padding: "3px 10px", borderRadius: 8,
                        background: "linear-gradient(135deg,#f59e0b,#d97706)", color: "white",
                        border: "none", cursor: "pointer",
                      }}>Забрать!</button>
                    ) : claimed ? (
                      <span style={{ fontSize: 10, color: "#4ade80" }}>✓ Получено</span>
                    ) : (
                      <span style={{ fontSize: 10, color: "var(--text2)" }}>🔒</span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div style={{ height: 12 }} />
        <Btn variant="ghost" onClick={() => setShowLevelModal(false)}>Закрыть</Btn>
      </Modal>

      {/* === КОЛЛЕКЦИЯ КАРТ === */}
      <Modal open={showCollectionModal} onClose={() => setShowCollectionModal(false)} title="🃏 Коллекция Таро">
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 13, color: "var(--text2)", marginBottom: 8 }}>
            Карты появляются в коллекции когда ты получаешь их в гаданиях.
            Собери все {ALL_CARDS.length}, чтобы разблокировать достижение 🏆
          </div>
          {/* Progress bar */}
          <div style={{ background: "var(--bg3)", borderRadius: 20, height: 6, overflow: "hidden", marginBottom: 6 }}>
            <div style={{
              height: "100%", borderRadius: 20,
              background: "linear-gradient(90deg,#8b5cf6,#f59e0b)",
              width: `${Math.min(((user.card_collection || []).length / ALL_CARDS.length) * 100, 100)}%`,
              transition: "width 0.8s ease",
            }} />
          </div>
          <div style={{ fontSize: 12, color: "var(--text2)", marginBottom: 12 }}>
            Собрано: <span style={{ color: "var(--accent)", fontWeight: 700 }}>{(user.card_collection || []).length}</span> / {ALL_CARDS.length} карт
          </div>
          {/* Visual card grid — all cards with collected/locked states */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
            {ALL_CARDS.map(card => {
              const collected = (user.card_collection || []).includes(card.name);
              const gradients = [
                "linear-gradient(160deg,#1a0a2e,#2d1b69)",
                "linear-gradient(160deg,#0a1628,#1e3a5f)",
                "linear-gradient(160deg,#1a0a1e,#4a1d4a)",
                "linear-gradient(160deg,#0a2018,#1a4a2e)",
                "linear-gradient(160deg,#1e0a0a,#4a1a1a)",
              ];
              return (
                <div key={card.id} style={{
                  borderRadius: 10, overflow: "hidden",
                  background: collected ? gradients[card.id % gradients.length] : "var(--bg3)",
                  border: `1px solid ${collected ? "rgba(139,92,246,0.45)" : "var(--border)"}`,
                  padding: collected ? "0 0 6px" : "10px 4px 8px",
                  display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                  opacity: collected ? 1 : 0.4,
                  transition: "all 0.3s",
                  minHeight: 80,
                }}>
                  {collected ? (
                    <CollectionCardImg id={card.id} emoji={card.emoji} name={card.name} />
                  ) : (
                    <div style={{ fontSize: 26, marginBottom: 4 }}>🔒</div>
                  )}
                  <div style={{
                    fontSize: 9, fontWeight: 700, textAlign: "center",
                    color: collected ? "rgba(255,255,255,0.85)" : "var(--text2)",
                    lineHeight: 1.25, padding: "0 2px",
                  }}>
                    {card.name}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div style={{ height: 8 }} />
        <Btn variant="ghost" onClick={() => setShowCollectionModal(false)}>Закрыть</Btn>
      </Modal>

      {/* === ДОСТИЖЕНИЯ === */}
      <Modal open={showAchievementsModal} onClose={() => setShowAchievementsModal(false)} title="🏅 Достижения">
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
          {ACHIEVEMENTS_LIST.map(ach => {
            const isUnlocked = (user.unlocked_achievements || []).includes(ach.id);
            return (
              <div key={ach.id} style={{
                background: isUnlocked ? "rgba(139,92,246,0.1)" : "var(--bg3)",
                border: `1px solid ${isUnlocked ? "rgba(139,92,246,0.3)" : "var(--border)"}`,
                borderRadius: 12, padding: "10px 12px",
                display: "flex", alignItems: "center", gap: 12,
                opacity: isUnlocked ? 1 : 0.5,
              }}>
                <span style={{ fontSize: 24, width: 36, textAlign: "center", flexShrink: 0 }}>{isUnlocked ? ach.emoji : "🔒"}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 2 }}>{ach.title}</div>
                  <div style={{ fontSize: 10, color: "var(--text2)" }}>{ach.desc}</div>
                </div>
                <div style={{ fontSize: 10, color: isUnlocked ? "var(--gold2)" : "var(--text2)", fontWeight: 700, whiteSpace: "nowrap" }}>
                  {isUnlocked ? `+${ach.luck} 💫` : `${ach.luck} 💫`}
                </div>
              </div>
            );
          })}
        </div>
        <Btn variant="ghost" onClick={() => setShowAchievementsModal(false)}>Закрыть</Btn>
      </Modal>
    </div>
  );
}
