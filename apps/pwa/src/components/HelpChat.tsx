// SPDX-License-Identifier: AGPL-3.0-only
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import type { HelpMessage } from "@samur/shared";
import {
  getHelpMessages,
  sendHelpMessage,
  markHelpMessagesRead,
  uploadPhotos,
  ApiError,
} from "../services/api.js";
import { useSocketEvent } from "../hooks/useSocket.js";
import { useOnline } from "../hooks/useOnline.js";
import { useUIStore } from "../store/ui.js";
import { useNavigate } from "react-router-dom";
import { compressImage } from "../utils/compressImage.js";
import { ImageLightbox } from "./ImageLightbox.js";

interface Props {
  requestId: string;
  canParticipate: boolean;
  currentUserId: string | null;
  stickyComposer?: boolean;
}

type ChatState = "loading" | "locked" | "error" | "ready";

const ROLE_BADGES: Record<string, string> = {
  coordinator: "Координатор",
  admin: "Админ",
};

const MAX_PHOTOS = 5;
const PAGE_SIZE = 50;

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

/** Day label for separator headers. "Сегодня" / "Вчера" / "15 мая". */
function formatDayLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOf(now) - startOf(d)) / 86_400_000);
  if (diffDays === 0) return "Сегодня";
  if (diffDays === 1) return "Вчера";
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
}

function sameDay(a: string, b: string): boolean {
  const ad = new Date(a); const bd = new Date(b);
  return ad.getFullYear() === bd.getFullYear()
    && ad.getMonth() === bd.getMonth()
    && ad.getDate() === bd.getDate();
}

/** Optimistic in-flight message — present only on the client until the
 * server either confirms (we drop it on the socket/REST echo) or fails
 * (we flip to status="failed" and surface a retry button). */
interface PendingMessage {
  kind: "pending";
  tempId: string;
  body: string;
  photoUrls: string[];
  createdAt: string;
  status: "sending" | "failed";
  errorMsg?: string;
}

type DisplayItem =
  | { kind: "message"; msg: HelpMessage }
  | PendingMessage
  | { kind: "day-header"; label: string; key: string };

