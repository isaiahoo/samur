// SPDX-License-Identifier: AGPL-3.0-only
import { useState, useRef, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import { createSOS, sosFollowUp, uploadAudio, ApiError } from "../services/api.js";
import { addToOutbox } from "../services/db.js";
import { useOnline } from "../hooks/useOnline.js";
import { useUIStore } from "../store/ui.js";
import { MAKHACHKALA_CENTER } from "@samur/shared";
import { VoiceRecorder } from "./VoiceRecorder.js";

/**
 * Stages:
 *   idle    — just the FAB; hold-to-activate
 *   sending — post auth dispatched, waiting for server ACK
 *   sent    — server accepted; follow-up form is open (text + voice)
 *   error   — POST /sos failed; retry or give up
 *
 * The 4-button "situation picker" stage is gone. Emergency dispatch
 * goes out immediately on hold-complete; details get attached after
 * via POST /sos/:id/follow-up. Volunteers see the SOS appear on the
 * map instantly and the follow-up description arrives over socket
 * later if the author takes time to write it.
 */
type Stage = "idle" | "sending" | "sent" | "error";

const HOLD_DURATION = 1200;
const SOS_STATE_MARKER = "kunakSos";

export function SOSButton() {
  const reportFormOpen = useUIStore((s) => s.reportFormOpen);
  const [stage, setStage] = useState<Stage>("idle");
  const [holdProgress, setHoldProgress] = useState(0);
  const [location, setLocation] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [sentId, setSentId] = useState<string | null>(null);
  const [updateToken, setUpdateToken] = useState<string | null>(null);
  // True when the server returned an existing active SOS instead of
  // creating a new one. Drives the post-send copy so repeat-presses
  // read as "your signal is active" rather than "signal sent" (which
  // would be misleading — nothing new went out).
  const [wasExisting, setWasExisting] = useState(false);
  const [hintVisible, setHintVisible] = useState(false);

  // Follow-up form state (only meaningful in `sent` stage).
  const [description, setDescription] = useState("");
  const [savedDescription, setSavedDescription] = useState("");
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [savingText, setSavingText] = useState(false);
  const [audioUploading, setAudioUploading] = useState(false);

  const holdStartRef = useRef<number>(0);
  const holdRafRef = useRef<number>(0);
  const hintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const locationRef = useRef(location);
  locationRef.current = location;

  const online = useOnline();
  const onlineRef = useRef(online);
  onlineRef.current = online;
  const showToast = useUIStore((s) => s.showToast);
  const crisisMode = useUIStore((s) => s.crisisMode);

  const acquireLocation = useCallback(() => {
    if (locationRef.current) return;
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy });
      },
      () => { /* silent — we'll fall back to Makhachkala center */ },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 },
    );
  }, []);

  const sendSOS = useCallback(async () => {
    const loc = locationRef.current;
    const lat = loc?.lat ?? MAKHACHKALA_CENTER.lat;
    const lng = loc?.lng ?? MAKHACHKALA_CENTER.lng;
    setStage("sending");

    const batteryLevel = await getBatteryLevel();
    const payload: Record<string, unknown> = { lat, lng, batteryLevel };

    try {
      if (onlineRef.current) {
        const res = await createSOS(payload);
        const data = res.data as {
          id: string;
          updateToken?: string;
          existing?: boolean;
          description?: string | null;
          audioUrl?: string | null;
        } | undefined;
        setSentId(data?.id ?? null);
        setUpdateToken(data?.updateToken ?? null);
        setWasExisting(data?.existing === true);
        // Prefill description if re-opening an existing SOS so the
        // author can edit rather than retype. Strip the "SOS — " prefix
        // that the server adds on follow-up saves.
        if (data?.existing && typeof data.description === "string") {
          const existingDesc = data.description.replace(/^SOS\s*(?:—|-)\s*/, "").trim();
          setDescription(existingDesc);
          setSavedDescription(existingDesc);
        }
        if (data?.existing && typeof data.audioUrl === "string") {
          setAudioUrl(data.audioUrl);
        }
      } else {
        await addToOutbox({ endpoint: "/help-requests/sos", method: "POST", body: payload });
      }
      setStage("sent");
      try { navigator.vibrate?.([200, 100, 200]); } catch { /* ignore */ }
    } catch {
      setStage("error");
      showToast("Ошибка отправки SOS", "error");
    }
  }, [showToast]);

  // Long-press handlers
  const onHoldStart = useCallback(() => {
    holdStartRef.current = performance.now();
    try { navigator.vibrate?.(50); } catch { /* ignore */ }
    acquireLocation();

    const animate = () => {
      const elapsed = performance.now() - holdStartRef.current;
      const progress = Math.min(elapsed / HOLD_DURATION, 1);
      setHoldProgress(progress);

      if (progress >= 1) {
        try { navigator.vibrate?.([100, 50, 100, 50, 100]); } catch { /* ignore */ }
        setHoldProgress(0);
        sendSOS();
        return;
      }
      holdRafRef.current = requestAnimationFrame(animate);
    };
    holdRafRef.current = requestAnimationFrame(animate);
  }, [acquireLocation, sendSOS]);

  const onHoldEnd = useCallback(() => {
    cancelAnimationFrame(holdRafRef.current);
    const elapsed = performance.now() - holdStartRef.current;
    if (elapsed < 250 && holdProgress < 1) {
      setHintVisible(true);
      if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
      hintTimerRef.current = setTimeout(() => setHintVisible(false), 1500);
    }
    if (holdProgress < 1) {
      setHoldProgress(0);
    }
  }, [holdProgress]);

  useEffect(() => {
    return () => {
      if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
    };
  }, []);

  // Save a typed description (debounced via explicit Save button — no
  // per-keystroke PATCH; the author is mid-crisis and the network may
  // be flaky, so one deliberate submit is the right model).
  const saveDescription = useCallback(async () => {
    if (!sentId || savingText) return;
    if (description.trim() === savedDescription.trim()) return;
    setSavingText(true);
    try {
      await sosFollowUp(sentId, {
        updateToken: updateToken ?? undefined,
        description,
      });
      setSavedDescription(description);
      showToast("Детали сохранены", "success");
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Не удалось сохранить";
      showToast(msg, "error");
    } finally {
      setSavingText(false);
    }
  }, [sentId, updateToken, description, savedDescription, savingText, showToast]);

  // Voice recording complete → upload → attach URL to SOS.
  const handleVoiceSaved = useCallback(async (blob: Blob) => {
    if (!sentId) return;
    setAudioUploading(true);
    try {
      const url = await uploadAudio(blob);
      await sosFollowUp(sentId, {
        updateToken: updateToken ?? undefined,
        audioUrl: url,
      });
      setAudioUrl(url);
      showToast("Голосовое сохранено", "success");
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Не удалось загрузить аудио";
      showToast(msg, "error");
    } finally {
      setAudioUploading(false);
    }
  }, [sentId, updateToken, showToast]);

  const removeAudio = useCallback(async () => {
    if (!sentId || !audioUrl) return;
    try {
      await sosFollowUp(sentId, { updateToken: updateToken ?? undefined, audioUrl: null });
      setAudioUrl(null);
    } catch { /* keep local state — user can retry */ }
  }, [sentId, updateToken, audioUrl]);

  const close = useCallback(() => {
    // Auto-save any unsaved description before closing so the author
    // doesn't lose what they typed by tapping "Закрыть" too early.
    if (sentId && description.trim() && description.trim() !== savedDescription.trim()) {
      sosFollowUp(sentId, {
        updateToken: updateToken ?? undefined,
        description,
      }).catch(() => { /* best-effort */ });
    }
    setStage("idle");
    setHoldProgress(0);
    setSentId(null);
    setUpdateToken(null);
    setWasExisting(false);
    setLocation(null);
    setDescription("");
    setSavedDescription("");
    setAudioUrl(null);
  }, [sentId, updateToken, description, savedDescription]);

  const cancel = useCallback(() => {
    setStage("idle");
    setHoldProgress(0);
    setSentId(null);
    setUpdateToken(null);
    setWasExisting(false);
    setLocation(null);
    setDescription("");
    setSavedDescription("");
    setAudioUrl(null);
  }, []);

  // Escape key handling
  useEffect(() => {
    if (stage === "idle") return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (stage === "sent") close();
        else if (stage === "error") cancel();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [stage, cancel, close]);

  const overlayActive = stage !== "idle";
  useEffect(() => {
    if (!overlayActive) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [overlayActive]);

  // History-stack integration — same pattern the old SOS used so
  // Android back / Safari swipe-back closes the overlay instead of
  // leaving the page.
  const stageRef = useRef(stage);
  stageRef.current = stage;
  const cancelRef = useRef(cancel);
  cancelRef.current = cancel;
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!overlayActive) return;
    window.history.pushState({ [SOS_STATE_MARKER]: true }, "");
    const onPopState = (e: PopStateEvent) => {
      if (e.state?.[SOS_STATE_MARKER]) return;
      const s = stageRef.current;
      if (s === "sent") closeRef.current();
      else cancelRef.current();
    };
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
      if (window.history.state?.[SOS_STATE_MARKER]) {
        window.history.back();
      }
    };
  }, [overlayActive]);

  if (stage === "idle" && reportFormOpen) return null;

  if (stage === "idle") {
    const alert = crisisMode;
    const classes = ["sos-fab"];
    if (alert) classes.push("sos-fab--alert");
    if (holdProgress > 0) classes.push("sos-fab--holding");
    const r = 34;
    const circ = 2 * Math.PI * r;
    return (
      <>
        <button
          className={classes.join(" ")}
          onPointerDown={onHoldStart}
          onPointerUp={onHoldEnd}
          onPointerLeave={onHoldEnd}
          onPointerCancel={onHoldEnd}
          onContextMenu={(e) => e.preventDefault()}
          aria-label="SOS — удерживайте для отправки сигнала"
        >
          <svg className="sos-fab-ring" viewBox="0 0 72 72" aria-hidden="true">
            <circle
              cx="36" cy="36" r={r}
              fill="none"
              stroke="#fff"
              strokeWidth="3"
              strokeDasharray={circ}
              strokeDashoffset={circ * (1 - holdProgress)}
              strokeLinecap="round"
              transform="rotate(-90 36 36)"
            />
          </svg>
          <span className="sos-fab-text">SOS</span>
        </button>
        {hintVisible && (
          <div className="sos-hint" role="status" aria-live="polite">
            Удерживайте 1 сек
          </div>
        )}
      </>
    );
  }

  return createPortal(
    <div className="sos-overlay" role="alertdialog" aria-label="Экстренный сигнал SOS" aria-modal="true">
      {stage === "sending" && (
        <div className="sos-panel">
          <div className="sos-spinner" />
          <p className="sos-panel-subtitle">Отправка сигнала...</p>
        </div>
      )}

      {stage === "sent" && (
        <div className="sos-panel sos-panel--wide">
          <div className="sos-sent-header">
            <div className="sos-check-icon">
              {wasExisting ? (
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 7v5l3 2" />
                </svg>
              ) : (
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M20 6L9 17l-5-5" />
                </svg>
              )}
            </div>
            <p className={`sos-sent-title${wasExisting ? " sos-sent-title--existing" : ""}`}>
              {wasExisting ? "Ваш SOS активен" : "SOS отправлен"}
            </p>
            <p className="sos-sent-sub">
              {!online
                ? "Нет связи. Сигнал сохранён и уйдёт при подключении."
                : wasExisting
                  ? "Сигнал уже в работе. Можете дополнить описание или записать голосовое — это поможет быстрее прийти к вам."
                  : "Волонтёры уведомлены. Расскажите, что происходит — это поможет быстрее прийти к вам."}
            </p>
            {location && (
              <p className="sos-meta">
                Координаты получены (±{Math.round(location.accuracy)}м)
              </p>
            )}
          </div>

          <div className="sos-followup">
            <label className="sos-followup-label" htmlFor="sos-desc-input">
              Опишите ситуацию
            </label>
            <textarea
              id="sos-desc-input"
              className="sos-followup-textarea"
              placeholder="Например: мы втроём на крыше, вода поднялась до окон"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              maxLength={2000}
              disabled={!sentId || savingText}
            />
            <button
              type="button"
              className="sos-followup-save"
              onClick={saveDescription}
              disabled={
                !sentId ||
                savingText ||
                !description.trim() ||
                description.trim() === savedDescription.trim()
              }
            >
              {savingText ? "Сохранение..." : "Сохранить текст"}
            </button>

            <div className="sos-followup-divider">
              <span>или</span>
            </div>

            <p className="sos-followup-label">Голосовое сообщение</p>
            {sentId && (
              <VoiceRecorder
                onSaved={handleVoiceSaved}
                existingUrl={audioUrl}
                onRemove={removeAudio}
                disabled={audioUploading}
              />
            )}
          </div>

          <button className="sos-done-btn" onClick={close}>Готово</button>
        </div>
      )}

      {stage === "error" && (
        <div className="sos-panel">
          <div className="sos-panel-icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="15" y1="9" x2="9" y2="15" />
              <line x1="9" y1="9" x2="15" y2="15" />
            </svg>
          </div>
          <p className="sos-panel-title" style={{ color: "#f87171" }}>Ошибка отправки</p>
          <p className="sos-panel-subtitle">Попробуйте ещё раз</p>
          <button className="sos-retry-btn" onClick={() => sendSOS()}>
            Повторить
          </button>
          <button className="sos-cancel-btn" onClick={cancel}>Закрыть</button>
        </div>
      )}
    </div>,
    document.body,
  );
}

async function getBatteryLevel(): Promise<number | undefined> {
  try {
    const nav = navigator as Navigator & { getBattery?: () => Promise<{ level: number }> };
    if (nav.getBattery) {
      const battery = await nav.getBattery();
      return Math.round(battery.level * 100);
    }
  } catch { /* ignore */ }
  return undefined;
}
