// SPDX-License-Identifier: AGPL-3.0-only
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Voice memo capture via MediaRecorder.
 *
 * Browser support notes:
 *  - Chrome/Firefox/Edge: audio/webm; opus — works everywhere.
 *  - Safari (iOS 14.3+): audio/mp4 only. We probe MIME support and
 *    pick the first supported option. If nothing is supported, we
 *    render a disabled state with a hint.
 *
 * The recorder stops automatically at MAX_SECONDS so a forgotten
 * "record" gesture doesn't eat the upload quota.
 */

const MAX_SECONDS = 60;
const MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
];

function pickMime(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  for (const m of MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported?.(m)) return m;
  }
  return null;
}

interface Props {
  onSaved: (blob: Blob) => void | Promise<void>;
  existingUrl?: string | null;
  onRemove?: () => void;
  disabled?: boolean;
}

export function VoiceRecorder({ onSaved, existingUrl, onRemove, disabled = false }: Props) {
  const [state, setState] = useState<"idle" | "recording" | "uploading">("idle");
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const mediaRecRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
      if (stopTimeoutRef.current) clearTimeout(stopTimeoutRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const cleanup = useCallback(() => {
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
    if (stopTimeoutRef.current) { clearTimeout(stopTimeoutRef.current); stopTimeoutRef.current = null; }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    mediaRecRef.current = null;
    chunksRef.current = [];
  }, []);

  const start = useCallback(async () => {
    setError(null);
    const mime = pickMime();
    if (!mime) {
      setError("Запись аудио не поддерживается этим браузером");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const rec = new MediaRecorder(stream, { mimeType: mime });
      mediaRecRef.current = rec;
      chunksRef.current = [];

      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: mime });
        cleanup();
        if (blob.size === 0) {
          setState("idle");
          setSeconds(0);
          return;
        }
        setState("uploading");
        try {
          await onSaved(blob);
        } finally {
          setState("idle");
          setSeconds(0);
        }
      };

      rec.start();
      setState("recording");
      setSeconds(0);
      tickRef.current = setInterval(() => {
        setSeconds((s) => s + 1);
      }, 1000);
      stopTimeoutRef.current = setTimeout(() => {
        try { mediaRecRef.current?.stop(); } catch { /* already stopped */ }
      }, MAX_SECONDS * 1000);
    } catch (err) {
      setError(
        err instanceof Error && err.name === "NotAllowedError"
          ? "Доступ к микрофону не разрешён"
          : "Не удалось начать запись",
      );
      cleanup();
      setState("idle");
    }
  }, [onSaved, cleanup]);

  const stop = useCallback(() => {
    try { mediaRecRef.current?.stop(); } catch { /* already stopped */ }
  }, []);

  const cancelRecording = useCallback(() => {
    // Null-out handler so the blob isn't emitted after we stop.
    if (mediaRecRef.current) {
      mediaRecRef.current.onstop = null;
      try { mediaRecRef.current.stop(); } catch { /* already stopped */ }
    }
    cleanup();
    setState("idle");
    setSeconds(0);
  }, [cleanup]);

  // Playback for an already-attached recording.
  if (existingUrl && state === "idle") {
    return (
      <div className="voice-recorder voice-recorder--saved">
        <audio controls src={existingUrl} className="voice-player" preload="metadata" />
        {onRemove && (
          <button
            type="button"
            className="voice-remove-btn"
            onClick={onRemove}
            disabled={disabled}
            aria-label="Удалить аудио"
          >
            Заменить
          </button>
        )}
      </div>
    );
  }

  if (state === "uploading") {
    return (
      <div className="voice-recorder">
        <div className="voice-uploading">
          <div className="sos-spinner sos-spinner--sm" />
          <span>Загрузка...</span>
        </div>
      </div>
    );
  }

  if (state === "recording") {
    const mm = Math.floor(seconds / 60).toString().padStart(2, "0");
    const ss = (seconds % 60).toString().padStart(2, "0");
    return (
      <div className="voice-recorder">
        <div className="voice-recording-row">
          <span className="voice-rec-dot" aria-hidden="true" />
          <span className="voice-rec-time">{mm}:{ss}</span>
          <span className="voice-rec-max">/ {MAX_SECONDS}с</span>
        </div>
        <div className="voice-recording-actions">
          <button type="button" className="voice-stop-btn" onClick={stop}>
            Остановить и отправить
          </button>
          <button type="button" className="voice-cancel-btn" onClick={cancelRecording}>
            Отменить
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="voice-recorder">
      <button
        type="button"
        className="voice-start-btn"
        onClick={start}
        disabled={disabled}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
          <line x1="12" y1="19" x2="12" y2="23" />
          <line x1="8" y1="23" x2="16" y2="23" />
        </svg>
        Записать голосовое
      </button>
      {error && <p className="voice-error">{error}</p>}
    </div>
  );
}
