import { Component } from "react";

// ============================================================
// ERROR BOUNDARY — перехватывает ошибки рендера компонентов
// ============================================================

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error("[Мистикум] Ошибка компонента:", error.message, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: "flex", flexDirection: "column", alignItems: "center",
          justifyContent: "center", height: "100dvh", padding: 24,
          background: "var(--bg)", textAlign: "center",
        }}>
          <div style={{
            fontSize: 72, marginBottom: 20,
            animation: "float 3s ease-in-out infinite",
          }}>🔮</div>

          <h2 style={{ fontSize: 20, fontWeight: 800, marginBottom: 10, color: "var(--text)" }}>
            Что-то пошло не так
          </h2>
          <p style={{
            fontSize: 13, color: "var(--text2)", lineHeight: 1.6,
            marginBottom: 28, maxWidth: 280,
          }}>
            Звёзды временно молчат. Попробуй обновить страницу — послание дойдёт.
          </p>

          <button
            onClick={() => window.location.reload()}
            style={{
              background: "linear-gradient(135deg,#8b5cf6,#6d28d9)",
              color: "white", border: "none", borderRadius: 14,
              padding: "13px 28px", fontSize: 14, fontWeight: 700,
              cursor: "pointer", marginBottom: 12,
              boxShadow: "0 4px 14px rgba(139,92,246,0.35)",
            }}
          >
            ✦ Обновить
          </button>

          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            style={{
              background: "transparent", color: "var(--text2)",
              border: "1px solid var(--border)", borderRadius: 14,
              padding: "10px 28px", fontSize: 13, fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Попробовать снова
          </button>

          {import.meta.env?.DEV && this.state.error && (
            <div style={{
              marginTop: 20, padding: "10px 14px", background: "rgba(239,68,68,0.08)",
              border: "1px solid rgba(239,68,68,0.2)", borderRadius: 10,
              fontSize: 11, color: "#f87171", textAlign: "left", maxWidth: "100%",
              wordBreak: "break-word", fontFamily: "monospace",
            }}>
              {this.state.error.message}
            </div>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}
