export default function BottomNav({ currentPage, setCurrentPage }) {
  const tabs = [
    { id: "tarot",     icon: "🃏", label: "Таро"     },
    { id: "astrology", icon: "🌟", label: "Астро"    },
    { id: "home",      icon: "🏠", label: "Главная"  },
    { id: "feed",      icon: "✨", label: "Лента"    },
    { id: "diary",     icon: "📔", label: "Дневник"  },
    { id: "profile",   icon: "👤", label: "Я"        },
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
          transition: "all 0.2s",
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
        </div>
      ))}
    </div>
  );
}
