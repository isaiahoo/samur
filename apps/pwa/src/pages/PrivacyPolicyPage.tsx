// SPDX-License-Identifier: AGPL-3.0-only
import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useNavigate } from "react-router-dom";
// Imports the monorepo-root legal/privacy-policy.md as raw text. Single
// source of truth — the same markdown drives the legal audit trail and
// this page. Vite resolves via the @legal alias (see vite.config.ts).
import privacyRaw from "@legal/privacy-policy.md?raw";

/** Placeholders in the privacy-policy.md template. The operator fills
 * these in before the page is actually linked from anywhere visible.
 * Keeping them in a runtime constants object rather than hard-coded
 * into the markdown means legal text can be updated (and re-audited)
 * without a code change, and code can be updated (e.g. new contact
 * email) without a legal-text edit. */
const OPERATOR_SUBSTITUTIONS: Record<string, string> = {
  "{{ДАТА_ВСТУПЛЕНИЯ}}": "TODO.TODO.TODO",
  "{{ДАТА_ОБНОВЛЕНИЯ}}": "TODO.TODO.TODO",
  "{{ИНН_ОПЕРАТОРА}}": "TODO ПОДСТАВИТЬ ИНН",
  "{{ПОЧТОВЫЙ_АДРЕС}}": "TODO ПОДСТАВИТЬ ПОЧТОВЫЙ АДРЕС",
  "{{EMAIL_ОПЕРАТОРА}}": "privacy@mykunak.ru",
  "{{ТЕЛЕФОН_ОПЕРАТОРА}}": "—",
};

/** Strip the two appendix sections that are operator-facing checklists,
 * not user-facing legal text. Anything from the "Что нужно подставить
 * перед публикацией" heading onward belongs in docs, not in the public
 * /privacy page. */
function renderPublicPolicy(raw: string, subs: Record<string, string>): string {
  // Cut at the first operator-checklist heading — keep the Приложение
  // (processor registry) which IS part of the public policy.
  const cutMarker = "# 📋 Что нужно подставить";
  const cutAt = raw.indexOf(cutMarker);
  const bodyOnly = cutAt === -1 ? raw : raw.slice(0, cutAt).trimEnd();

  let out = bodyOnly;
  for (const [placeholder, value] of Object.entries(subs)) {
    out = out.split(placeholder).join(value);
  }
  return out;
}

export function PrivacyPolicyPage() {
  const navigate = useNavigate();
  const markdown = useMemo(
    () => renderPublicPolicy(privacyRaw, OPERATOR_SUBSTITUTIONS),
    [],
  );
  const hasPlaceholders = markdown.includes("TODO");

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

      {hasPlaceholders && (
        <div className="privacy-page-warning" role="status">
          <strong>Черновик.</strong> Политика содержит незаполненные поля
          (ФИО, ИНН, адрес). До публикации необходимо подставить значения
          в <code>PrivacyPolicyPage.tsx</code>.
        </div>
      )}

      <article className="privacy-page-content">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
      </article>
    </div>
  );
}
