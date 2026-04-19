// SPDX-License-Identifier: AGPL-3.0-only
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useNavigate } from "react-router-dom";
// Imports the monorepo-root legal/privacy-policy.md as raw text. Single
// source of truth — the same markdown drives the legal audit trail and
// this page. Vite resolves via the @legal alias (see vite.config.ts).
import privacyRaw from "@legal/privacy-policy.md?raw";

export function PrivacyPolicyPage() {
  const navigate = useNavigate();

  return (
    <div className="privacy-page">
      <div className="privacy-page-header">
        <button
          type="button"
          className="privacy-page-back"
          onClick={() => (window.history.length > 1 ? navigate(-1) : navigate("/"))}
          aria-label="Назад"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Назад
        </button>
      </div>

      <article className="privacy-page-content">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{privacyRaw}</ReactMarkdown>
      </article>
    </div>
  );
}
