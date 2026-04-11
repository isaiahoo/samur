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
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Unhandled React error:", error, info.componentStack);
    Sentry.captureException(error, { extra: { componentStack: info.componentStack } });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 24, textAlign: "center", marginTop: 80 }}>
          <h2>{i18n.t("error.title")}</h2>
          <p style={{ color: "#4b5563", marginTop: 8 }}>
            {i18n.t("error.description")}
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
            {i18n.t("error.reload")}
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
