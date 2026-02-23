import { useState, useEffect, useRef } from "react";
import { Card, Btn, SLabel, AppHeader, Badge, EnergyBar, TarotCardVisual } from "../components/UI";
import { ALL_CARDS, ZODIAC_SIGNS } from "../data/tarot";
import { generateHoroscope, DAILY_PLANETS_STUB, getUpcomingEvents, getDailyCache, setDailyCache, getSpecialDay, ACHIEVEMENTS_LIST } from "../hooks/useAppState";
import ClaudeAPI from "../api/claude";

const MOON_PHASES = ["🌑","🌒","🌓","🌔","🌕","🌖","🌗","🌘"];
const getMoonPhase = () => MOON_PHASES[Math.floor((Date.now() / (29.5 * 24 * 3600000)) % 8)];
const getGreeting = () => {
  const h = new Date().getHours();
  if (h >= 5 && h < 12) return "Доброе утро";
  if (h >= 12 && h < 17) return "Добрый день";
  if (h >= 17 && h < 23) return "Добрый вечер";
  return "Доброй ночи";
};

// Персонализированный ритуал под профиль пользователя
const getPersonalRitual = (event, user) => {
  if (!event) return "";
  const focus = (user.life_focus || [])[0]; // главный приоритет
  const sign = user.sun_sign || "";
  // Адаптируем ритуал к приоритету пользователя
  const focusAddon = {
    love:     "Направь это намерение на отношения и любовь",
    career:   "Усиль ритуал мыслями о карьере и успехе",
    finance:  "Визуализируй финансовое изобилие",
    health:   "Добавь намерение на здоровье и жизненную силу",
    spiritual:"Углуби медитацию — твой духовный путь усиливается",
    family:   "Вложи в ритуал любовь к близким",
  }[focus];
  const base = event.ritual;
  return focusAddon ? `${base}. ${focusAddon}` : base;
};

