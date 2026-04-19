// SPDX-License-Identifier: AGPL-3.0-only
import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { createSOS, sosFollowUp, ApiError } from "../services/api.js";
import { addToOutbox } from "../services/db.js";
import { useOnline } from "../hooks/useOnline.js";
import { useUIStore } from "../store/ui.js";
import { MAKHACHKALA_CENTER } from "@samur/shared";

/**
 * Stages:
 *   idle    — just the FAB; hold-to-activate
 *   sending — POST dispatched, waiting for server ACK
 *   sent    — server accepted; follow-up form is open (cards + text)
 *   error   — POST /sos failed; retry or give up
 *
 * The SOS fires immediately on long-press complete. Details (which
 * categories match, free text) get attached after via
 * /sos/:id/follow-up so the emergency dispatch is never blocked on
 * the author deciding what to type.
 */
type Stage = "idle" | "sending" | "sent" | "error";

const HOLD_DURATION = 1200;
const SOS_STATE_MARKER = "kunakSos";

/** Situation categories shown as tappable cards on the post-send
 * screen. Every card is optional; the author picks any that apply
 * (multi-select). Labels land in the request's `description` field as
 * a human-readable prefix so volunteers scanning the list see what's
 * going on at a glance. Keys are the machine-readable tags used to
 * round-trip through `parseDescription` → UI state on re-open. */
interface Category {
  key: string;
  label: string;
  icon: JSX.Element;
}

const CATEGORIES: Category[] = [
  {
    key: "trapped_water",
    label: "В ловушке водой",
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M2 12c2 2 4 2 6 0s4-2 6 0 4 2 6 0" />
        <path d="M2 16c2 2 4 2 6 0s4-2 6 0 4 2 6 0" />
        <path d="M2 8c2 2 4 2 6 0s4-2 6 0 4 2 6 0" />
      </svg>
    ),
  },
  {
    key: "on_roof",
    label: "На крыше",
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M3 12l9-8 9 8" />
        <path d="M5 10v9a1 1 0 001 1h12a1 1 0 001-1v-9" />
      </svg>
    ),
  },
  {
    key: "cant_exit",
    label: "Не могу выбраться",
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="5" y="3" width="14" height="18" rx="1" />
        <circle cx="15.5" cy="12" r="1" />
        <path d="M9 7v3M9 14v3" />
      </svg>
    ),
  },
  {
    key: "medical",
    label: "Нужен врач",
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3" y="3" width="18" height="18" rx="3" />
        <path d="M12 7v10M7 12h10" />
      </svg>
    ),
  },
  {
    key: "dependents",
    label: "С детьми или пожилыми",
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="9" cy="7" r="3" />
        <circle cx="17" cy="9" r="2" />
        <path d="M3 21v-2a4 4 0 014-4h4a4 4 0 014 4v2" />
        <path d="M15 21v-1a3 3 0 013-3h1a3 3 0 013 3v1" />
      </svg>
    ),
  },
  {
    key: "evacuation",
    label: "Нужна эвакуация",
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M5 17H3a1 1 0 01-1-1v-5a3 3 0 013-3h14a3 3 0 013 3v5a1 1 0 01-1 1h-2" />
        <circle cx="7" cy="17" r="2" />
        <circle cx="17" cy="17" r="2" />
        <path d="M5 8l1-3h12l1 3" />
      </svg>
    ),
  },
  {
    key: "supplies",
    label: "Нет еды или воды",
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 2l-5.5 9a6.5 6.5 0 1011 0z" />
      </svg>
    ),
  },
  {
    key: "missing_family",
    label: "Ищу близких",
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="11" cy="11" r="7" />
        <path d="M21 21l-4.3-4.3" />
      </svg>
    ),
  },
];

const CATEGORY_BY_LABEL = new Map(CATEGORIES.map((c) => [c.label, c]));

/** Legacy single-situation enum from the pre-redesign picker. Maps
 * into the current multi-select model so an SOS created yesterday
 * re-opens with the matching card preselected rather than showing the
 * raw English enum in the textarea. */
const LEGACY_SITUATION_MAP: Record<string, string> = {
  water_inside: "trapped_water",
  roof: "on_roof",
  road: "cant_exit",
  medical: "medical",
};

