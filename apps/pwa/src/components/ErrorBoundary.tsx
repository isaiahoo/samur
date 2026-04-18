// SPDX-License-Identifier: AGPL-3.0-only
import { Component } from "react";
import * as Sentry from "@sentry/react";
import i18n from "../i18n/index.js";
import type { ReactNode, ErrorInfo } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Unhandled React error:", error, info.componentStack);
    Sentry.captureException(error, { extra: { componentStack: info.componentStack } });
  }

  render() {
    if (this.state.hasError) {
      const msg = this.state.error?.message;
      return (
        <div style={{ padding: 24, textAlign: "center", marginTop: 80 }}>
          <h2>{i18n.t("error.title")}</h2>
          <p style={{ color: "#52525b", marginTop: 8 }}>
            {i18n.t("error.description")}
          </p>
          {msg && (
            <details style={{ marginTop: 12, textAlign: "left", maxWidth: 520, marginInline: "auto" }}>
              <summary style={{ cursor: "pointer", color: "#6b7280", fontSize: 13 }}>
                {i18n.t("error.technicalDetails")}
              </summary>
              <pre
                style={{
                  marginTop: 8, padding: 12, background: "#f4f4f5", color: "#18181b",
                  fontSize: 12, borderRadius: 6, whiteSpace: "pre-wrap", wordBreak: "break-word",
                }}
              >
                {msg}
              </pre>
            </details>
          )}
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
            {i18n.t("error.reload")}
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