export default function Home({ state, showToast }) {
  const { user, canAccess, setCurrentPage, diary, tarotHistory,
          readHoroscope, horoscopeReadToday, isDailyCardUsed, markDailyCardUsed,
          getContextForClaude, addDailyEnergy, addLuck,
          unlockAchievement, investigation, oracleMemory } = state;

  const [horoscope, setHoroscope]               = useState(() => generateHoroscope(user, false, tarotHistory, oracleMemory));
  const [horoscopeExpanded, setExpanded]         = useState(false);
  const [horoscopeLoading, setHoroscopeLoading] = useState(false);
  const [dailyCard]                              = useState(() => ALL_CARDS[Math.floor(Date.now() / 86400000) % ALL_CARDS.length]);
  const [upcomingEvents]                         = useState(() => getUpcomingEvents(7));
  const [specialDay]                             = useState(() => getSpecialDay());
  const [specialDayDismissed, setSpecialDayDismissed] = useState(() => {
    const stored = localStorage.getItem("special_day_dismissed");
    return stored === new Date().toDateString();
  });
  const [showVipHoro, setShowVipHoro]            = useState(false);
  const [vipHoroText, setVipHoroText]           = useState(null);
  const [vipHoroLoading, setVipHoroLoading]     = useState(false);
  const [cardRevealed, setCardRevealed]          = useState(() => isDailyCardUsed());
  const [planets, setPlanets]                    = useState(DAILY_PLANETS_STUB);
  // planetsDate служит триггером для перезапроса планет при смене даты (в т.ч. в полночь)
  const [planetsDate, setPlanetsDate]            = useState(() => new Date().toISOString().slice(0, 10));
  const midnightTimerRef                         = useRef(null);

  // Таймер на полночь: при смене суток сбрасываем planetsDate → эффект ниже перезапросит Grok
  useEffect(() => {
    const scheduleAtMidnight = () => {
      const now = new Date();
      const midnight = new Date(now);
      midnight.setHours(24, 0, 0, 500); // +500 мс запас, чтобы не попасть в предыдущую секунду
      const msUntil = midnight - now;
      midnightTimerRef.current = setTimeout(() => {
        setPlanetsDate(new Date().toISOString().slice(0, 10));
        scheduleAtMidnight(); // переназначаем на следующую полночь
      }, msUntil);
    };
    scheduleAtMidnight();
    return () => clearTimeout(midnightTimerRef.current);
  }, []);

  // Загружаем гороскоп и планеты из дневного кэша или генерируем через Grok
  useEffect(() => {
    let cancelled = false;
    const sign = user.sun_sign || "unknown";

    // Гороскоп
    const horoCacheKey = `horo_${sign}`;
    const cachedHoro = getDailyCache(horoCacheKey);
    if (cachedHoro) {
      setHoroscope(cachedHoro);
    } else {
      setHoroscopeLoading(true);
      ClaudeAPI.generateHoroscopeAI(getContextForClaude())
        .then(text => {
          if (!cancelled && text) {
            setHoroscope(text);
            setDailyCache(horoCacheKey, text);
          }
          if (!cancelled) setHoroscopeLoading(false);
        })
        .catch(() => { if (!cancelled) setHoroscopeLoading(false); });
    }

    // Планеты — запрашиваем у Grok если кэш устарел (новый день)
    const cachedPlanets = getDailyCache("planets");
    if (cachedPlanets) {
      setPlanets(cachedPlanets);
    } else {
      // Сначала показываем stub, пока Grok не ответил
      setPlanets(DAILY_PLANETS_STUB);
      const todayStr = new Date().toLocaleDateString("ru-RU", { year: "numeric", month: "long", day: "numeric" });
      ClaudeAPI.generateDailyPlanets(todayStr)
        .then(data => {
          if (!cancelled && data) {
            setPlanets(data);
            setDailyCache("planets", data);
          }
        })
        .catch(() => {});
    }

    return () => { cancelled = true; };
  }, [user.sun_sign, planetsDate]); // planetsDate меняется в полночь → пересбрасывает кэш

  const handleReadHoroscope = () => {
    setExpanded(true);
    if (!horoscopeReadToday) {
      const pointsAdded = readHoroscope();
      addDailyEnergy();
      if (pointsAdded) {
        const bonus = canAccess("vip") ? 2 : 1;
        showToast(`✨ +${bonus} 💫 за гороскоп!`);
      }
    }
  };

  const handleVipHoroscope = async () => {
    if (!canAccess("vip")) { showToast("⭐ Нужен VIP тариф"); return; }
    addDailyEnergy();
    setShowVipHoro(true);
    if (!vipHoroText && !vipHoroLoading) {
      setVipHoroLoading(true);
      try {
        const context = getContextForClaude();
        const text = await ClaudeAPI.generateHoroscopeAI({ ...context, expanded: true });
        setVipHoroText(text || generateHoroscope(user, true, tarotHistory, oracleMemory));
      } catch {
        setVipHoroText(generateHoroscope(user, true, tarotHistory, oracleMemory));
      }
      setVipHoroLoading(false);
    }
  };

  // Проверяем pending достижения и показываем тосты
  const { popAchievementToast } = state;
  useEffect(() => {
    if (!popAchievementToast) return;
    const interval = setInterval(() => {
      const ach = popAchievementToast();
      if (ach) showToast(`${ach.emoji} Достижение: ${ach.title}! +${ach.luck} 💫`);
    }, 1500);
    return () => clearInterval(interval);
  }, [popAchievementToast, showToast]);

  const handleRevealDailyCard = () => {
    if (!cardRevealed) {
      setCardRevealed(true);
      markDailyCardUsed();
      addDailyEnergy();
      addLuck(1, "Карта дня");
      showToast("🃏 +1 💫 Карта дня открыта!");
      // Add daily card to collection via unlockAchievement check
      // (card_collection is updated via addTarotReading in Tarot page — here just track)
    }
  };

  // Динамическая энергия дня из user.daily_energy
  const todayKey = new Date().toDateString();
  const energy = user.daily_energy_date === todayKey ? (user.daily_energy || 0) : 0;

  const sign = ZODIAC_SIGNS.find(z => z.sign === user.sun_sign) || ZODIAC_SIGNS[11];
  const moon = getMoonPhase();
  const today = new Date().toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" });

  return (
    <div>
      <AppHeader title="✦ Мистикум" luckPoints={user.luck_points} streak={user.streak_days} />
      <div style={{ padding: "14px 14px 0", display: "flex", flexDirection: "column", gap: 14 }}>

        {/* Приветствие */}
        <div style={{ textAlign: "center", padding: "8px 0" }}>
          <div style={{ fontSize: 44, animation: "float 3s ease-in-out infinite", display: "block", marginBottom: 8 }}>{moon}</div>
          <h2 style={{ fontSize: 22, fontWeight: 800, marginBottom: 4 }}>
            {getGreeting()}, <span style={{ background: "linear-gradient(90deg,#8b5cf6,#f59e0b,#8b5cf6)", backgroundSize: "200%", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", animation: "shimmer 3s linear infinite" }}>{user.name}</span>
          </h2>
          <p style={{ fontSize: 12, color: "var(--text2)", marginBottom: 10 }}>{today} · Луна {planets.moon.phase} в {planets.moon.sign}</p>
          <EnergyBar value={energy} />
        </div>

        {/* === ОСОБЫЙ ДЕНЬ === */}
        {specialDay && !specialDayDismissed && (
          <div style={{
            background: specialDay.color,
            border: `1px solid ${specialDay.border}`,
            borderRadius: 16, padding: "14px 16px",
            position: "relative", overflow: "hidden",
          }}>
            {/* Интенсивный пульс для eclipse/solstice */}
            {(specialDay.intensity === "extreme" || specialDay.intensity === "high") && (
              <div style={{ position: "absolute", top: -20, right: -20, fontSize: 80, opacity: 0.06, animation: "pulse 3s ease-in-out infinite" }}>
                {specialDay.emoji}
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: "var(--text)" }}>
                {specialDay.label}
              </div>
              <button onClick={() => { setSpecialDayDismissed(true); localStorage.setItem("special_day_dismissed", new Date().toDateString()); }}
                style={{ fontSize: 14, background: "none", border: "none", color: "var(--text2)", cursor: "pointer", padding: "0 0 0 8px", lineHeight: 1 }}>
                ✕
              </button>
            </div>
            <div style={{ fontSize: 12, color: "var(--text2)", lineHeight: 1.6, marginBottom: 10 }}>
              {specialDay.description}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <div style={{ flex: 1, fontSize: 11, background: "rgba(255,255,255,0.05)", borderRadius: 8, padding: "7px 10px", color: "var(--text)" }}>
                🕯️ {specialDay.ritual}
              </div>
              <button onClick={() => {
                unlockAchievement?.("special_day");
                setCurrentPage("tarot");
              }} style={{
                fontSize: 11, fontWeight: 700, padding: "7px 14px", borderRadius: 8,
                background: "var(--accent)", color: "white", border: "none", cursor: "pointer", whiteSpace: "nowrap",
              }}>⚡ Погадать</button>
            </div>
          </div>
        )}


        {/* === ПРОГРЕСС РАССЛЕДОВАНИЯ === */}
        {investigation?.title && (investigation?.progress || 0) < 3 && (() => {
          const progress = investigation.progress || 0;
          const remaining = 3 - progress;
          return (
            <div style={{
              background: "rgba(99,102,241,0.08)",
              border: "1px solid rgba(99,102,241,0.25)",
              borderRadius: 14, padding: "12px 14px",
              display: "flex", alignItems: "center", gap: 12,
              cursor: "pointer",
            }} onClick={() => setCurrentPage("investigation")}>
              <span style={{ fontSize: 24 }}>🔍</span>
              <div>
                <div style={{ fontSize: 12, fontWeight: 800, color: "#818cf8", marginBottom: 2 }}>
                  {progress === 0 ? "Расследование ждёт первой улики" : `Расследование: ещё ${remaining} ${remaining === 1 ? "часть" : "части"} скрыты`}
                </div>
                <div style={{ fontSize: 11, color: "var(--text2)" }}>
                  {progress === 0 ? "Сделай расклад, чтобы начать раскрывать тайну." : "Гадай дальше — следующая часть разблокируется."}
                </div>
              </div>
            </div>
          );
        })()}

        {/* === ПРОГРЕСС ОПРОСНИКОВ === */}
        {(() => {
          const completedQuizzes = user.completed_quizzes || [];
          const TOTAL_QUIZZES = 5;
          if (completedQuizzes.length > 0 && completedQuizzes.length < TOTAL_QUIZZES) {
            const left = TOTAL_QUIZZES - completedQuizzes.length;
            return (
              <div style={{
                background: "rgba(139,92,246,0.07)",
                border: "1px solid rgba(139,92,246,0.2)",
                borderRadius: 14, padding: "12px 14px",
                display: "flex", alignItems: "center", gap: 12,
                cursor: "pointer",
              }} onClick={() => setCurrentPage("quizzes")}>
                <span style={{ fontSize: 24 }}>📋</span>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 800, color: "var(--accent)", marginBottom: 2 }}>
                    {completedQuizzes.length}/{TOTAL_QUIZZES} опросников пройдено
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text2)" }}>
                    {left === 1 ? "Остался последний тест — пройди, чтобы Оракул видел тебя полностью." : `Ещё ${left} теста — и Оракул узнает тебя намного глубже.`}
                  </div>
                </div>
              </div>
            );
          }
          return null;
        })()}

        {/* === МИСТИЧЕСКОЕ РАССЛЕДОВАНИЕ === */}
        <InvestigationTeaser investigation={investigation} setCurrentPage={setCurrentPage} />

        {/* === ПЕРСОНАЛЬНЫЙ ОРАКУЛ === */}
        <div
          onClick={() => setCurrentPage("oracle")}
          style={{
            background: "linear-gradient(135deg,rgba(139,92,246,0.18),rgba(245,158,11,0.1))",
            border: "1px solid rgba(139,92,246,0.4)",
            borderRadius: 18, padding: "16px 18px",
            cursor: "pointer", position: "relative", overflow: "hidden",
          }}
        >
          <div style={{ position: "absolute", right: -12, top: -12, fontSize: 72, opacity: 0.07, animation: "float 3s ease-in-out infinite" }}>🔮</div>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{
              width: 52, height: 52, borderRadius: 16, flexShrink: 0,
              background: "linear-gradient(135deg,#8b5cf6,#6d28d9)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 28, boxShadow: "0 4px 16px rgba(139,92,246,0.3)",
            }}>🔮</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 4, display: "flex", alignItems: "center", gap: 8 }}>
                Персональный Оракул
                {!canAccess("premium") && (
                  <span style={{ fontSize: 9, fontWeight: 700, background: "linear-gradient(135deg,#f59e0b,#d97706)", color: "#fff", padding: "2px 7px", borderRadius: 6 }}>👑</span>
                )}
              </div>
              <div style={{ fontSize: 12, color: "var(--text2)", lineHeight: 1.55 }}>
                Помнит всё о тебе. Отвечает на любые вопросы — о любви, пути, страхах.
              </div>
            </div>
            <div style={{ fontSize: 20, color: canAccess("premium") ? "var(--accent)" : "var(--text2)" }}>
              {canAccess("premium") ? "→" : "🔒"}
            </div>
          </div>
        </div>

        {/* Гороскоп */}
        <SLabel>🌟 Гороскоп на сегодня</SLabel>
        <Card>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text2)", textTransform: "uppercase", letterSpacing: "0.08em" }}>{sign.symbol} {sign.sign}</div>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              {horoscopeReadToday && <span style={{ fontSize: 10, color: "#4ade80" }}>✓ прочитан</span>}
              <Badge tier="free" />
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: 10, background: "var(--bg3)", borderRadius: 12, marginBottom: 12 }}>
            <div style={{ fontSize: 28, width: 42, height: 42, background: "rgba(139,92,246,0.12)", borderRadius: 11, display: "flex", alignItems: "center", justifyContent: "center" }}>{sign.symbol}</div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 2 }}>{sign.sign} · {sign.element}</div>
              <div style={{ fontSize: 11, color: "var(--text2)" }}>{sign.planet} · {sign.dates}</div>
            </div>
          </div>

          {horoscope && (
            <div style={{ fontSize: 13, lineHeight: 1.65, color: "var(--text)", marginBottom: 12 }}>
              {horoscopeExpanded && horoscopeLoading
                ? <span style={{ color: "var(--text2)" }}>✨ Читаю звёзды...</span>
                : (horoscopeExpanded ? horoscope : horoscope.slice(0, 120) + "...")}
            </div>
          )}

          <div style={{ display: "flex", gap: 8 }}>
            <Btn
              onClick={handleReadHoroscope}
              variant={horoscopeReadToday ? "ghost" : "primary"}
              size="sm" style={{ flex: 2 }}
            >
              {horoscopeReadToday ? "🔭 Открыт ✓" : `🔭 Читать +${canAccess("vip") ? 2 : 1} 💫`}
            </Btn>
            {/* Расширенный VIP гороскоп */}
            <Btn onClick={handleVipHoroscope} variant={canAccess("vip") ? "gold" : "ghost"} size="sm" style={{ flex: 1 }}>
              {canAccess("vip") ? "⭐ VIP" : "🔒 VIP"}
            </Btn>
          </div>
        </Card>

        {/* VIP расширенный гороскоп */}
        {showVipHoro && canAccess("vip") && (
          <Card style={{ border: "1px solid rgba(245,158,11,0.3)", background: "linear-gradient(135deg,#1a0a2e,#0a0a0f)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--gold2)" }}>⭐ Персональный прогноз</div>
              <Badge tier="vip" />
            </div>

            {/* Положение планет */}
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
              {[
                ["☀️", planets.sun.sign],
                ["🌙", `${planets.moon.sign} (${planets.moon.phase})`],
                ["☿", planets.mercury.sign + (planets.mercury.retrograde ? " ℞" : "")],
                ["♀", planets.venus.sign],
                ["♂", planets.mars.sign],
              ].map(([e, s]) => (
                <div key={e} style={{ fontSize: 10, background: "rgba(139,92,246,0.1)", border: "1px solid rgba(139,92,246,0.2)", borderRadius: 8, padding: "3px 8px", color: "var(--text2)" }}>
                  {e} {s}
                </div>
              ))}
            </div>

            {/* Фокус пользователя */}
            {user.life_focus?.length > 0 && (
              <div style={{ fontSize: 11, color: "var(--text2)", marginBottom: 10 }}>
                Прогноз адаптирован под: {user.life_focus.map(f => ({
                  love: "❤️ Любовь", career: "💼 Карьеру", finance: "💰 Финансы",
                  health: "🧘 Здоровье", spiritual: "🌟 Духовность", family: "👨‍👩‍👧 Семью"
                }[f])).join(", ")}
              </div>
            )}

            <div style={{ fontSize: 13, lineHeight: 1.7, color: "var(--text)", marginBottom: 12 }}>
              {vipHoroLoading
                ? <span style={{ color: "var(--text2)" }}>✨ Составляю твой прогноз...</span>
                : (vipHoroText || generateHoroscope(user, true, tarotHistory, oracleMemory))
              }
            </div>
            <div style={{ fontSize: 10, color: "var(--text2)", background: "var(--bg3)", borderRadius: 8, padding: "6px 10px" }}>
              ✨ Расширенный прогноз составлен с учётом положения планет и твоего знака зодиака
            </div>
          </Card>
        )}

        {/* Карта Таро дня */}
        <SLabel>🃏 Карта дня</SLabel>
        <Card>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text2)", textTransform: "uppercase", letterSpacing: "0.08em" }}>Таро дня</div>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              {cardRevealed && <span style={{ fontSize: 10, color: "#4ade80" }}>✓ открыта</span>}
              <Badge tier="free" />
            </div>
          </div>

          {cardRevealed ? (
            <>
              <div style={{ display: "flex", gap: 14, alignItems: "center", marginBottom: 12 }}>
                <TarotCardVisual card={dailyCard} size="md" revealed={true} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 4 }}>{dailyCard.name}</div>
                  <div style={{ fontSize: 11, color: "var(--accent)", marginBottom: 8 }}>{dailyCard.keywords}</div>
                  <div style={{ fontSize: 12, color: "var(--text2)", lineHeight: 1.55 }}>{dailyCard.meaning_up.slice(0, 90)}...</div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <Btn variant="ghost" size="sm" style={{ flex: 1 }} onClick={() => setCurrentPage("diary")}>📔 В дневник</Btn>
                <Btn variant="primary" size="sm" style={{ flex: 2 }} onClick={() => setCurrentPage("tarot")}>🎴 Полное гадание</Btn>
              </div>
              <ShareCardButton card={dailyCard} sign={sign} showToast={showToast} />
            </>
          ) : (
            <div style={{ textAlign: "center", padding: "16px 0" }}>
              <TarotCardVisual card={null} size="lg" revealed={false} />
              <div style={{ fontSize: 13, color: "var(--text2)", marginTop: 12, marginBottom: 12 }}>
                Твоя карта на сегодня ждёт тебя
              </div>
              <Btn onClick={handleRevealDailyCard} size="sm">
                ✨ Открыть карту дня
              </Btn>
            </div>
          )}
        </Card>

        {/* Ближайшие мистические события */}
        {upcomingEvents.length > 0 && (
          <>
            <SLabel>🗓️ Ближайшие события</SLabel>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {upcomingEvents.slice(0, 3).map(ev => {
                const daysLeft = Math.ceil((new Date(ev.date) - new Date()) / 86400000);
                return (
                  <div key={ev.date + ev.label} style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 13, padding: "11px 13px", display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ fontSize: 22, width: 36, flexShrink: 0 }}>{ev.label.split(" ")[0]}</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 2 }}>{ev.label.replace(/^[^\s]+\s/, "")}</div>
                      <div style={{ fontSize: 11, color: "var(--text2)" }}>{getPersonalRitual(ev, user)}</div>
                    </div>
                    <div style={{ fontSize: 11, color: daysLeft <= 1 ? "#4ade80" : "var(--text2)", fontWeight: daysLeft <= 1 ? 700 : 400, flexShrink: 0 }}>
                      {daysLeft === 0 ? "Сегодня!" : daysLeft === 1 ? "Завтра" : `${daysLeft}д`}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* Возможности */}
        <SLabel>🔮 Возможности</SLabel>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 9 }}>
          {FEATURES.map(f => (
            <FeatureCard key={f.id} feature={f} canAccess={canAccess} setCurrentPage={setCurrentPage} showToast={showToast} />
          ))}
        </div>

        {/* Последние записи дневника */}
        {diary.length > 0 && (
          <>
            <SLabel>📔 Последние записи</SLabel>
            {diary.slice(0, 2).map(entry => (
              <div key={entry.id} style={{ display: "flex", gap: 10, padding: "10px 12px", background: "var(--card)", border: "1px solid var(--border)", borderRadius: 13, cursor: "pointer" }} onClick={() => setCurrentPage("diary")}>
                <div style={{ fontSize: 20, width: 34, height: 34, background: "rgba(139,92,246,0.1)", borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center" }}>{entry.mood || "📝"}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 2 }}>{entry.title || "Запись"}</div>
                  <div style={{ fontSize: 11, color: "var(--text2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{entry.text}</div>
                </div>
              </div>
            ))}
          </>
        )}

        {/* Промо VIP — только для бесплатных */}
        {!canAccess("vip") && (
          <>
            <SLabel>⭐ Открой больше</SLabel>
            <div style={{ background: "linear-gradient(135deg,#1a0a2e,#0a1628)", border: "1px solid rgba(139,92,246,0.3)", borderRadius: 18, padding: 16, position: "relative", overflow: "hidden" }}>
              <div style={{ position: "absolute", right: -10, top: -10, fontSize: 70, opacity: 0.08 }}>⭐</div>
              <div style={{ fontSize: 17, fontWeight: 800, color: "var(--accent)", marginBottom: 8 }}>⭐ VIP тариф</div>
              <div style={{ fontSize: 12, color: "var(--text2)", marginBottom: 12, lineHeight: 1.6 }}>
                Персональный гороскоп с учётом планет, расклады Таро на 3–5 карт, совместимость и лунный календарь
              </div>
              <div style={{ fontSize: 22, fontWeight: 900, color: "var(--accent)", marginBottom: 10 }}>249₽<span style={{ fontSize: 13, fontWeight: 400, color: "var(--text2)" }}> / мес</span></div>
              <Btn variant="primary" onClick={() => showToast("⭐ VIP: расклады на 3 карты, VIP гороскоп, руны, аура — 249₽/мес. Оплата скоро!")}>
                ⭐ Подключить VIP
              </Btn>
            </div>
          </>
        )}

        {/* Промо Премиум — только для VIP (не Премиум) */}
        {canAccess("vip") && !canAccess("premium") && (
          <>
            <SLabel>👑 Открой всё</SLabel>
            <div style={{ background: "linear-gradient(135deg,#1a0a2e,#0a1628)", border: "1px solid rgba(245,158,11,0.35)", borderRadius: 18, padding: 16, position: "relative", overflow: "hidden" }}>
              <div style={{ position: "absolute", right: -10, top: -10, fontSize: 70, opacity: 0.08 }}>👑</div>
              <div style={{ fontSize: 17, fontWeight: 800, color: "var(--gold2)", marginBottom: 8 }}>👑 Премиум тариф</div>
              <div style={{ fontSize: 12, color: "var(--text2)", marginBottom: 12, lineHeight: 1.6 }}>
                Хиромантия, анализ ауры, натальная карта, руны и все расклады без ограничений
              </div>
              <div style={{ fontSize: 22, fontWeight: 900, color: "var(--gold2)", marginBottom: 10 }}>499₽<span style={{ fontSize: 13, fontWeight: 400, color: "var(--text2)" }}> / мес</span></div>
              <Btn variant="gold" onClick={() => showToast("👑 Премиум: хиромантия, натальная карта, все расклады — 499₽/мес. Оплата скоро!")}>
                👑 Подключить Премиум
              </Btn>
            </div>
          </>
        )}

        <div style={{ height: 8 }} />
      </div>
    </div>
  );
}

const FEATURES = [
  { id: "tarot",    emoji: "🃏", name: "Гадание Таро",  desc: "Все расклады",       tier: "free",    page: "tarot" },
  { id: "compat",   emoji: "💕", name: "Совместимость", desc: "Анализ знаков",      tier: "free",    page: "astrology" },
  { id: "palmistry",emoji: "🖐️", name: "Хиромантия",   desc: "Анализ руки",        tier: "premium", page: "palmistry" },
  { id: "rune",     emoji: "ᚠ",  name: "Руны",          desc: "Гадание на рунах",   tier: "vip",     page: "runes" },
  { id: "aura",     emoji: "✨",  name: "Аура",          desc: "Определи цвет",      tier: "vip",     page: "aura" },
  { id: "dream",    emoji: "😴", name: "Сонник",        desc: "Толкование снов",    tier: "free",    page: "diary" },
  { id: "lunar",    emoji: "🌙", name: "Лунный цикл",  desc: "Влияние на тебя",   tier: "vip",     page: "astrology" },
  { id: "natal",    emoji: "⭐", name: "Натальная карта",desc: "Раз в неделю",      tier: "premium", page: "astrology" },
];

const FEATURE_LOCK_TOASTS = {
  compat:    "💕 Совместимость — VIP тариф. Анализ по знакам и стихиям!",
  palmistry: "🖐️ Хиромантия — Премиум. Оракул прочитает линии твоей руки",
  rune:      "ᚠ Руны — VIP тариф. Мудрость древних символов ждёт тебя",
  aura:      "✨ Аура — VIP тариф. Узнай цвет и качество своей энергии",
  lunar:     "🌙 Лунный цикл — VIP тариф. Планеты и их влияние на тебя",
  natal:     "⭐ Натальная карта — Премиум. Карта судьбы по дате рождения",
};

function FeatureCard({ feature, canAccess, setCurrentPage, showToast }) {
  const accessible = canAccess(feature.tier);
  return (
    <div onClick={() => {
      if (!accessible) {
        const msg = FEATURE_LOCK_TOASTS[feature.id] || `🔒 Нужен ${feature.tier === "premium" ? "Премиум" : "VIP"} тариф`;
        showToast(msg);
        return;
      }
      if (feature.page) setCurrentPage(feature.page);
    }} style={{
      background: "var(--card)", border: "1px solid var(--border)", borderRadius: 15,
      padding: "13px 12px", cursor: "pointer", textAlign: "center",
      transition: "all 0.2s", position: "relative", overflow: "hidden", opacity: accessible ? 1 : 0.75,
    }}
      onMouseEnter={e => e.currentTarget.style.transform = "translateY(-2px)"}
      onMouseLeave={e => e.currentTarget.style.transform = "translateY(0)"}
    >
      {!accessible && <div style={{ position: "absolute", top: 6, right: 6, fontSize: 10 }}>🔒</div>}
      <div style={{ fontSize: 24, marginBottom: 5 }}>{feature.emoji}</div>
      <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 2 }}>{feature.name}</div>
      <div style={{ fontSize: 10, color: "var(--text2)", marginBottom: 6 }}>{feature.desc}</div>
      <Badge tier={feature.tier} />
    </div>
  );
}


