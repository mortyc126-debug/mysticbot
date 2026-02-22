import { useState, useEffect } from "react";
import { Btn, Input } from "../components/UI";
import { ZODIAC_SIGNS } from "../data/tarot";
import { getZodiacSign } from "../hooks/useAppState";
import ClaudeAPI from "../api/claude";

const STEPS = [
  { id: "welcome",      title: null },
  { id: "name",         title: "Как тебя называть?" },
  { id: "birth",        title: "Дата рождения" },
  { id: "birthtime",    title: "Время рождения" },
  { id: "place",        title: "Место рождения" },
  { id: "gender",       title: "Твой пол" },
  { id: "focus",        title: "Что важнее всего?" },
  { id: "relationship", title: "Семейное положение" },
  { id: "done",         title: null },
];

const FOCUS_OPTIONS = [
  { v: "love",      e: "❤️",         l: "Любовь" },
  { v: "career",    e: "💼",         l: "Карьера" },
  { v: "finance",   e: "💰",         l: "Финансы" },
  { v: "health",    e: "🧘",         l: "Здоровье" },
  { v: "spiritual", e: "🌟",         l: "Духовность" },
  { v: "family",    e: "👨‍👩‍👧", l: "Семья" },
];

const FOCUS_LABELS = {
  love: "Любовь", career: "Карьера", finance: "Финансы",
  health: "Здоровье", spiritual: "Духовность", family: "Семья",
};

