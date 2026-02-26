// =============================================
// ПЕРЕИСПОЛЬЗУЕМЫЕ UI КОМПОНЕНТЫ
// =============================================

import { useState } from "react";

// --- Русская плюрализация для слова "день" ---
export function pluralizeDays(n) {
  const abs = Math.abs(n);
  const lastTwo = abs % 100;
  const lastOne = abs % 10;
  if (lastTwo >= 11 && lastTwo <= 19) return "дней";
  if (lastOne === 1) return "день";
  if (lastOne >= 2 && lastOne <= 4) return "дня";
  return "дней";
}

// --- Card ---
export function Card({ children, style, onClick, glow }) {
  return (
    <div onClick={onClick} style={{
      background: "var(--card)",
      border: `1px solid ${glow ? "rgba(139,92,246,0.5)" : "var(--border)"}`,
      borderRadius: 18,
      padding: 16,
      position: "relative",
      overflow: "hidden",
      cursor: onClick ? "pointer" : "default",
      transition: "transform 0.2s, box-shadow 0.2s",
      boxShadow: glow ? "var(--glow)" : "none",
      ...style,
    }}
      onMouseEnter={e => { if (onClick) e.currentTarget.style.transform = "translateY(-2px)"; }}
      onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; }}
    >
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 1, background: "linear-gradient(90deg,transparent,rgba(139,92,246,0.4),transparent)" }} />
      {children}
    </div>
  );
}

// --- Button ---
export function Btn({ children, variant = "primary", onClick, style, disabled, size = "md" }) {
  const variants = {
    primary: { background: "linear-gradient(135deg,#8b5cf6,#6d28d9)", color: "white", boxShadow: "0 4px 14px rgba(139,92,246,0.35)" },
    gold: { background: "linear-gradient(135deg,#f59e0b,#d97706)", color: "white", boxShadow: "0 4px 14px rgba(245,158,11,0.25)" },
    ghost: { background: "transparent", border: "1px solid var(--border)", color: "var(--text2)" },
    danger: { background: "linear-gradient(135deg,#ef4444,#dc2626)", color: "white", boxShadow: "0 4px 14px rgba(239,68,68,0.25)" },
    success: { background: "linear-gradient(135deg,#22c55e,#16a34a)", color: "white", boxShadow: "0 4px 14px rgba(34,197,94,0.25)" },
  };
  const sizes = {
    sm: { padding: "7px 14px", fontSize: 12 },
    md: { padding: "12px 16px", fontSize: 13 },
    lg: { padding: "14px 20px", fontSize: 15 },
  };
  return (
    <button onClick={onClick} disabled={disabled} style={{
      width: "100%", border: "none", borderRadius: 13, fontWeight: 700,
      cursor: disabled ? "not-allowed" : "pointer",
      opacity: disabled ? 0.5 : 1,
      transition: "all 0.2s",
      display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
      ...variants[variant], ...sizes[size], ...style,
    }}
      onMouseEnter={e => { if (!disabled) e.currentTarget.style.transform = "translateY(-1px)"; }}
      onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; }}
      onMouseDown={e => { if (!disabled) e.currentTarget.style.transform = "scale(0.97)"; }}
      onMouseUp={e => { if (!disabled) e.currentTarget.style.transform = "translateY(-1px)"; }}
    >{children}</button>
  );
}

// --- Badge ---
// Тарифы: free (бесплатно) → vip 249₽ → premium 499₽
export function Badge({ tier }) {
  const cfg = {
    free:    { bg: "rgba(34,197,94,0.12)",  color: "#4ade80", border: "rgba(34,197,94,0.25)",  label: "Бесплатно" },
    vip:     { bg: "rgba(139,92,246,0.12)", color: "#a78bfa", border: "rgba(139,92,246,0.25)", label: "VIP" },
    premium: { bg: "rgba(245,158,11,0.12)", color: "#fbbf24", border: "rgba(245,158,11,0.25)", label: "Премиум" },
    basic:   { bg: "rgba(139,92,246,0.12)", color: "#a78bfa", border: "rgba(139,92,246,0.25)", label: "VIP" },
  };
  const c = cfg[tier] || cfg.free;
  return (
    <span style={{
      fontSize: 9, padding: "2px 7px", borderRadius: 9, fontWeight: 700,
      textTransform: "uppercase", letterSpacing: "0.05em",
      background: c.bg, color: c.color, border: `1px solid ${c.border}`,
    }}>{c.label}</span>
  );
}

