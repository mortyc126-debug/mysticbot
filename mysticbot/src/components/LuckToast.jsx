export default function LuckToast({ message }) {
  return (
    <div style={{
      position: "fixed", top: 90, left: "50%", transform: "translateX(-50%)",
      background: "rgba(245,158,11,0.15)", border: "1px solid rgba(245,158,11,0.3)",
      backdropFilter: "blur(16px)", borderRadius: 20, padding: "8px 18px",
      fontSize: 13, fontWeight: 700, color: "var(--gold2)", zIndex: 300,
      animation: "fadeInUp 0.3s ease", whiteSpace: "nowrap",
    }}>
      {message}
    </div>
  );
}