// ============================================================
// МИСТИЧЕСКОЕ РАССЛЕДОВАНИЕ — тизер на главной
// ============================================================
function InvestigationTeaser({ investigation, setCurrentPage }) {
  const hasStory = investigation && investigation.title;
  const progress = investigation?.progress || 0;

  return (
    <div
      onClick={() => setCurrentPage("investigation")}
      style={{
        background: "linear-gradient(135deg,rgba(15,10,30,0.95),rgba(10,20,40,0.95))",
        border: "1px solid rgba(139,92,246,0.35)",
        borderRadius: 16,
        padding: "14px 16px",
        cursor: "pointer",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Фоновый узор */}
      <div style={{ position: "absolute", right: -8, top: -8, fontSize: 64, opacity: 0.06 }}>🔍</div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <div style={{
          width: 36, height: 36, borderRadius: 10, flexShrink: 0,
          background: "linear-gradient(135deg,#4c1d95,#1e3a5f)",
          display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18,
        }}>🔍</div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 800, color: "var(--text)" }}>
            Мистическое расследование
          </div>
          <div style={{ fontSize: 10, color: "var(--text2)" }}>
            {hasStory ? `Эпизод недели · ${progress}/3 разгадано` : "Новое дело ждёт тебя"}
          </div>
        </div>
        <div style={{ marginLeft: "auto", fontSize: 11, color: "var(--accent)" }}>→</div>
      </div>

      {hasStory ? (
        <>
          <div style={{
            fontSize: 12, fontWeight: 700, color: "var(--gold2)", marginBottom: 4,
          }}>{investigation.title}</div>
          <div style={{
            fontSize: 11, color: "var(--text2)", lineHeight: 1.55,
            overflow: "hidden", display: "-webkit-box",
            WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
          }}>
            {investigation.hook || investigation.part1?.substring(0, 120) + "…"}
          </div>
          {/* Прогресс-бар */}
          <div style={{ marginTop: 10, height: 3, background: "rgba(139,92,246,0.15)", borderRadius: 2 }}>
            <div style={{
              height: "100%", borderRadius: 2,
              width: `${Math.round((progress / 3) * 100)}%`,
              background: "linear-gradient(90deg,#8b5cf6,#3b82f6)",
              transition: "width 0.4s",
            }} />
          </div>
        </>
      ) : (
        <div style={{ fontSize: 11, color: "var(--text2)", lineHeight: 1.55 }}>
          Каждую неделю — новая тайна, собранная специально для тебя.
          Гадай, чтобы раскрыть все три части детективной истории.
        </div>
      )}
    </div>
  );
}