// --- Section Label ---
export function SLabel({ children }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, fontWeight: 700, color: "var(--text2)", textTransform: "uppercase", letterSpacing: "0.1em" }}>
      {children}
      <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
    </div>
  );
}

// --- App Header ---
export function AppHeader({ title, luckPoints, streak }) {
  return (
    <div style={{
      position: "sticky", top: 0, zIndex: 50,
      background: "rgba(10,10,15,0.93)", backdropFilter: "blur(16px)",
      padding: "14px 16px 10px",
      borderBottom: "1px solid var(--border)",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <div style={{ fontSize: 19, fontWeight: 800, background: "linear-gradient(135deg,#8b5cf6,#f59e0b)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
          {title}
        </div>
        <div style={{
          display: "flex", alignItems: "center", gap: 5,
          background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.25)",
          borderRadius: 18, padding: "4px 10px", fontSize: 12, fontWeight: 700, color: "var(--gold2)", cursor: "pointer",
        }}>💫 {luckPoints} удачи</div>
      </div>
      {streak > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--text2)" }}>
          <span>🔥 {streak} {pluralizeDays(streak)} подряд</span>
          {Array.from({ length: Math.min(streak, 7) }).map((_, i) => (
            <div key={i} style={{
              width: 7, height: 7, borderRadius: "50%",
              background: i === Math.min(streak, 7) - 1 ? "var(--gold)" : "var(--accent)",
              boxShadow: i === Math.min(streak, 7) - 1 ? "0 0 5px var(--gold)" : "0 0 4px var(--accent)",
              animation: i === Math.min(streak, 7) - 1 ? "pulse 1.5s ease-in-out infinite" : "none",
            }} />
          ))}
        </div>
      )}
    </div>
  );
}

// --- Lock overlay for premium features ---
export function LockOverlay({ tier, onUpgrade }) {
  const labels = { basic: "Базовый тариф", vip: "VIP тариф", premium: "Премиум тариф" };
  return (
    <div style={{
      position: "absolute", inset: 0, background: "rgba(10,10,15,0.85)",
      backdropFilter: "blur(4px)", borderRadius: 18,
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      gap: 8, zIndex: 10, cursor: "pointer",
    }} onClick={onUpgrade}>
      <span style={{ fontSize: 28 }}>🔒</span>
      <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text2)" }}>Доступно в {labels[tier]}</div>
      <div style={{
        background: "linear-gradient(135deg,#8b5cf6,#6d28d9)", color: "white",
        padding: "7px 16px", borderRadius: 10, fontSize: 12, fontWeight: 700,
      }}>Открыть доступ</div>
    </div>
  );
}

// --- Modal ---
export function Modal({ open, onClose, children, title }) {
  if (!open) return null;
  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)",
      zIndex: 200, display: "flex", alignItems: "flex-end",
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background: "var(--bg2)", borderRadius: "24px 24px 0 0",
        width: "100%", maxWidth: 430, margin: "0 auto",
        border: "1px solid var(--border)", borderBottom: "none",
        animation: "slideUp 0.3s ease",
        maxHeight: "85dvh", display: "flex", flexDirection: "column",
      }}>
        <div style={{ padding: "16px 16px 0", flexShrink: 0 }}>
          <div style={{ width: 36, height: 4, background: "var(--border)", borderRadius: 2, margin: "0 auto 14px" }} />
          {title && <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 14 }}>{title}</div>}
        </div>
        <div style={{ overflowY: "auto", padding: "0 16px", paddingBottom: "calc(28px + env(safe-area-inset-bottom, 0px))", flex: 1 }}>
          {children}
        </div>
      </div>
    </div>
  );
}

// LuckToast — используется из ./LuckToast.jsx (единственный источник)