export default function Onboarding({ state, showToast }) {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({
    name: "", birth_date: "", birth_time: "", birth_place: "",
    gender: "", life_focus: [], relationship_status: "",
  });
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [agreePrivacy, setAgreePrivacy] = useState(false);
  const [agreeAge, setAgreeAge] = useState(false);

  // ── Ввод даты ────────────────────────────────────
  const [mDay,   setMDay]   = useState("");
  const [mMonth, setMMonth] = useState("");
  const [mYear,  setMYear]  = useState("");

  // Синхронизация ручного ввода → ISO дата YYYY-MM-DD
  useEffect(() => {
    const d = parseInt(mDay, 10);
    const m = parseInt(mMonth, 10);
    const y = parseInt(mYear, 10);
    const currentYear = new Date().getFullYear();
    if (d >= 1 && d <= 31 && m >= 1 && m <= 12 && y >= 1900 && y <= currentYear) {
      // Проверяем что дата реально существует (исключаем 30 февраля и т.п.)
      const testDate = new Date(y, m - 1, d);
      if (testDate.getFullYear() !== y || testDate.getMonth() + 1 !== m || testDate.getDate() !== d) {
        setForm(f => ({ ...f, birth_date: "" }));
        return;
      }
      const iso = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      setForm(f => ({ ...f, birth_date: iso }));
    } else {
      setForm(f => ({ ...f, birth_date: "" }));
    }
  }, [mDay, mMonth, mYear]);

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }));
  const next = () => setStep(s => s + 1);
  const prev = () => setStep(s => Math.max(0, s - 1));

  // ── Фокус: порядок выбора = приоритет ───────────────────
  const toggleFocus = (f) => {
    setForm(prev => ({
      ...prev,
      life_focus: prev.life_focus.includes(f)
        ? prev.life_focus.filter(x => x !== f)
        : prev.life_focus.length < 3
          ? [...prev.life_focus, f]
          : prev.life_focus,
    }));
  };

  // Возвращает 1, 2, 3 (приоритет) или null
  const focusPriority = (f) => {
    const idx = form.life_focus.indexOf(f);
    return idx >= 0 ? idx + 1 : null;
  };

  // ── Правильный предпросмотр знака зодиака ───────────────
  // БАГ ДО: ZODIAC_SIGNS[(month-1) % 12] — просто индекс месяца, игнорирует день
  // ИСПРАВЛЕНО: используем getZodiacSign() с корректной логикой
  const zodiacPreview = (() => {
    if (!form.birth_date) return null;
    const signName = getZodiacSign(form.birth_date);
    return ZODIAC_SIGNS.find(z => z.sign === signName) || null;
  })();

  const canNext = () => {
    const s = STEPS[step].id;
    if (s === "welcome" || s === "done") return true;
    if (s === "name") return form.name.trim().length > 1;
    if (s === "birth") return !!form.birth_date;
    if (s === "birthtime") return true;
    if (s === "place") return form.birth_place.trim().length > 1;
    if (s === "gender") return !!form.gender;
    if (s === "focus") return form.life_focus.length > 0;
    if (s === "relationship") return !!form.relationship_status;
    return true;
  };

  const finish = () => {
    state.completeRegistration(form);
    showToast("✨ Добро пожаловать! +10 удачи");
    // Рассчитываем знак Луны и Асцендент в фоне — один раз при регистрации
    if (form.birth_date) {
      ClaudeAPI.calculateNatalSigns({
        birthDate: form.birth_date,
        birthTime: form.birth_time || null,
        birthPlace: form.birth_place || null,
        sunSign: getZodiacSign(form.birth_date),
      }).then(result => {
        if (result) state.updateUser(result);
      }).catch(() => {});
    }
  };

  const stepId = STEPS[step].id;
  const showNav = stepId !== "welcome" && stepId !== "done";

  return (
    <div style={{
      height: "100dvh",
      background: "var(--bg)",
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
    }}>

      {/* ── Прогресс-бар (flexShrink: 0 — не сжимается) ──── */}
      {step > 0 && step < STEPS.length - 1 && (
        <div style={{ flexShrink: 0, padding: "14px 16px 6px" }}>
          <div style={{ background: "var(--bg3)", borderRadius: 20, height: 4, overflow: "hidden" }}>
            <div style={{
              height: "100%", borderRadius: 20,
              background: "linear-gradient(90deg,#8b5cf6,#f59e0b)",
              width: `${(step / (STEPS.length - 2)) * 100}%`,
              transition: "width 0.35s ease",
            }} />
          </div>
          <div style={{ fontSize: 11, color: "var(--text2)", marginTop: 5, textAlign: "right" }}>
            {step} / {STEPS.length - 2}
          </div>
        </div>
      )}

      {/* ── Прокручиваемый контент ────────────────────────── */}
      <div style={{
        flex: 1,
        overflowY: "auto",
        overflowX: "hidden",
        WebkitOverflowScrolling: "touch",
        padding: "0 16px",
      }}>

        {/* WELCOME */}
        {stepId === "welcome" && (
          <div style={{
            minHeight: "calc(100dvh - 40px)",
            display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center",
            textAlign: "center", gap: 16,
            animation: "fadeInUp 0.5s ease",
            paddingTop: 24, paddingBottom: 32,
          }}>
            <div style={{ fontSize: 72, animation: "float 3s ease-in-out infinite" }}>🔮</div>
            <h1 style={{
              fontSize: 30, fontWeight: 900,
              background: "linear-gradient(135deg,#8b5cf6,#f59e0b)",
              WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
            }}>
              Мистикум
            </h1>
            <p style={{ fontSize: 15, color: "var(--text2)", lineHeight: 1.7, maxWidth: 300 }}>
              Твой персональный проводник в мир астрологии, Таро и мистических предсказаний
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%", marginTop: 8 }}>
              {["🌟 Персональный гороскоп", "🃏 Гадание на Таро", "🖐️ Хиромантия", "📔 Дневник судьбы"].map(f => (
                <div key={f} style={{
                  background: "var(--card)", border: "1px solid var(--border)",
                  borderRadius: 12, padding: "10px 14px", fontSize: 13,
                  color: "var(--text)", textAlign: "left",
                }}>{f}</div>
              ))}
            </div>
            <p style={{ fontSize: 12, color: "var(--text2)", marginTop: 4 }}>
              Для персонализации нужно 2 минуты
            </p>
            <Btn onClick={next}>✨ Начать путь</Btn>
          </div>
        )}

        {/* NAME */}
        {stepId === "name" && (
          <div style={{ paddingTop: 28, animation: "slideInRight 0.3s ease" }}>
            <h2 style={{ fontSize: 22, fontWeight: 800, marginBottom: 8 }}>{STEPS[step].title}</h2>
            <p style={{ fontSize: 13, color: "var(--text2)", marginBottom: 24 }}>
              Звёзды хотят знать, как к тебе обращаться
            </p>
            <Input
              label="Имя или ник"
              value={form.name}
              onChange={v => set("name", v)}
              placeholder="Например: Анна"
            />
            {form.name.trim().length > 1 && (
              <div style={{ marginTop: 8, fontSize: 13, color: "var(--text2)", animation: "fadeIn 0.3s ease" }}>
                Привет,{" "}
                <span style={{ color: "var(--accent)", fontWeight: 700 }}>{form.name}</span>! 🌟
              </div>
            )}
          </div>
        )}

        {/* BIRTH DATE */}
        {stepId === "birth" && (
          <div style={{ paddingTop: 28, animation: "slideInRight 0.3s ease" }}>
            <h2 style={{ fontSize: 22, fontWeight: 800, marginBottom: 8 }}>{STEPS[step].title}</h2>
            <p style={{ fontSize: 13, color: "var(--text2)", marginBottom: 16 }}>
              Основа натальной карты — дата рождения
            </p>

            {/* Ввод даты: ДД / ММ / ГГГГ */}
            <div>
              <div style={{ fontSize: 12, color: "var(--text2)", marginBottom: 8, fontWeight: 600 }}>
                Дата рождения
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                {[
                  { label: "День",  val: mDay,   set: setMDay,   min: 1, max: 31, flex: 1 },
                  { label: "Месяц", val: mMonth, set: setMMonth, min: 1, max: 12, flex: 1 },
                  { label: "Год",   val: mYear,  set: setMYear,  min: 1900, max: new Date().getFullYear(), flex: 2 },
                ].map(({ label, val, set: setter, min, max, flex }) => (
                  <div key={label} style={{ flex }}>
                    <div style={{ fontSize: 10, color: "var(--text2)", marginBottom: 4 }}>{label}</div>
                    <input
                      type="number" min={min} max={max}
                      inputMode="numeric"
                      value={val} onChange={e => setter(e.target.value)}
                      style={{
                        width: "100%", padding: "12px 8px", borderRadius: 12, fontSize: 18,
                        background: "var(--bg3)", border: "1px solid var(--border)",
                        color: "var(--text)", outline: "none", textAlign: "center",
                        fontWeight: 700, WebkitAppearance: "none", MozAppearance: "textfield",
                      }}
                      onFocus={e => e.target.style.borderColor = "rgba(139,92,246,0.6)"}
                      onBlur={e => e.target.style.borderColor = "var(--border)"}
                    />
                  </div>
                ))}
              </div>
              {mDay && mMonth && mYear && !form.birth_date && (
                <div style={{ fontSize: 11, color: "#f87171", marginTop: 6 }}>
                  Проверь дату — что-то не так
                </div>
              )}
            </div>

            {/* Предпросмотр знака — теперь правильный */}
            {zodiacPreview && (
              <div style={{
                background: "var(--card)", border: "1px solid var(--border)",
                borderRadius: 14, padding: 14, marginTop: 16,
                animation: "fadeIn 0.3s ease",
                display: "flex", gap: 14, alignItems: "center",
              }}>
                <div style={{ fontSize: 36 }}>{zodiacPreview.symbol}</div>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 2 }}>
                    {zodiacPreview.sign}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text2)" }}>
                    {zodiacPreview.element} · {zodiacPreview.planet}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text2)", marginTop: 2 }}>
                    {zodiacPreview.dates}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* BIRTH TIME */}
        {stepId === "birthtime" && (
          <div style={{ paddingTop: 28, animation: "slideInRight 0.3s ease" }}>
            <h2 style={{ fontSize: 22, fontWeight: 800, marginBottom: 8 }}>{STEPS[step].title}</h2>
            <p style={{ fontSize: 13, color: "var(--text2)", marginBottom: 4 }}>
              Нужно для точного расчёта асцендента
            </p>
            <p style={{ fontSize: 12, color: "var(--text2)", marginBottom: 24 }}>
              Если не знаешь точно — пропусти или выбери примерно
            </p>
            <Input
              label="Время рождения (необязательно)"
              type="time"
              value={form.birth_time}
              onChange={v => set("birth_time", v)}
            />
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
              {[
                { l: "Утро (6–11)",   t: "08:00" },
                { l: "День (11–17)",  t: "13:00" },
                { l: "Вечер (17–22)", t: "19:00" },
                { l: "Ночь (22–6)",   t: "23:00" },
              ].map(({ l, t }) => (
                <div key={t} onClick={() => set("birth_time", t)} style={{
                  padding: "8px 14px", borderRadius: 10, fontSize: 12, cursor: "pointer",
                  background: form.birth_time === t ? "rgba(139,92,246,0.12)" : "var(--bg3)",
                  border: `1px solid ${form.birth_time === t ? "rgba(139,92,246,0.5)" : "var(--border)"}`,
                  color: form.birth_time === t ? "var(--accent)" : "var(--text2)",
                  fontWeight: form.birth_time === t ? 700 : 400,
                  transition: "all 0.2s",
                }}>{l}</div>
              ))}
            </div>
          </div>
        )}

        {/* PLACE */}
        {stepId === "place" && (
          <div style={{ paddingTop: 28, animation: "slideInRight 0.3s ease" }}>
            <h2 style={{ fontSize: 22, fontWeight: 800, marginBottom: 8 }}>{STEPS[step].title}</h2>
            <p style={{ fontSize: 13, color: "var(--text2)", marginBottom: 24 }}>
              Нужно для расчёта транзитов планет
            </p>
            <Input
              label="Город рождения"
              value={form.birth_place}
              onChange={v => set("birth_place", v)}
              placeholder="Например: Москва, Россия"
            />
          </div>
        )}

        {/* GENDER */}
        {stepId === "gender" && (
          <div style={{ paddingTop: 28, animation: "slideInRight 0.3s ease" }}>
            <h2 style={{ fontSize: 22, fontWeight: 800, marginBottom: 8 }}>{STEPS[step].title}</h2>
            <p style={{ fontSize: 13, color: "var(--text2)", marginBottom: 24 }}>
              Влияет на точность твоего предсказания
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {[
                { v: "female", l: "Женский",                  e: "♀️" },
                { v: "male",   l: "Мужской",                  e: "♂️" },
                { v: "other",  l: "Предпочитаю не указывать", e: "✨" },
              ].map(g => (
                <div key={g.v} onClick={() => set("gender", g.v)} style={{
                  padding: "14px 16px", borderRadius: 14, cursor: "pointer",
                  background: form.gender === g.v ? "rgba(139,92,246,0.12)" : "var(--card)",
                  border: `1px solid ${form.gender === g.v ? "rgba(139,92,246,0.5)" : "var(--border)"}`,
                  display: "flex", alignItems: "center", gap: 12, transition: "all 0.2s",
                }}>
                  <span style={{ fontSize: 24 }}>{g.e}</span>
                  <span style={{ fontSize: 14, fontWeight: 600 }}>{g.l}</span>
                  {form.gender === g.v && (
                    <span style={{ marginLeft: "auto", color: "var(--accent)", fontSize: 16 }}>✓</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* FOCUS */}
        {stepId === "focus" && (
          <div style={{ paddingTop: 28, animation: "slideInRight 0.3s ease" }}>
            <h2 style={{ fontSize: 22, fontWeight: 800, marginBottom: 6 }}>{STEPS[step].title}</h2>
            <p style={{ fontSize: 13, color: "var(--text2)", marginBottom: 4, lineHeight: 1.5 }}>
              Выбери до 3 сфер — порядок важен.
            </p>
            <p style={{ fontSize: 11, color: "var(--accent)", fontWeight: 700, marginBottom: 18 }}>
              Первый выбранный = главный приоритет прогнозов
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              {FOCUS_OPTIONS.map(f => {
                const priority = focusPriority(f.v);
                const sel = priority !== null;
                return (
                  <div key={f.v} onClick={() => toggleFocus(f.v)} style={{
                    padding: "14px 10px", borderRadius: 14, cursor: "pointer",
                    textAlign: "center", position: "relative",
                    background: sel ? "rgba(139,92,246,0.12)" : "var(--card)",
                    border: `1px solid ${sel ? "rgba(139,92,246,0.5)" : "var(--border)"}`,
                    transition: "all 0.2s",
                  }}>
                    {/* Бейдж приоритета */}
                    {sel && (
                      <div style={{
                        position: "absolute", top: 7, right: 7,
                        width: 20, height: 20, borderRadius: "50%",
                        background: "var(--accent)", color: "white",
                        fontSize: 11, fontWeight: 800,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        boxShadow: "0 0 6px rgba(139,92,246,0.5)",
                      }}>
                        {priority}
                      </div>
                    )}
                    <div style={{ fontSize: 26, marginBottom: 5 }}>{f.e}</div>
                    <div style={{
                      fontSize: 12, fontWeight: 700,
                      color: sel ? "var(--accent)" : "var(--text)",
                    }}>
                      {f.l}
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{
              fontSize: 11, color: "var(--text2)", marginTop: 10, textAlign: "center",
              minHeight: 18,
            }}>
              {form.life_focus.length === 0
                ? "Нажми на карточку, чтобы выбрать"
                : `${form.life_focus.map(f => FOCUS_LABELS[f]).join(" → ")} (${form.life_focus.length}/3)`
              }
            </div>
          </div>
        )}

        {/* RELATIONSHIP */}
        {stepId === "relationship" && (
          <div style={{ paddingTop: 28, animation: "slideInRight 0.3s ease" }}>
            <h2 style={{ fontSize: 22, fontWeight: 800, marginBottom: 8 }}>{STEPS[step].title}</h2>
            <p style={{ fontSize: 13, color: "var(--text2)", marginBottom: 24 }}>
              Влияет на интерпретацию любовных прогнозов
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
              {[
                { v: "single",       e: "🌸", l: "В поиске" },
                { v: "dating",       e: "💕", l: "Встречаюсь" },
                { v: "relationship", e: "❤️", l: "В отношениях" },
                { v: "married",      e: "💍", l: "Женат / Замужем" },
                { v: "complicated",  e: "🌀", l: "Всё сложно" },
                { v: "private",      e: "🔒", l: "Не хочу указывать" },
              ].map(r => (
                <div key={r.v} onClick={() => set("relationship_status", r.v)} style={{
                  padding: "12px 14px", borderRadius: 13, cursor: "pointer",
                  background: form.relationship_status === r.v ? "rgba(139,92,246,0.12)" : "var(--bg3)",
                  border: `1px solid ${form.relationship_status === r.v ? "rgba(139,92,246,0.5)" : "var(--border)"}`,
                  display: "flex", alignItems: "center", gap: 10, transition: "all 0.2s",
                }}>
                  <span style={{ fontSize: 20 }}>{r.e}</span>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{r.l}</span>
                  {form.relationship_status === r.v && (
                    <span style={{ marginLeft: "auto", color: "var(--accent)" }}>✓</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* DONE */}
        {stepId === "done" && (
          <div style={{
            minHeight: "calc(100dvh - 40px)",
            display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center",
            textAlign: "center", gap: 16,
            animation: "fadeInUp 0.5s ease",
            paddingTop: 24, paddingBottom: 32,
          }}>
            <div style={{ fontSize: 64, animation: "float 3s ease-in-out infinite" }}>🌟</div>
            <h2 style={{ fontSize: 26, fontWeight: 900 }}>
              Всё готово,{" "}
              <span style={{
                background: "linear-gradient(135deg,#8b5cf6,#f59e0b)",
                WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
              }}>
                {form.name}
              </span>!
            </h2>
            <p style={{ fontSize: 14, color: "var(--text2)", lineHeight: 1.7, maxWidth: 280 }}>
              Звёзды приняли твои данные. Персональный гороскоп и натальная карта уже готовятся...
            </p>

            <div style={{
              background: "var(--card)", border: "1px solid var(--border)",
              borderRadius: 16, padding: "16px 20px", width: "100%", textAlign: "left",
            }}>
              <div style={{
                fontSize: 11, color: "var(--text2)", marginBottom: 10, fontWeight: 700,
                textTransform: "uppercase", letterSpacing: "0.06em",
              }}>
                Твой профиль
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                {[
                  ["🌟", "Имя",    form.name],
                  ["✨", "Знак",   zodiacPreview?.sign],
                  ["📍", "Город",  form.birth_place],
                  ["🎯", "Фокус",  form.life_focus.map(f => FOCUS_LABELS[f]).join(" → ")],
                ].filter(([, , v]) => !!v).map(([e, k, v]) => (
                  <div key={k} style={{ display: "flex", gap: 8, fontSize: 13 }}>
                    <span>{e}</span>
                    <span style={{ color: "var(--text2)" }}>{k}:</span>
                    <span style={{ fontWeight: 600 }}>{v}</span>
                  </div>
                ))}
              </div>
            </div>

            <div style={{
              background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.25)",
              borderRadius: 12, padding: "10px 16px", fontSize: 13,
              color: "var(--gold2)", fontWeight: 700, width: "100%",
            }}>
              🎁 Стартовый бонус: +10 💫 удачи
            </div>

            {/* Чекбоксы согласий */}
            <div style={{
              display: "flex", flexDirection: "column", gap: 12,
              width: "100%", textAlign: "left",
            }}>
              <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer" }}>
                <input
                  type="checkbox" checked={agreeTerms} onChange={e => setAgreeTerms(e.target.checked)}
                  style={{ marginTop: 2, width: 18, height: 18, accentColor: "#8b5cf6", flexShrink: 0 }}
                />
                <span style={{ fontSize: 13, color: "var(--text2)", lineHeight: 1.5 }}>
                  Принимаю{" "}
                  <a href="https://telegra.ph/POLZOVATELSKOE-SOGLASHENIE-02-19-16" target="_blank" rel="noopener noreferrer"
                    style={{ color: "var(--accent)", textDecoration: "underline" }}>
                    пользовательское соглашение
                  </a>
                </span>
              </label>
              <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer" }}>
                <input
                  type="checkbox" checked={agreePrivacy} onChange={e => setAgreePrivacy(e.target.checked)}
                  style={{ marginTop: 2, width: 18, height: 18, accentColor: "#8b5cf6", flexShrink: 0 }}
                />
                <span style={{ fontSize: 13, color: "var(--text2)", lineHeight: 1.5 }}>
                  Принимаю{" "}
                  <a href="https://telegra.ph/POLITIKA-OBRABOTKI-PERSONALNYH-DANNYH-02-19-4" target="_blank" rel="noopener noreferrer"
                    style={{ color: "var(--accent)", textDecoration: "underline" }}>
                    политику обработки данных
                  </a>
                </span>
              </label>
              <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer" }}>
                <input
                  type="checkbox" checked={agreeAge} onChange={e => setAgreeAge(e.target.checked)}
                  style={{ marginTop: 2, width: 18, height: 18, accentColor: "#8b5cf6", flexShrink: 0 }}
                />
                <span style={{ fontSize: 13, color: "var(--text2)", lineHeight: 1.5 }}>
                  Подтверждаю, что мне исполнилось 18 лет
                </span>
              </label>
            </div>

            <Btn onClick={finish} size="lg" disabled={!(agreeTerms && agreePrivacy && agreeAge)}>🔮 Открыть Мистикум</Btn>
          </div>
        )}

        {/* Нижний отступ от кнопок навигации */}
        <div style={{ height: showNav ? 10 : 0 }} />
      </div>

      {/* ── Кнопки навигации — прикреплены к низу экрана ──── */}
      {showNav && (
        <div style={{
          flexShrink: 0,
          background: "var(--bg)",
          borderTop: "1px solid var(--border)",
          padding: "10px 16px",
          // env(safe-area-inset-bottom) — отступ для iPhone с динамическим островом / notch
          paddingBottom: "calc(10px + env(safe-area-inset-bottom, 12px))",
        }}>
          <div style={{ display: "flex", gap: 10 }}>
            <Btn onClick={prev} variant="ghost" style={{ flex: 1 }}>← Назад</Btn>
            <Btn onClick={next} disabled={!canNext()} style={{ flex: 2 }}>
              {stepId === "relationship" ? "Завершить →" : "Далее →"}
            </Btn>
          </div>
        </div>
      )}
    </div>
  );
}