export function HelpChat({ requestId, canParticipate, currentUserId, stickyComposer }: Props) {
  const rootClass = `help-chat${stickyComposer ? " help-chat--inline" : ""}`;
  const [state, setState] = useState<ChatState>(canParticipate ? "loading" : "locked");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [messages, setMessages] = useState<HelpMessage[]>([]);
  const [pending, setPending] = useState<PendingMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<File[]>([]);
  const [lightbox, setLightbox] = useState<{ urls: string[]; index: number } | null>(null);

  const listRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const online = useOnline();
  const showToast = useUIStore((s) => s.showToast);
  const navigate = useNavigate();

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
    });
  }, []);

  // Initial fetch. Server is the source of truth on access.
  useEffect(() => {
    let cancelled = false;
    getHelpMessages(requestId, { limit: PAGE_SIZE })
      .then((res) => {
        if (cancelled) return;
        const items = (res.data as HelpMessage[]) ?? [];
        setMessages(items);
        setHasMore(items.length >= PAGE_SIZE);
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
  }, [requestId, canParticipate, scrollToBottom]);

  // Mark as read on mount + whenever a new inbound message lands.
  useEffect(() => {
    if (state !== "ready") return;
    markHelpMessagesRead(requestId).catch(() => { /* silent */ });
  }, [requestId, messages.length, state]);

  useSocketEvent("help_message:created", (msg) => {
    if (msg.helpRequestId !== requestId) return;
    if (state !== "ready") return;
    setMessages((prev) => {
      if (prev.some((m) => m.id === msg.id)) return prev;
      return [...prev, msg];
    });
    scrollToBottom();
  });

  const loadEarlier = useCallback(async () => {
    if (loadingEarlier || messages.length === 0) return;
    setLoadingEarlier(true);
    try {
      const oldest = messages[0].createdAt;
      const res = await getHelpMessages(requestId, { limit: PAGE_SIZE, before: oldest });
      const older = (res.data as HelpMessage[]) ?? [];
      setMessages((prev) => [...older, ...prev]);
      setHasMore(older.length >= PAGE_SIZE);
    } catch {
      showToast("Не удалось загрузить историю", "error");
    } finally {
      setLoadingEarlier(false);
    }
  }, [loadingEarlier, messages, requestId, showToast]);

  /** Attempt an actual send. Uploads photos (if any) then POSTs. */
  const performSend = useCallback(async (p: PendingMessage) => {
    let photoUrls: string[] = [];
    if (p.photoUrls.length > 0) {
      // p.photoUrls at this point are local blob URLs for preview only.
      // The real payload lives in attachments captured with this pending.
      // (We route through the retry closure; see handleSend / retry.)
    }
    // No-op fallback — handleSend/retry use sendOne() directly.
    return photoUrls;
  }, []);
  // Mark performSend as intentionally unused in the default path so it
  // doesn't trip lint; the retry path rebuilds the closure.
  void performSend;

  /** Full send pipeline: take files + body, upload, POST, reconcile. */
  const sendOne = useCallback(async (
    files: File[],
    body: string,
    tempId: string,
  ): Promise<void> => {
    const updatePending = (patch: Partial<PendingMessage>) =>
      setPending((prev) => prev.map((p) => (p.tempId === tempId ? { ...p, ...patch } : p)));

    try {
      let photoUrls: string[] = [];
      if (files.length > 0) {
        const compressed = await Promise.all(files.map((f) => compressImage(f)));
        photoUrls = await uploadPhotos(compressed);
      }
      await sendHelpMessage(requestId, { body, photoUrls });
      // Server broadcasts via socket; we drop the pending row once the
      // confirmed message arrives. But if the socket is down we'd leave
      // it pending forever, so also drop on REST success — de-dup by
      // tempId when the socket echo arrives.
      setPending((prev) => prev.filter((p) => p.tempId !== tempId));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Ошибка отправки";
      updatePending({ status: "failed", errorMsg: msg });
    }
  }, [requestId]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = draft.trim();
    const files = attachments;
    if (!trimmed && files.length === 0) return;
    if (!online) {
      showToast("Нет соединения", "error");
      return;
    }

    const tempId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const previewUrls = files.map((f) => URL.createObjectURL(f));
    const pendingEntry: PendingMessage = {
      kind: "pending",
      tempId,
      body: trimmed,
      photoUrls: previewUrls,
      createdAt: new Date().toISOString(),
      status: "sending",
    };
    setPending((prev) => [...prev, pendingEntry]);
    setDraft("");
    setAttachments([]);
    scrollToBottom();

    await sendOne(files, trimmed, tempId);
    // Revoke object URLs — the server-echo will render the real URL
    // instead. Delay briefly so the visual transition is smooth.
    setTimeout(() => previewUrls.forEach((u) => URL.revokeObjectURL(u)), 1000);
  };

  const retrySend = async (p: PendingMessage) => {
    // When a pending fails we no longer have the original File objects
    // (only blob URLs). For a clean retry, fall back to re-fetching the
    // blobs from the object URLs. Most browsers keep them alive while
    // the blob still has references.
    try {
      const files = await Promise.all(
        p.photoUrls.map(async (url, i) => {
          const res = await fetch(url);
          const blob = await res.blob();
          return new File([blob], `photo-${i}.jpg`, { type: blob.type });
        }),
      );
      setPending((prev) => prev.map((x) => (x.tempId === p.tempId ? { ...x, status: "sending", errorMsg: undefined } : x)));
      await sendOne(files, p.body, p.tempId);
    } catch {
      showToast("Не удалось повторить отправку", "error");
    }
  };

  const discardPending = (tempId: string) => {
    setPending((prev) => {
      const target = prev.find((p) => p.tempId === tempId);
      if (target) target.photoUrls.forEach((u) => URL.revokeObjectURL(u));
      return prev.filter((p) => p.tempId !== tempId);
    });
  };

  const handlePickPhotos = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;
    const remaining = MAX_PHOTOS - attachments.length;
    if (remaining <= 0) {
      showToast(`Максимум ${MAX_PHOTOS} фото в одном сообщении`, "error");
      return;
    }
    const picked = files.slice(0, remaining);
    if (files.length > remaining) {
      showToast(`Добавлено только ${remaining} из ${files.length} — лимит 5`, "info");
    }
    setAttachments((prev) => [...prev, ...picked]);
  };

  const removeAttachment = (idx: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== idx));
  };

  // Build the chronological display list with day separators.
  const displayItems = useMemo<DisplayItem[]>(() => {
    const all: Array<{ msg?: HelpMessage; pending?: PendingMessage; createdAt: string }> = [
      ...messages.map((m) => ({ msg: m, createdAt: m.createdAt })),
      ...pending.map((p) => ({ pending: p, createdAt: p.createdAt })),
    ];
    all.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));

    const out: DisplayItem[] = [];
    let lastIso: string | null = null;
    for (const item of all) {
      if (!lastIso || !sameDay(lastIso, item.createdAt)) {
        out.push({ kind: "day-header", label: formatDayLabel(item.createdAt), key: `day-${item.createdAt}` });
        lastIso = item.createdAt;
      }
      if (item.msg) out.push({ kind: "message", msg: item.msg });
      else if (item.pending) out.push(item.pending);
    }
    return out;
  }, [messages, pending]);

  const attachmentPreviews = useMemo(
    () => attachments.map((f) => ({ file: f, url: URL.createObjectURL(f) })),
    [attachments],
  );
  useEffect(() => {
    return () => { attachmentPreviews.forEach((p) => URL.revokeObjectURL(p.url)); };
  }, [attachmentPreviews]);

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

  if (state === "error") {
    return (
      <div className={rootClass}>
        <h4 className="help-chat-title">Обсуждение</h4>
        <p className="help-chat-inline-error">{errorMsg ?? "Не удалось загрузить сообщения"}</p>
      </div>
    );
  }

  if (state === "loading") {
    return (
      <div className={rootClass}>
        <h4 className="help-chat-title">Обсуждение</h4>
        <div className="help-chat-list">
          <p className="help-chat-hint">Загрузка…</p>
        </div>
      </div>
    );
  }

  const totalVisible = messages.length + pending.length;
  const canSend = (draft.trim().length > 0 || attachments.length > 0) && online;

  return (
    <div className={rootClass}>
      <h4 className="help-chat-title">
        Обсуждение
        {totalVisible > 0 && <span className="help-chat-count"> · {messages.length}</span>}
      </h4>

      {!online && (
        <div className="help-chat-offline-banner" role="status">
          Нет соединения. Сообщения появятся, когда связь восстановится.
        </div>
      )}

      <div className="help-chat-list" ref={listRef}>
        {hasMore && (
          <div className="help-chat-load-earlier">
            <button
              type="button"
              className="help-chat-load-earlier-btn"
              onClick={loadEarlier}
              disabled={loadingEarlier}
            >
              {loadingEarlier ? "Загрузка…" : "Показать ранние сообщения"}
            </button>
          </div>
        )}

        {totalVisible === 0 ? (
          <p className="help-chat-hint">
            Сообщений пока нет. Напишите первое — чтобы согласовать встречу или
            уточнить детали, если телефон не отвечает.
          </p>
        ) : (
          displayItems.map((item, idx) => {
            if (item.kind === "day-header") {
              return (
                <div key={item.key} className="help-chat-day-header" aria-label={item.label}>
                  <span>{item.label}</span>
                </div>
              );
            }
            if (item.kind === "pending") {
              return (
                <div key={item.tempId} className={`help-chat-msg help-chat-msg--mine help-chat-msg--${item.status}`}>
                  {item.photoUrls.length > 0 && (
                    <PhotoGrid urls={item.photoUrls} onOpen={(i) => setLightbox({ urls: item.photoUrls, index: i })} />
                  )}
                  {item.body && <div className="help-chat-msg-body">{item.body}</div>}
                  <div className="help-chat-msg-time">
                    {item.status === "sending" && <span className="help-chat-msg-status">отправляется…</span>}
                    {item.status === "failed" && (
                      <span className="help-chat-msg-status help-chat-msg-status--failed">
                        не отправлено ·{" "}
                        <button type="button" className="help-chat-msg-retry" onClick={() => retrySend(item)}>повторить</button>
                        {" · "}
                        <button type="button" className="help-chat-msg-retry" onClick={() => discardPending(item.tempId)}>удалить</button>
                      </span>
                    )}
                  </div>
                </div>
              );
            }
            const m = item.msg;
            const isMine = m.authorId === currentUserId;
            const roleBadge = m.author?.role ? ROLE_BADGES[m.author.role] : null;
            const photoUrls = m.photoUrls ?? [];
            return (
              <div key={m.id} className={`help-chat-msg ${isMine ? "help-chat-msg--mine" : ""}`}>
                {!isMine && (
                  <div className="help-chat-msg-meta">
                    {m.authorId ? (
                      <button
                        type="button"
                        className="help-chat-msg-author help-chat-msg-author--link"
                        onClick={() => navigate(`/profile/${m.authorId}`)}
                      >
                        {m.author?.name ?? "—"}
                      </button>
                    ) : (
                      <span className="help-chat-msg-author">{m.author?.name ?? "—"}</span>
                    )}
                    {roleBadge && <span className="help-chat-msg-role"> · {roleBadge}</span>}
                  </div>
                )}
                {photoUrls.length > 0 && (
                  <PhotoGrid urls={photoUrls} onOpen={(i) => setLightbox({ urls: photoUrls, index: i })} />
                )}
                {m.body && <div className="help-chat-msg-body">{m.body}</div>}
                <div className="help-chat-msg-time">{formatTime(m.createdAt)}</div>
              </div>
            );
            void idx;
          })
        )}
      </div>

      {attachments.length > 0 && (
        <div className="help-chat-attachments" role="list" aria-label="Прикреплённые фото">
          {attachmentPreviews.map((p, i) => (
            <div key={p.url} className="help-chat-attachment" role="listitem">
              <img src={p.url} alt="" />
              <button
                type="button"
                className="help-chat-attachment-remove"
                onClick={() => removeAttachment(i)}
                aria-label="Убрать фото"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <form className="help-chat-composer" onSubmit={handleSend}>
        <button
          type="button"
          className="help-chat-attach-btn"
          onClick={() => fileInputRef.current?.click()}
          disabled={attachments.length >= MAX_PHOTOS}
          aria-label="Прикрепить фото"
          title="Прикрепить фото"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
          </svg>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
          multiple
          style={{ display: "none" }}
          onChange={handlePickPhotos}
        />
        <textarea
          className="help-chat-input"
          placeholder={attachments.length > 0 ? "Подпись (необязательно)…" : "Сообщение…"}
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
          disabled={!canSend}
        >
          Отправить
        </button>
      </form>

      {lightbox && (
        <ImageLightbox
          urls={lightbox.urls}
          initialIndex={lightbox.index}
          onClose={() => setLightbox(null)}
        />
      )}
    </div>
  );
}

function PhotoGrid({ urls, onOpen }: { urls: string[]; onOpen: (i: number) => void }) {
  return (
    <div className={`help-chat-photos help-chat-photos--${Math.min(urls.length, 4)}`}>
      {urls.map((url, i) => (
        <button
          key={url + i}
          type="button"
          className="help-chat-photo"
          onClick={() => onOpen(i)}
          aria-label={`Открыть фото ${i + 1}`}
        >
          <img src={url} alt="" loading="lazy" />
        </button>
      ))}
    </div>
  );
}