// --- Tarot Card Visual ---
export function TarotCardVisual({ card, position, size = "md", revealed = true, onClick }) {
  const [imgError, setImgError] = useState(false);

  const sizes = {
    sm: { width: 60, height: 90, fontSize: 20, nameFontSize: 7 },
    md: { width: 90, height: 135, fontSize: 32, nameFontSize: 8 },
    lg: { width: 110, height: 165, fontSize: 40, nameFontSize: 9 },
  };
  const s = sizes[size];
  const gradients = [
    "linear-gradient(160deg,#1a0a2e,#2d1b69)",
    "linear-gradient(160deg,#0a1628,#1e3a5f)",
    "linear-gradient(160deg,#1a0a1e,#4a1d4a)",
    "linear-gradient(160deg,#0a2018,#1a4a2e)",
    "linear-gradient(160deg,#1e0a0a,#4a1a1a)",
  ];
  const gradIdx = card ? card.id % gradients.length : 0;
  const isReversed = card?.reversed;
  // Показываем изображение только когда карта открыта, id известен, и загрузка не упала
  const showImage = revealed && card != null && !imgError;

  return (
    <div style={{ textAlign: "center", cursor: onClick ? "pointer" : "default" }} onClick={onClick}>
      {/* Бейдж перевёрнутой над картой */}
      {revealed && isReversed && (
        <div style={{
          fontSize: 9, fontWeight: 700, color: "#f87171",
          background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.3)",
          borderRadius: 6, padding: "1px 6px", display: "inline-block", marginBottom: 3,
          letterSpacing: "0.04em",
        }}>↕ перевёрнута</div>
      )}
      <div style={{
        width: s.width, height: s.height, borderRadius: 10,
        background: showImage ? "transparent" : (revealed ? gradients[gradIdx] : "linear-gradient(160deg,#1a1a27,#0a0a0f)"),
        border: `1px solid ${
          !revealed ? "rgba(139,92,246,0.2)" :
          isReversed ? "rgba(239,68,68,0.5)" : "rgba(139,92,246,0.45)"
        }`,
        boxShadow: revealed
          ? (isReversed ? "0 0 14px rgba(239,68,68,0.25)" : "0 4px 20px rgba(139,92,246,0.25)")
          : "none",
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        margin: "0 auto", transition: "transform 0.3s",
        animation: revealed ? (isReversed ? "cardFlipReversed 0.4s ease" : "cardFlip 0.4s ease") : "none",
        transform: isReversed ? "rotate(180deg)" : "none",
        position: "relative", overflow: "hidden",
      }}>
        {showImage ? (
          /* Изображение карты из public/tarot/{id}.png */
          <>
            <img
              src={`/tarot/${card.id}.jpg`}
              alt={card.name}
              onError={() => setImgError(true)}
              style={{
                width: "100%", height: "100%",
                objectFit: "contain", display: "block",
                borderRadius: 9,
              }}
            />
            {/* Градиентная подложка под название внизу карты */}
            <div style={{
              position: "absolute", bottom: 0, left: 0, right: 0,
              background: "linear-gradient(to top, rgba(0,0,0,0.75) 0%, transparent 100%)",
              padding: "14px 4px 4px",
              // Текст крутим обратно чтобы читался при перевёрнутой карте
              transform: isReversed ? "rotate(180deg)" : "none",
            }}>
              <div style={{
                fontSize: s.nameFontSize, color: "rgba(255,255,255,0.9)",
                fontWeight: 700, textAlign: "center", lineHeight: 1.2,
                textShadow: "0 1px 3px rgba(0,0,0,0.8)",
              }}>{card.name}</div>
            </div>
          </>
        ) : revealed && card ? (
          /* Fallback: эмодзи + название (если изображение не загрузилось) */
          <>
            <div style={{ fontSize: s.fontSize }}>{card.emoji}</div>
            <div style={{
              fontSize: s.nameFontSize, color: "rgba(255,255,255,0.5)",
              marginTop: 4, textAlign: "center", padding: "0 4px", lineHeight: 1.3,
              transform: isReversed ? "rotate(180deg)" : "none",
            }}>{card.name}</div>
          </>
        ) : (
          /* Рубашка карты */
          <div style={{ fontSize: s.fontSize, opacity: 0.2 }}>✦</div>
        )}
      </div>
      {position && (
        <div style={{ fontSize: 10, color: "var(--text2)", marginTop: isReversed ? 6 : 4 }}>
          {position}
        </div>
      )}
    </div>
  );
}

