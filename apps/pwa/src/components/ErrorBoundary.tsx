// SPDX-License-Identifier: AGPL-3.0-only
import { Component } from "react";
import type { ReactNode, ErrorInfo } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Unhandled React error:", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 24, textAlign: "center", marginTop: 80 }}>
          <h2>Что-то пошло не так</h2>
          <p style={{ color: "#64748b", marginTop: 8 }}>
            Произошла непредвиденная ошибка. Попробуйте обновить страницу.
          </p>
          <button
            style={{
              marginTop: 16,
              padding: "10px 24px",
              background: "#2563eb",
              color: "#fff",
              border: "none",
              borderRadius: 8,
              fontSize: 16,
              cursor: "pointer",
            }}
            onClick={() => window.location.reload()}
          >
            Обновить страницу
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
