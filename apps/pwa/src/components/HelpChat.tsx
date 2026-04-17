// SPDX-License-Identifier: AGPL-3.0-only
import { useState, useEffect, useRef, useCallback } from "react";
import type { HelpMessage } from "@samur/shared";
import {
  getHelpMessages,
  sendHelpMessage,
  markHelpMessagesRead,
} from "../services/api.js";
import { useSocketEvent } from "../hooks/useSocket.js";
import { useUIStore } from "../store/ui.js";

interface Props {
  requestId: string;
  canParticipate: boolean;
  currentUserId: string | null;
}

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
  const [messages, setMessages] = useState<HelpMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const showToast = useUIStore((s) => s.showToast);

  const scrollToBottom = useCallback(() => {
    // Wait for layout so new message heights are measured.
    requestAnimationFrame(() => {
      if (listRef.current) {
        listRef.current.scrollTop = listRef.current.scrollHeight;
      }
    });
  }, []);

  // Initial load + mark-read.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getHelpMessages(requestId, { limit: 50 })
      .then((res) => {
        if (cancelled) return;
        setMessages((res.data as HelpMessage[]) ?? []);
        scrollToBottom();
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : "Не удалось загрузить сообщения";
        setError(msg);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [requestId, scrollToBottom]);

  // Mark this thread as read on mount and whenever a new message arrives.
  // Failure is silent — it's a UX nicety, not a critical path.
  useEffect(() => {
    if (!canParticipate) return;
    markHelpMessagesRead(requestId).catch(() => { /* silent */ });
  }, [requestId, messages.length, canParticipate]);

  // Live updates via socket.
  useSocketEvent("help_message:created", (msg) => {
    if (msg.helpRequestId !== requestId) return;
    setMessages((prev) => {
      // Dedup if we optimistically echoed our own send (shouldn't happen
      // because we append from server response, but cheap insurance).
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
        // Append immediately — socket echo will dedup on id.
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

  return (
    <div className="help-chat">
      <h4 className="help-chat-title">
        Обсуждение
        {messages.length > 0 && <span className="help-chat-count"> · {messages.length}</span>}
      </h4>

      <div className="help-chat-list" ref={listRef}>
        {loading ? (
          <p className="help-chat-hint">Загрузка…</p>
        ) : error ? (
          <p className="help-chat-error">{error}</p>
        ) : messages.length === 0 ? (
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

      {canParticipate ? (
        <form className="help-chat-composer" onSubmit={handleSend}>
          <textarea
            className="help-chat-input"
            placeholder="Сообщение…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={2}
            maxLength={2000}
            onKeyDown={(e) => {
              // Enter = send; Shift+Enter = newline.
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
      ) : (
        <p className="help-chat-hint">
          Чтобы писать в обсуждение — откликнитесь на заявку.
        </p>
      )}
    </div>
  );
}