// --- Energy Bar ---
export function EnergyBar({ value, label }) {
  return (
    <div>
      <div style={{ background: "var(--bg3)", borderRadius: 20, height: 5, overflow: "hidden" }}>
        <div style={{
          height: "100%", borderRadius: 20,
          background: "linear-gradient(90deg,#8b5cf6,#f59e0b)",
          width: `${value}%`, boxShadow: "0 0 8px rgba(139,92,246,0.4)",
          transition: "width 1s ease",
        }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--text2)", marginTop: 4 }}>
        <span>{label || "⚡ Энергия дня"}</span>
        <span style={{ color: "#a78bfa" }}>{value}%</span>
      </div>
    </div>
  );
}

// --- Input field ---
export function Input({ label, value, onChange, type = "text", placeholder, options }) {
  if (options) {
    return (
      <div style={{ marginBottom: 14 }}>
        {label && <div style={{ fontSize: 12, color: "var(--text2)", marginBottom: 6, fontWeight: 600 }}>{label}</div>}
        <select value={value} onChange={e => onChange(e.target.value)} style={{
          width: "100%", padding: "11px 14px", borderRadius: 12, fontSize: 14,
          background: "var(--bg3)", border: "1px solid var(--border)", color: value ? "var(--text)" : "var(--text2)",
          appearance: "none", cursor: "pointer",
        }}>
          <option value="" style={{ color: "var(--text2)" }}>{placeholder || "Выбери..."}</option>
          {options.map(o => <option key={o.value || o} value={o.value || o}>{o.label || o}</option>)}
        </select>
      </div>
    );
  }
  return (
    <div style={{ marginBottom: 14 }}>
      {label && <div style={{ fontSize: 12, color: "var(--text2)", marginBottom: 6, fontWeight: 600 }}>{label}</div>}
      <input
        type={type} value={value} onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          width: "100%", padding: "11px 14px", borderRadius: 12, fontSize: 14,
          background: "var(--bg3)", border: "1px solid var(--border)", color: "var(--text)",
          outline: "none", transition: "border-color 0.2s",
        }}
        onFocus={e => e.target.style.borderColor = "rgba(139,92,246,0.6)"}
        onBlur={e => e.target.style.borderColor = "var(--border)"}
      />
    </div>
  );
}

// --- Skeleton (заглушка-плейсхолдер при загрузке) ---
export function Skeleton({ width = "100%", height = 16, radius = 8, style }) {
  return (
    <div style={{
      width, height, borderRadius: radius,
      background: "var(--bg3)",
      animation: "skeletonPulse 1.6s ease-in-out infinite",
      ...style,
    }} />
  );
}

// --- LoadingSpinner ---
export function LoadingSpinner({ size = 32, color = "var(--accent)", label }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
      <div style={{
        width: size, height: size, borderRadius: "50%",
        border: `3px solid rgba(139,92,246,0.15)`,
        borderTopColor: color,
        animation: "spin 0.9s linear infinite",
      }} />
      {label && <div style={{ fontSize: 12, color: "var(--text2)" }}>{label}</div>}
    </div>
  );
}

// --- PageLoader (полноэкранная загрузка при переключении страниц) ---
export function PageLoader() {
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "center",
      height: "60vh", flexDirection: "column", gap: 16,
    }}>
      <div style={{ fontSize: 40, animation: "float 2s ease-in-out infinite" }}>✦</div>
      <LoadingSpinner size={28} label="Загрузка..." />
    </div>
  );
}

// --- InfoRow (строка с иконкой и текстом) ---
export function InfoRow({ icon, label, value, style }) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "center",
      padding: "8px 0", borderBottom: "1px solid var(--border)", ...style,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text2)", fontSize: 13 }}>
        {icon && <span>{icon}</span>}
        <span>{label}</span>
      </div>
      <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>{value}</div>
    </div>
  );
}

export default { Card, Btn, Badge, SLabel, AppHeader, LockOverlay, Modal, TarotCardVisual, EnergyBar, Input, Skeleton, LoadingSpinner, PageLoader, InfoRow, pluralizeDays };
