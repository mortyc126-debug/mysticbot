export default function BottomNav({ currentPage, setCurrentPage, badges = {} }) {
  const tabs = [
    { id: "tarot",     icon: "🃏", label: "Таро"      },
    { id: "community", icon: "🌐", label: "Сообщество" },
    { id: "home",      icon: "🏠", label: "Главная"   },
    { id: "feed",      icon: "✨", label: "Лента"     },
    { id: "profile",   icon: "👤", label: "Я"         },
  ];
  return (
    <div style={{
      position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)",
      width: "100%", maxWidth: 430,
      background: "rgba(10,10,15,0.96)", backdropFilter: "blur(20px)",
      borderTop: "1px solid var(--border)",
      display: "flex", padding: "8px 4px", paddingBottom: "calc(8px + env(safe-area-inset-bottom, 0px))", zIndex: 100,
    }}>
      {tabs.map(tab => (
        <div key={tab.id} onClick={() => setCurrentPage(tab.id)} style={{
          flex: 1, display: "flex", flexDirection: "column", alignItems: "center",
          gap: 2, cursor: "pointer", padding: "4px 2px", borderRadius: 11,
          transition: "all 0.2s", position: "relative",
          background: currentPage === tab.id ? "rgba(139,92,246,0.08)" : "transparent",
        }}>
          <span style={{ fontSize: 17, lineHeight: 1 }}>{tab.icon}</span>
          <span style={{
            fontSize: 8, fontWeight: currentPage === tab.id ? 800 : 600,
            color: currentPage === tab.id ? "var(--accent)" : "var(--text2)",
          }}>{tab.label}</span>
          {currentPage === tab.id && (
            <div style={{ width: 4, height: 4, background: "var(--accent)", borderRadius: "50%", boxShadow: "0 0 4px var(--accent)" }} />
          )}
          {/* Бейдж непрочитанных сообщений */}
          {badges[tab.id] > 0 && (
            <div style={{
              position: "absolute", top: 2, right: "50%", marginRight: -16,
              minWidth: 16, height: 16, borderRadius: 8,
              background: "#ef4444", border: "1.5px solid rgba(10,10,15,0.96)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 9, fontWeight: 800, color: "white",
              padding: "0 4px", boxSizing: "border-box",
            }}>
              {badges[tab.id] > 99 ? "99+" : badges[tab.id]}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