// ============================================================
// ПОДЕЛИТЬСЯ КАРТОЙ
// ============================================================
function ShareCardButton({ card, sign, showToast }) {
  const [copied, setCopied] = useState(false);

  const BOT_URL = "https://t.me/mysticumbot";

  const handleShare = async () => {
    if (!card) return;
    const text = `✨ Моя карта дня — ${card.name}\n\n${card.keywords || card.upright || ""}\n\n${sign?.sign ? `#${sign.sign} ` : ""}#Мистикум #ТароДня`;
    const fullText = `${text}\n\n🔮 ${BOT_URL}`;

    // В Telegram Mini App — нативный шаринг с url-параметром (показывает превью ссылки)
    if (window.Telegram?.WebApp?.openTelegramLink) {
      const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(BOT_URL)}&text=${encodeURIComponent(text)}`;
      window.Telegram.WebApp.openTelegramLink(shareUrl);
      return;
    }

    // Fallback: копируем в буфер и показываем тост
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(fullText);
      } else {
        const ta = document.createElement("textarea");
        ta.value = fullText; ta.style.position = "fixed"; ta.style.opacity = "0";
        document.body.appendChild(ta); ta.focus(); ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopied(true);
      showToast?.("📋 Скопировано — вставь в историю!");
      setTimeout(() => setCopied(false), 2000);
    } catch { showToast?.("📋 Скопируй текст вручную"); }
  };

  return (
    <button onClick={handleShare} style={{
      marginTop: 8, width: "100%", padding: "8px 12px", borderRadius: 10,
      background: copied ? "rgba(34,197,94,0.1)" : "rgba(139,92,246,0.08)",
      border: `1px solid ${copied ? "rgba(34,197,94,0.3)" : "rgba(139,92,246,0.2)"}`,
      color: copied ? "#4ade80" : "var(--text2)", fontSize: 11, fontWeight: 700, cursor: "pointer",
      display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
      transition: "all 0.2s",
    }}>
      {copied ? "✅ Скопировано!" : "📤 Поделиться картой дня"}
    </button>
  );
}