/** Round-trip description encoding. The stored description has two
 * sections separated by a blank line:
 *   Ситуация: Label 1, Label 2
 *
 *   free-form user description
 * Either part may be missing. The server additionally prepends "SOS —"
 * on the follow-up endpoint — that gets stripped here.
 *
 * Volunteers see the raw string in the request list, which is why we
 * use Russian labels (readable) rather than machine keys. On re-open
 * we map labels back to keys via CATEGORY_BY_LABEL. */
function parseDescription(raw: string | null | undefined): { keys: Set<string>; text: string } {
  const empty = { keys: new Set<string>(), text: "" };
  if (!raw) return empty;

  let body = raw.replace(/^SOS\s*(?:—|-)\s*/, "").trim();
  if (!body) return empty;

  // Legacy single-enum form from the old picker — still lives in DB.
  const legacy = LEGACY_SITUATION_MAP[body];
  if (legacy) {
    return { keys: new Set([legacy]), text: "" };
  }

  const match = body.match(/^Ситуация:\s*([^\n]+?)\s*(?:\n\s*\n|$)/);
  const keys = new Set<string>();
  if (match) {
    for (const label of match[1].split(",")) {
      const cat = CATEGORY_BY_LABEL.get(label.trim());
      if (cat) keys.add(cat.key);
    }
    body = body.slice(match[0].length).trim();
  }
  return { keys, text: body };
}

function composeDescription(keys: Set<string>, freeText: string): string {
  const labels = CATEGORIES.filter((c) => keys.has(c.key)).map((c) => c.label);
  const parts: string[] = [];
  if (labels.length > 0) parts.push(`Ситуация: ${labels.join(", ")}`);
  const trimmed = freeText.trim();
  if (trimmed) parts.push(trimmed);
  return parts.join("\n\n");
}

