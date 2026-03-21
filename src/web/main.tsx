import React, { Component, ReactNode } from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App.tsx";
import "./styles.css";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

class RootErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    hasError: false,
    errorMessage: "",
  };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    const errorMessage = error instanceof Error ? error.message : "未知运行时错误";
    return {
      hasError: true,
      errorMessage,
    };
  }

  componentDidCatch(error: unknown) {
    console.error("RootErrorBoundary caught runtime error", error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            minHeight: "100vh",
            padding: "48px 24px",
            background: "#f7f8fc",
            color: "#1f2a44",
            fontFamily:
              '"SF Pro Display","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif',
          }}
        >
          <div
            style={{
              maxWidth: 960,
              margin: "0 auto",
              background: "#fff",
              border: "1px solid #d9def0",
              borderRadius: 20,
              padding: 24,
              boxShadow: "0 20px 60px rgba(49, 73, 137, 0.08)",
            }}
          >
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: "6px 12px",
                borderRadius: 999,
                background: "#f1edff",
                color: "#4f46e5",
                fontWeight: 600,
              }}
            >
              页面运行异常
            </div>
            <h1 style={{ marginTop: 20, marginBottom: 12, fontSize: 36 }}>前端没有正常渲染</h1>
            <p style={{ margin: 0, color: "#5d6b8a", lineHeight: 1.7 }}>
              这不是空白页，而是页面运行时抛出了异常。请把下面这段错误发给我，我继续定位。
            </p>
            <pre
              style={{
                marginTop: 20,
                padding: 16,
                borderRadius: 12,
                background: "#0f172a",
                color: "#e2e8f0",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {this.state.errorMessage}
            </pre>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RootErrorBoundary>
      <App />
    </RootErrorBoundary>
  </React.StrictMode>,
);
