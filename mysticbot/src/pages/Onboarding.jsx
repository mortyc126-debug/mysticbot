import { useState, useEffect } from "react";
import { Btn, Input } from "../components/UI";
import { ZODIAC_SIGNS } from "../data/tarot";
import { getZodiacSign } from "../hooks/useAppState";
import ClaudeAPI from "../api/claude";
import { syncUser } from "../api/backend";

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

// 0 = welcome, 1 = form, 2 = done
export default function Onboarding({ state, showToast }) {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({
    name: "", birth_date: "", birth_time: "", birth_place: "",
    gender: "", life_focus: [], relationship_status: "",
  });
  const [agreeTerms,   setAgreeTerms]   = useState(true);
  const [agreePrivacy, setAgreePrivacy] = useState(true);
  const [agreeAge,     setAgreeAge]     = useState(true);

  const [mDay,   setMDay]   = useState("");
  const [mMonth, setMMonth] = useState("");
  const [mYear,  setMYear]  = useState("");

  useEffect(() => {
    const d = parseInt(mDay, 10);
    const m = parseInt(mMonth, 10);
    const y = parseInt(mYear, 10);
    const currentYear = new Date().getFullYear();
    if (d >= 1 && d <= 31 && m >= 1 && m <= 12 && y >= 1900 && y <= currentYear) {
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

  const focusPriority = (f) => {
    const idx = form.life_focus.indexOf(f);
    return idx >= 0 ? idx + 1 : null;
  };

  const zodiacPreview = (() => {
    if (!form.birth_date) return null;
    const signName = getZodiacSign(form.birth_date);
    return ZODIAC_SIGNS.find(z => z.sign === signName) || null;
  })();

  const canFinish = form.name.trim().length > 1 && !!form.birth_date && !!form.gender
    && form.life_focus.length > 0 && !!form.relationship_status
    && agreeTerms && agreePrivacy && agreeAge;

  // Шаг 1 → показать экран "Готово" (данные не сохраняем ещё)
  const goToDone = () => {
    showToast("✨ Добро пожаловать! +10 удачи");
    setStep(2);
  };

  // Экран "Готово" → реальное завершение регистрации
  const finish = () => {
    state.completeRegistration(form);
    if (form.birth_date) {
      ClaudeAPI.calculateNatalSigns({
        birthDate: form.birth_date,
        birthTime: form.birth_time || null,
        birthPlace: form.birth_place || null,
        sunSign: getZodiacSign(form.birth_date),
      }).then(result => {
        if (result) {
          state.updateUser(result);
          syncUser({
            moon_sign: result.moon_sign,
            ascendant: result.ascendant,
            birth_time: form.birth_time || null,
            birth_place: form.birth_place || null,
          }).catch(() => {});
        } else if (form.birth_time || form.birth_place) {
          syncUser({
            birth_time: form.birth_time || null,
            birth_place: form.birth_place || null,
          }).catch(() => {});
        }
      }).catch(() => {
        if (form.birth_time || form.birth_place) {
          syncUser({
            birth_time: form.birth_time || null,
            birth_place: form.birth_place || null,
          }).catch(() => {});
        }
      });
    }
  };

  // ─────── WELCOME ───────────────────────────────────────────
  if (step === 0) return (
    <div style={{
      height: "100dvh", background: "var(--bg)",
      display: "flex", flexDirection: "column",
      overflow: "hidden",
    }}>
      <div style={{
        flex: 1, overflowY: "auto", padding: "0 16px",
        WebkitOverflowScrolling: "touch",
      }}>
        <div style={{
          minHeight: "100dvh",
          display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center",
          textAlign: "center", gap: 14,
          paddingTop: 32, paddingBottom: 40,
          animation: "fadeInUp 0.5s ease",
        }}>
          {/* Logo */}
          <div style={{ fontSize: 72, animation: "float 3s ease-in-out infinite" }}>🔮</div>
          <h1 style={{
            fontSize: 30, fontWeight: 900,
            background: "linear-gradient(135deg,#8b5cf6,#f59e0b)",
            WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
            margin: 0,
          }}>
            Мистикум
          </h1>

          {/* Tagline */}
          <p style={{ fontSize: 15, color: "var(--text2)", lineHeight: 1.7, maxWidth: 300, margin: 0 }}>
            Персональный гороскоп, Таро и советы звёзд — каждый день, только для тебя
          </p>

          {/* Social proof */}
          <div style={{
            display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap",
          }}>
            {[["⭐⭐⭐⭐⭐", "47 000+ пользователей"], ["🔮", "1 200 000+ предсказаний"], ["💫", "98% довольных"]].map(([e, t]) => (
              <div key={t} style={{
                background: "var(--card)", border: "1px solid var(--border)",
                borderRadius: 10, padding: "6px 12px", fontSize: 11, color: "var(--text2)",
                display: "flex", alignItems: "center", gap: 5,
              }}>
                <span style={{ fontSize: 13 }}>{e}</span>{t}
              </div>
            ))}
          </div>

          {/* Benefits */}
          <div style={{ display: "flex", flexDirection: "column", gap: 7, width: "100%" }}>
            {[
              ["🌟", "Персональный гороскоп", "каждый день точно для твоего знака"],
              ["🃏", "Гадание на Таро",       "расклады с AI-интерпретацией"],
              ["🖐️", "Хиромантия и Аура",    "анализ по фото"],
              ["📔", "Дневник судьбы",        "отслеживай сбывшиеся предсказания"],
            ].map(([e, title, sub]) => (
              <div key={title} style={{
                background: "var(--card)", border: "1px solid var(--border)",
                borderRadius: 12, padding: "10px 14px",
                display: "flex", alignItems: "center", gap: 12, textAlign: "left",
              }}>
                <span style={{ fontSize: 22, flexShrink: 0 }}>{e}</span>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>{title}</div>
                  <div style={{ fontSize: 11, color: "var(--text2)" }}>{sub}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Review */}
          <div style={{
            background: "rgba(139,92,246,0.07)", border: "1px solid rgba(139,92,246,0.2)",
            borderRadius: 14, padding: "12px 16px", textAlign: "left", width: "100%",
          }}>
            <div style={{ fontSize: 12, color: "var(--text2)", lineHeight: 1.6, fontStyle: "italic" }}>
              «Мистикум точно предсказал перемены в карьере. Каждый день читаю прогноз — стало любимой утренней привычкой»
            </div>
            <div style={{ fontSize: 11, color: "var(--accent)", fontWeight: 700, marginTop: 6 }}>
              — Анна К., Москва ⭐⭐⭐⭐⭐
            </div>
          </div>

          <p style={{ fontSize: 11, color: "var(--text2)", margin: 0 }}>
            Персонализация займёт 2 минуты — один раз
          </p>
          <Btn onClick={() => setStep(1)} size="lg">✨ Начать — это бесплатно</Btn>
        </div>
      </div>
    </div>
  );

  // ─────── DONE ──────────────────────────────────────────────
  if (step === 2) return (
    <div style={{
      height: "100dvh", background: "var(--bg)",
      display: "flex", flexDirection: "column", overflow: "hidden",
    }}>
      <div style={{
        flex: 1, overflowY: "auto", padding: "0 16px",
        WebkitOverflowScrolling: "touch",
      }}>
        <div style={{
          minHeight: "100dvh",
          display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center",
          textAlign: "center", gap: 16,
          animation: "fadeInUp 0.5s ease",
          paddingTop: 24, paddingBottom: 40,
        }}>
          <div style={{ fontSize: 64, animation: "float 3s ease-in-out infinite" }}>🌟</div>
          <h2 style={{ fontSize: 26, fontWeight: 900, margin: 0 }}>
            Всё готово,{" "}
            <span style={{
              background: "linear-gradient(135deg,#8b5cf6,#f59e0b)",
              WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
            }}>
              {form.name}
            </span>!
          </h2>
          <p style={{ fontSize: 14, color: "var(--text2)", lineHeight: 1.7, maxWidth: 280, margin: 0 }}>
            Звёзды приняли твои данные. Персональный гороскоп и натальная карта уже готовятся…
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
                ["🌟", "Имя",   form.name],
                ["✨", "Знак",  zodiacPreview?.sign],
                ["📍", "Город", form.birth_place],
                ["🎯", "Фокус", form.life_focus.map(f => FOCUS_LABELS[f]).join(" → ")],
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

          <Btn onClick={finish} size="lg">🔮 Открыть Мистикум</Btn>
        </div>
      </div>
    </div>
  );

  // ─────── FORM (step === 1) ─────────────────────────────────
  return (
    <div style={{
      height: "100dvh", background: "var(--bg)",
      display: "flex", flexDirection: "column", overflow: "hidden",
    }}>
      {/* Header */}
      <div style={{ flexShrink: 0, padding: "14px 16px 8px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button onClick={() => setStep(0)} style={{
            background: "none", border: "none", color: "var(--text2)",
            fontSize: 18, cursor: "pointer", padding: "0 4px",
          }}>←</button>
          <div style={{ flex: 1, fontSize: 16, fontWeight: 800 }}>Твои данные</div>
          <div style={{ fontSize: 11, color: "var(--text2)" }}>✦ 2 мин</div>
        </div>
        <div style={{ marginTop: 8, background: "var(--bg3)", borderRadius: 20, height: 4, overflow: "hidden" }}>
          <div style={{
            height: "100%", borderRadius: 20,
            background: "linear-gradient(90deg,#8b5cf6,#f59e0b)",
            width: canFinish ? "100%" : "40%",
            transition: "width 0.35s ease",
          }} />
        </div>
      </div>

      {/* Scrollable form content */}
      <div style={{
        flex: 1, overflowY: "auto", overflowX: "hidden",
        WebkitOverflowScrolling: "touch",
        padding: "0 16px",
      }}>

        {/* ── Имя ──────────────────────────────────────────── */}
        <Section label="Как тебя называть?">
          <Input
            label="Имя или ник"
            value={form.name}
            onChange={v => set("name", v)}
            placeholder="Например: Анна"
          />
          {form.name.trim().length > 1 && (
            <div style={{ marginTop: 6, fontSize: 12, color: "var(--text2)", animation: "fadeIn 0.3s ease" }}>
              Привет, <span style={{ color: "var(--accent)", fontWeight: 700 }}>{form.name}</span>! 🌟
            </div>
          )}
        </Section>

        {/* ── Дата рождения ─────────────────────────────── */}
        <Section label="Дата рождения">
          <div style={{ display: "flex", gap: 8 }}>
            {[
              { label: "День",  val: mDay,   set: setMDay,   min: 1, max: 31,   flex: 1 },
              { label: "Месяц", val: mMonth, set: setMMonth, min: 1, max: 12,   flex: 1 },
              { label: "Год",   val: mYear,  set: setMYear,  min: 1900, max: new Date().getFullYear(), flex: 2 },
            ].map(({ label, val, set: setter, min, max, flex }) => (
              <div key={label} style={{ flex }}>
                <div style={{ fontSize: 10, color: "var(--text2)", marginBottom: 4 }}>{label}</div>
                <input
                  type="number" min={min} max={max} inputMode="numeric"
                  value={val} onChange={e => setter(e.target.value)}
                  style={{
                    width: "100%", padding: "12px 8px", borderRadius: 12, fontSize: 18,
                    background: "var(--bg3)", border: "1px solid var(--border)",
                    color: "var(--text)", outline: "none", textAlign: "center",
                    fontWeight: 700, WebkitAppearance: "none", MozAppearance: "textfield",
                    boxSizing: "border-box",
                  }}
                  onFocus={e => e.target.style.borderColor = "rgba(139,92,246,0.6)"}
                  onBlur={e => e.target.style.borderColor = "var(--border)"}
                />
              </div>
            ))}
          </div>
          {mDay && mMonth && mYear && !form.birth_date && (
            <div style={{ fontSize: 11, color: "#f87171", marginTop: 6 }}>Проверь дату — что-то не так</div>
          )}
          {zodiacPreview && (
            <div style={{
              background: "var(--card)", border: "1px solid var(--border)",
              borderRadius: 12, padding: "10px 14px", marginTop: 10,
              animation: "fadeIn 0.3s ease", display: "flex", gap: 12, alignItems: "center",
            }}>
              <div style={{ fontSize: 30 }}>{zodiacPreview.symbol}</div>
              <div>
                <div style={{ fontSize: 15, fontWeight: 800 }}>{zodiacPreview.sign}</div>
                <div style={{ fontSize: 11, color: "var(--text2)" }}>{zodiacPreview.element} · {zodiacPreview.planet}</div>
                <div style={{ fontSize: 10, color: "var(--text2)" }}>{zodiacPreview.dates}</div>
              </div>
            </div>
          )}
        </Section>

        {/* ── Время рождения ─────────────────────────────── */}
        <Section label="Время рождения" hint="Необязательно — для точного асцендента">
          <Input
            label="Время рождения (необязательно)"
            type="time"
            value={form.birth_time}
            onChange={v => set("birth_time", v)}
          />
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
            {[
              { l: "Утро",   t: "08:00" },
              { l: "День",   t: "13:00" },
              { l: "Вечер",  t: "19:00" },
              { l: "Ночь",   t: "23:00" },
            ].map(({ l, t }) => (
              <div key={t} onClick={() => set("birth_time", t)} style={{
                padding: "7px 12px", borderRadius: 10, fontSize: 12, cursor: "pointer",
                background: form.birth_time === t ? "rgba(139,92,246,0.12)" : "var(--bg3)",
                border: `1px solid ${form.birth_time === t ? "rgba(139,92,246,0.5)" : "var(--border)"}`,
                color: form.birth_time === t ? "var(--accent)" : "var(--text2)",
                fontWeight: form.birth_time === t ? 700 : 400, transition: "all 0.2s",
              }}>{l}</div>
            ))}
          </div>
        </Section>

        {/* ── Место рождения ─────────────────────────────── */}
        <Section label="Город рождения" hint="Необязательно — для расчёта транзитов">
          <Input
            label="Город рождения (необязательно)"
            value={form.birth_place}
            onChange={v => set("birth_place", v)}
            placeholder="Например: Москва"
          />
        </Section>

        {/* ── Пол ─────────────────────────────────────────── */}
        <Section label="Твой пол">
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {[
              { v: "female", l: "Женский",                  e: "♀️" },
              { v: "male",   l: "Мужской",                  e: "♂️" },
              { v: "other",  l: "Предпочитаю не указывать", e: "✨" },
            ].map(g => (
              <div key={g.v} onClick={() => set("gender", g.v)} style={{
                padding: "12px 14px", borderRadius: 12, cursor: "pointer",
                background: form.gender === g.v ? "rgba(139,92,246,0.12)" : "var(--card)",
                border: `1px solid ${form.gender === g.v ? "rgba(139,92,246,0.5)" : "var(--border)"}`,
                display: "flex", alignItems: "center", gap: 12, transition: "all 0.2s",
              }}>
                <span style={{ fontSize: 22 }}>{g.e}</span>
                <span style={{ fontSize: 14, fontWeight: 600 }}>{g.l}</span>
                {form.gender === g.v && <span style={{ marginLeft: "auto", color: "var(--accent)", fontSize: 16 }}>✓</span>}
              </div>
            ))}
          </div>
        </Section>

        {/* ── Жизненные приоритеты ───────────────────────── */}
        <Section label="Что важнее всего?" hint="Выбери до 3 сфер — порядок определяет приоритет">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {FOCUS_OPTIONS.map(f => {
              const priority = focusPriority(f.v);
              const sel = priority !== null;
              return (
                <div key={f.v} onClick={() => toggleFocus(f.v)} style={{
                  padding: "12px 10px", borderRadius: 12, cursor: "pointer",
                  textAlign: "center", position: "relative",
                  background: sel ? "rgba(139,92,246,0.12)" : "var(--card)",
                  border: `1px solid ${sel ? "rgba(139,92,246,0.5)" : "var(--border)"}`,
                  transition: "all 0.2s",
                }}>
                  {sel && (
                    <div style={{
                      position: "absolute", top: 6, right: 6,
                      width: 18, height: 18, borderRadius: "50%",
                      background: "var(--accent)", color: "white",
                      fontSize: 10, fontWeight: 800,
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>{priority}</div>
                  )}
                  <div style={{ fontSize: 24, marginBottom: 4 }}>{f.e}</div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: sel ? "var(--accent)" : "var(--text)" }}>{f.l}</div>
                </div>
              );
            })}
          </div>
          {form.life_focus.length > 0 && (
            <div style={{ fontSize: 11, color: "var(--accent)", marginTop: 8, textAlign: "center", fontWeight: 700 }}>
              {form.life_focus.map(f => FOCUS_LABELS[f]).join(" → ")} ({form.life_focus.length}/3)
            </div>
          )}
        </Section>

        {/* ── Семейное положение ────────────────────────── */}
        <Section label="Семейное положение">
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            {[
              { v: "single",       e: "🌸", l: "В поиске" },
              { v: "dating",       e: "💕", l: "Встречаюсь" },
              { v: "relationship", e: "❤️", l: "В отношениях" },
              { v: "married",      e: "💍", l: "Женат / Замужем" },
              { v: "complicated",  e: "🌀", l: "Всё сложно" },
              { v: "other",        e: "✨", l: "Другое" },
              { v: "private",      e: "🔒", l: "Не хочу указывать" },
            ].map(r => (
              <div key={r.v} onClick={() => set("relationship_status", r.v)} style={{
                padding: "11px 13px", borderRadius: 11, cursor: "pointer",
                background: form.relationship_status === r.v ? "rgba(139,92,246,0.12)" : "var(--bg3)",
                border: `1px solid ${form.relationship_status === r.v ? "rgba(139,92,246,0.5)" : "var(--border)"}`,
                display: "flex", alignItems: "center", gap: 10, transition: "all 0.2s",
              }}>
                <span style={{ fontSize: 18 }}>{r.e}</span>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{r.l}</span>
                {form.relationship_status === r.v && <span style={{ marginLeft: "auto", color: "var(--accent)" }}>✓</span>}
              </div>
            ))}
          </div>
        </Section>

        {/* ── Соглашения (предустановлены, можно снять) ── */}
        <Section label="Условия использования">
          <div style={{ background: "rgba(139,92,246,0.06)", border: "1px solid rgba(139,92,246,0.15)", borderRadius: 12, padding: "12px 14px", marginBottom: 4 }}>
            <div style={{ fontSize: 11, color: "var(--text2)", lineHeight: 1.6, marginBottom: 10 }}>
              Нажимая «Открыть Мистикум», ты принимаешь условия и даёшь согласие на обработку данных. Если не согласен — сними нужную галочку.
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
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
          </div>
        </Section>

        {/* ── Стартовый бонус ───────────────────────────── */}
        <div style={{
          background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.25)",
          borderRadius: 12, padding: "10px 16px", fontSize: 13,
          color: "var(--gold2)", fontWeight: 700, textAlign: "center",
          marginBottom: 14,
        }}>
          🎁 Стартовый бонус за регистрацию: +10 💫 удачи
        </div>

        {/* ── Кнопка завершения ─────────────────────────── */}
        <div style={{ paddingBottom: "calc(20px + env(safe-area-inset-bottom, 12px))" }}>
          {!canFinish && (
            <div style={{ fontSize: 11, color: "var(--text2)", textAlign: "center", marginBottom: 10 }}>
              {!form.name.trim() || form.name.trim().length < 2
                ? "✦ Укажи своё имя"
                : !form.birth_date
                  ? "✦ Укажи дату рождения"
                  : !form.gender
                    ? "✦ Выбери пол"
                    : form.life_focus.length === 0
                      ? "✦ Выбери хотя бы один приоритет"
                      : !form.relationship_status
                        ? "✦ Укажи семейное положение"
                        : !agreeTerms || !agreePrivacy || !agreeAge
                          ? "✦ Подтверди согласие"
                          : ""}
            </div>
          )}
          <Btn onClick={goToDone} size="lg" disabled={!canFinish}>🔮 Открыть Мистикум</Btn>
        </div>
      </div>
    </div>
  );
}

// Вспомогательный компонент — секция с заголовком
function Section({ label, hint, children }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ marginTop: 20, marginBottom: 10 }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: "var(--text)" }}>{label}</div>
        {hint && <div style={{ fontSize: 11, color: "var(--text2)", marginTop: 2 }}>{hint}</div>}
      </div>
      {children}
    </div>
  );
}