export function SOSButton() {
  const reportFormOpen = useUIStore((s) => s.reportFormOpen);
  const [stage, setStage] = useState<Stage>("idle");
  const [holdProgress, setHoldProgress] = useState(0);
  const [location, setLocation] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [sentId, setSentId] = useState<string | null>(null);
  const [updateToken, setUpdateToken] = useState<string | null>(null);
  const [wasExisting, setWasExisting] = useState(false);
  const [hintVisible, setHintVisible] = useState(false);

  // Follow-up form state — multi-select category keys plus free text.
  // savedKeys/savedText track the last-persisted state so the Save
  // button can stay disabled until there's something new to send.
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [savedKeys, setSavedKeys] = useState<Set<string>>(new Set());
  const [freeText, setFreeText] = useState("");
  const [savedFreeText, setSavedFreeText] = useState("");
  const [savingText, setSavingText] = useState(false);

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
        } | undefined;
        setSentId(data?.id ?? null);
        setUpdateToken(data?.updateToken ?? null);
        setWasExisting(data?.existing === true);
        if (data?.existing) {
          const { keys, text } = parseDescription(data.description ?? "");
          setSelectedKeys(keys);
          setSavedKeys(new Set(keys));
          setFreeText(text);
          setSavedFreeText(text);
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
    if (holdProgress < 1) setHoldProgress(0);
  }, [holdProgress]);

  useEffect(() => {
    return () => {
      if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
    };
  }, []);

  const toggleCategory = useCallback((key: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const hasChanges = useMemo(() => {
    if (freeText.trim() !== savedFreeText.trim()) return true;
    if (selectedKeys.size !== savedKeys.size) return true;
    for (const k of selectedKeys) if (!savedKeys.has(k)) return true;
    return false;
  }, [selectedKeys, savedKeys, freeText, savedFreeText]);

  const saveFollowUp = useCallback(async () => {
    if (!sentId || savingText || !hasChanges) return;
    setSavingText(true);
    const composed = composeDescription(selectedKeys, freeText);
    try {
      await sosFollowUp(sentId, {
        updateToken: updateToken ?? undefined,
        description: composed,
      });
      setSavedKeys(new Set(selectedKeys));
      setSavedFreeText(freeText);
      showToast("Детали сохранены", "success");
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Не удалось сохранить";
      showToast(msg, "error");
    } finally {
      setSavingText(false);
    }
  }, [sentId, updateToken, selectedKeys, freeText, hasChanges, savingText, showToast]);

  const close = useCallback(() => {
    // Auto-save any pending changes so the author can't accidentally
    // discard detail they meant to send.
    if (sentId && hasChanges) {
      const composed = composeDescription(selectedKeys, freeText);
      sosFollowUp(sentId, {
        updateToken: updateToken ?? undefined,
        description: composed,
      }).catch(() => { /* best-effort */ });
    }
    setStage("idle");
    setHoldProgress(0);
    setSentId(null);
    setUpdateToken(null);
    setWasExisting(false);
    setLocation(null);
    setSelectedKeys(new Set());
    setSavedKeys(new Set());
    setFreeText("");
    setSavedFreeText("");
  }, [sentId, updateToken, selectedKeys, freeText, hasChanges]);

  const cancel = useCallback(() => {
    setStage("idle");
    setHoldProgress(0);
    setSentId(null);
    setUpdateToken(null);
    setWasExisting(false);
    setLocation(null);
    setSelectedKeys(new Set());
    setSavedKeys(new Set());
    setFreeText("");
    setSavedFreeText("");
  }, []);

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
        <div className="sos-panel sos-panel--light">
          <div className="sos-spinner sos-spinner--light" />
          <p className="sos-panel-subtitle sos-panel-subtitle--light">Отправка сигнала...</p>
        </div>
      )}

      {stage === "sent" && (
        <div className="sos-panel sos-panel--light sos-panel--wide">
          <div className="sos-sent-header sos-sent-header--light">
            <div className={`sos-badge${wasExisting ? " sos-badge--existing" : " sos-badge--fresh"}`}>
              {wasExisting ? (
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 7v5l3 2" />
                </svg>
              ) : (
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M20 6L9 17l-5-5" />
                </svg>
              )}
            </div>
            <p className="sos-sent-title sos-sent-title--light">
              {wasExisting ? "Ваш SOS активен" : "SOS отправлен"}
            </p>
            <p className="sos-sent-sub sos-sent-sub--light">
              {!online
                ? "Нет связи. Сигнал сохранён и уйдёт при подключении."
                : wasExisting
                  ? "Сигнал уже в работе. Уточните ситуацию ниже — это поможет быстрее прийти."
                  : "Волонтёры уведомлены. Выберите, что происходит — волонтёры поймут, кто нужен первым."}
            </p>
            {location && (
              <p className="sos-meta sos-meta--light">
                ±{Math.round(location.accuracy)}м
              </p>
            )}
          </div>

          <div className="sos-followup sos-followup--light">
            <p className="sos-followup-label sos-followup-label--light">
              Отметьте, что подходит
            </p>
            <div className="sos-category-grid">
              {CATEGORIES.map((cat) => {
                const selected = selectedKeys.has(cat.key);
                return (
                  <button
                    type="button"
                    key={cat.key}
                    className={`sos-category-card${selected ? " sos-category-card--selected" : ""}`}
                    onClick={() => toggleCategory(cat.key)}
                    aria-pressed={selected}
                  >
                    <span className="sos-category-icon">{cat.icon}</span>
                    <span className="sos-category-label">{cat.label}</span>
                    {selected && (
                      <span className="sos-category-check" aria-hidden="true">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M20 6L9 17l-5-5" />
                        </svg>
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            <label className="sos-followup-label sos-followup-label--light" htmlFor="sos-desc-input">
              Дополнительно (необязательно)
            </label>
            <textarea
              id="sos-desc-input"
              className="sos-followup-textarea sos-followup-textarea--light"
              placeholder="Например: нас трое, вода поднялась до окон"
              value={freeText}
              onChange={(e) => setFreeText(e.target.value)}
              rows={3}
              maxLength={2000}
              disabled={!sentId || savingText}
            />

            <div className="sos-followup-actions">
              <button
                type="button"
                className="sos-followup-save sos-followup-save--light"
                onClick={saveFollowUp}
                disabled={!sentId || savingText || !hasChanges}
              >
                {savingText ? "Сохранение..." : "Сохранить"}
              </button>
              <button type="button" className="sos-done-btn sos-done-btn--light" onClick={close}>
                Готово
              </button>
            </div>
          </div>
        </div>
      )}

      {stage === "error" && (
        <div className="sos-panel sos-panel--light">
          <div className="sos-panel-icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="15" y1="9" x2="9" y2="15" />
              <line x1="9" y1="9" x2="15" y2="15" />
            </svg>
          </div>
          <p className="sos-panel-title sos-panel-title--light" style={{ color: "#dc2626" }}>
            Ошибка отправки
          </p>
          <p className="sos-panel-subtitle sos-panel-subtitle--light">Попробуйте ещё раз</p>
          <button className="sos-retry-btn" onClick={() => sendSOS()}>
            Повторить
          </button>
          <button className="sos-cancel-btn sos-cancel-btn--light" onClick={cancel}>
            Закрыть
          </button>
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
