// SPDX-License-Identifier: AGPL-3.0-only
import { useState, useEffect, useRef, useCallback } from "react";
import type { HelpMessage } from "@samur/shared";
import {
  getHelpMessages,
  sendHelpMessage,
  markHelpMessagesRead,
  ApiError,
} from "../services/api.js";
import { useSocketEvent } from "../hooks/useSocket.js";
import { useUIStore } from "../store/ui.js";

interface Props {
  requestId: string;
  // Client's best guess for initial render — avoids the "loading → locked"
  // flash for strangers. The real gate is the server's response; see effect.
  canParticipate: boolean;
  currentUserId: string | null;
}

type ChatState = "loading" | "locked" | "error" | "ready";

const ROLE_BADGES: Record<string, string> = {
  coordinator: "Координатор",
  admin: "Админ",
};

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function HelpChat({ requestId, canParticipate, currentUserId }: Props) {
  const [state, setState] = useState<ChatState>(canParticipate ? "loading" : "locked");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [messages, setMessages] = useState<HelpMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const showToast = useUIStore((s) => s.showToast);

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
    });
  }, []);

  // Always attempt the fetch regardless of client-side canParticipate guess.
  // The server is the source of truth on access (handles admin/coord case too).
  // If 403 → show locked card; if OK → show chat; anything else → error.
  useEffect(() => {
    let cancelled = false;
    getHelpMessages(requestId, { limit: 50 })
      .then((res) => {
        if (cancelled) return;
        setMessages((res.data as HelpMessage[]) ?? []);
        setState("ready");
        scrollToBottom();
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 403) {
          setState("locked");
          return;
        }
        const msg = err instanceof Error ? err.message : "Не удалось загрузить сообщения";
        setErrorMsg(msg);
        setState("error");
      });
    return () => { cancelled = true; };
    // canParticipate is in deps so a stranger who just responded retries.
  }, [requestId, canParticipate, scrollToBottom]);

  // Mark this thread as read on mount and whenever a new message arrives.
  useEffect(() => {
    if (state !== "ready") return;
    markHelpMessagesRead(requestId).catch(() => { /* silent */ });
  }, [requestId, messages.length, state]);

  // Live updates via socket — ignored unless we're in the ready state.
  useSocketEvent("help_message:created", (msg) => {
    if (msg.helpRequestId !== requestId) return;
    if (state !== "ready") return;
    setMessages((prev) => {
      if (prev.some((m) => m.id === msg.id)) return prev;
      return [...prev, msg];
    });
    scrollToBottom();
  });

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed || sending) return;
    setSending(true);
    try {
      const res = await sendHelpMessage(requestId, trimmed);
      const sent = res.data as HelpMessage | undefined;
      if (sent) {
        setMessages((prev) => (prev.some((m) => m.id === sent.id) ? prev : [...prev, sent]));
        scrollToBottom();
      }
      setDraft("");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Ошибка отправки", "error");
    } finally {
      setSending(false);
    }
  };

  // ── Locked state: calm, explanatory, points at the respond button. ─────
  if (state === "locked") {
    return (
      <div className="help-chat-locked">
        <div className="help-chat-locked-icon" aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </div>
        <h4 className="help-chat-locked-title">Закрытое обсуждение</h4>
        <p className="help-chat-locked-body">
          Чат открывается после отклика — так мы защищаем приватность заявителя
          и не отвлекаем его посторонними сообщениями.
        </p>
        <p className="help-chat-locked-hint">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 4, verticalAlign: "-2px" }}>
            <line x1="12" y1="5" x2="12" y2="19" />
            <polyline points="19 12 12 19 5 12" />
          </svg>
          Нажмите «Откликнуться» внизу — и чат сразу откроется.
        </p>
      </div>
    );
  }

  // ── Error state: compact, less alarming than before, allows retry. ────
  if (state === "error") {
    return (
      <div className="help-chat">
        <h4 className="help-chat-title">Обсуждение</h4>
        <p className="help-chat-inline-error">
          {errorMsg ?? "Не удалось загрузить сообщения"}
        </p>
      </div>
    );
  }

  // ── Loading: brief placeholder while the first fetch is in flight. ────
  if (state === "loading") {
    return (
      <div className="help-chat">
        <h4 className="help-chat-title">Обсуждение</h4>
        <div className="help-chat-list">
          <p className="help-chat-hint">Загрузка…</p>
        </div>
      </div>
    );
  }

  // ── Ready: full chat UI. ──────────────────────────────────────────────
  return (
    <div className="help-chat">
      <h4 className="help-chat-title">
        Обсуждение
        {messages.length > 0 && <span className="help-chat-count"> · {messages.length}</span>}
      </h4>

      <div className="help-chat-list" ref={listRef}>
        {messages.length === 0 ? (
          <p className="help-chat-hint">
            Сообщений пока нет. Напишите первое — чтобы согласовать встречу или
            уточнить детали, если телефон не отвечает.
          </p>
        ) : (
          messages.map((m) => {
            const isMine = m.authorId === currentUserId;
            const roleBadge = m.author?.role ? ROLE_BADGES[m.author.role] : null;
            return (
              <div key={m.id} className={`help-chat-msg ${isMine ? "help-chat-msg--mine" : ""}`}>
                {!isMine && (
                  <div className="help-chat-msg-meta">
                    <span className="help-chat-msg-author">{m.author?.name ?? "—"}</span>
                    {roleBadge && <span className="help-chat-msg-role"> · {roleBadge}</span>}
                  </div>
                )}
                <div className="help-chat-msg-body">{m.body}</div>
                <div className="help-chat-msg-time">{formatTime(m.createdAt)}</div>
              </div>
            );
          })
        )}
      </div>

      <form className="help-chat-composer" onSubmit={handleSend}>
        <textarea
          className="help-chat-input"
          placeholder="Сообщение…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={2}
          maxLength={2000}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend(e);
            }
          }}
        />
        <button
          type="submit"
          className="btn btn-primary btn-sm help-chat-send"
          disabled={!draft.trim() || sending}
        >
          {sending ? "…" : "Отправить"}
        </button>
      </form>
    </div>
  );
}
