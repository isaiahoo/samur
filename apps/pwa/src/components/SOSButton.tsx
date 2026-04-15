// SPDX-License-Identifier: AGPL-3.0-only
import { useState, useRef, useCallback, useEffect } from "react";
import { SOS_SITUATION_LABELS } from "@samur/shared";
import type { SosSituation } from "@samur/shared";
import { createSOS } from "../services/api.js";
import { addToOutbox } from "../services/db.js";
import { useOnline } from "../hooks/useOnline.js";
import { useUIStore } from "../store/ui.js";
import { MAKHACHKALA_CENTER } from "@samur/shared";

type Stage = "idle" | "confirm" | "situation" | "sending" | "sent" | "error";

const HOLD_DURATION = 2000;
const AUTO_SEND_DELAY = 5000;

export function SOSButton() {
  const reportFormOpen = useUIStore((s) => s.reportFormOpen);
  const [stage, setStage] = useState<Stage>("idle");
  const [holdProgress, setHoldProgress] = useState(0);
  const [autoSendCountdown, setAutoSendCountdown] = useState(AUTO_SEND_DELAY / 1000);
  const [location, setLocation] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [sentId, setSentId] = useState<string | null>(null);

  const holdStartRef = useRef<number>(0);
  const holdRafRef = useRef<number>(0);
  const autoSendTimerRef = useRef<ReturnType<typeof setTimeout>>(0 as unknown as ReturnType<typeof setTimeout>);
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval>>(0 as unknown as ReturnType<typeof setInterval>);
  // Keep location in a ref so async callbacks always see the latest value
  const locationRef = useRef(location);
  locationRef.current = location;

  const online = useOnline();
  const onlineRef = useRef(online);
  onlineRef.current = online;
  const showToast = useUIStore((s) => s.showToast);

  // Acquire GPS when confirm overlay opens
  const acquireLocation = useCallback(() => {
    if (locationRef.current) return;
    if (!navigator.geolocation) {
      // Geolocation unavailable (HTTP or unsupported browser)
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy });
        setLocating(false);
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 },
    );
  }, []);

  // Send the SOS signal — reads from refs to avoid stale closures
  const sendSOS = useCallback(async (situation?: SosSituation) => {
    const loc = locationRef.current;
    // Use GPS if available, otherwise fallback to Makhachkala center
    const lat = loc?.lat ?? MAKHACHKALA_CENTER.lat;
    const lng = loc?.lng ?? MAKHACHKALA_CENTER.lng;
    setStage("sending");

    const batteryLevel = await getBatteryLevel();
    const payload: Record<string, unknown> = { lat, lng, batteryLevel };
    if (situation) payload.situation = situation;

    try {
      if (onlineRef.current) {
        const res = await createSOS(payload);
        const data = res.data as { id: string } | undefined;
        setSentId(data?.id ?? null);
      } else {
        await addToOutbox({ endpoint: "/help-requests/sos", method: "POST", body: payload });
      }
      setStage("sent");
      try { navigator.vibrate?.([200, 100, 200]); } catch {}
    } catch {
      setStage("error");
      showToast("Ошибка отправки SOS", "error");
    }
  }, [showToast]);

  // Long-press handlers
  const onHoldStart = useCallback(() => {
    holdStartRef.current = performance.now();
    try { navigator.vibrate?.(50); } catch {}

    const animate = () => {
      const elapsed = performance.now() - holdStartRef.current;
      const progress = Math.min(elapsed / HOLD_DURATION, 1);
      setHoldProgress(progress);

      if (progress >= 1) {
        try { navigator.vibrate?.([100, 50, 100, 50, 100]); } catch {}
        setStage("situation");
        setHoldProgress(0);
        return;
      }
      holdRafRef.current = requestAnimationFrame(animate);
    };
    holdRafRef.current = requestAnimationFrame(animate);
  }, []);

  const onHoldEnd = useCallback(() => {
    cancelAnimationFrame(holdRafRef.current);
    if (holdProgress < 1) {
      setHoldProgress(0);
    }
  }, [holdProgress]);

  // Auto-send countdown when in situation picker
  useEffect(() => {
    if (stage !== "situation") return;

    setAutoSendCountdown(AUTO_SEND_DELAY / 1000);
    countdownIntervalRef.current = setInterval(() => {
      setAutoSendCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(countdownIntervalRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    autoSendTimerRef.current = setTimeout(() => {
      sendSOS();
    }, AUTO_SEND_DELAY);

    return () => {
      clearTimeout(autoSendTimerRef.current);
      clearInterval(countdownIntervalRef.current);
    };
  }, [stage, sendSOS]);

  const selectSituation = useCallback((sit: SosSituation) => {
    clearTimeout(autoSendTimerRef.current);
    clearInterval(countdownIntervalRef.current);
    sendSOS(sit);
  }, [sendSOS]);

  const openConfirm = useCallback(() => {
    setStage("confirm");
    acquireLocation();
  }, [acquireLocation]);

  const cancel = useCallback(() => {
    setStage("idle");
    setHoldProgress(0);
    setSentId(null);
    setLocation(null);
    clearTimeout(autoSendTimerRef.current);
    clearInterval(countdownIntervalRef.current);
  }, []);

  const close = useCallback(() => {
    setStage("idle");
    setHoldProgress(0);
    setSentId(null);
    setLocation(null);
  }, []);

  // Escape key to cancel/close
  useEffect(() => {
    if (stage === "idle") return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (stage === "sent" || stage === "error") close();
        else cancel();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [stage, cancel, close]);

  // Hide when report form is open — user already chose "+" over SOS
  if (stage === "idle" && reportFormOpen) return null;

  // Render: idle FAB
  if (stage === "idle") {
    return (
      <button
        className="sos-fab"
        onClick={openConfirm}
        aria-label="SOS — Я в беде"
      >
        <span className="sos-fab-text">SOS</span>
      </button>
    );
  }

  // Full-screen overlay for all active stages
  return (
    <div className="sos-overlay" role="alertdialog" aria-label="Экстренный сигнал SOS" aria-modal="true">
      {stage === "confirm" && (
        <div className="sos-panel">
          <div className="sos-panel-icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          </div>
          <p className="sos-panel-title">Я в беде</p>
          <p className="sos-panel-subtitle">
            Удерживайте кнопку 2 секунды
          </p>

          <div className="sos-hold-wrapper">
            <svg className="sos-hold-ring" viewBox="0 0 120 120">
              <circle cx="60" cy="60" r="54" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="5" />
              <circle
                cx="60" cy="60" r="54"
                fill="none" stroke="#ef4444" strokeWidth="5"
                strokeDasharray={`${2 * Math.PI * 54}`}
                strokeDashoffset={`${2 * Math.PI * 54 * (1 - holdProgress)}`}
                strokeLinecap="round"
                transform="rotate(-90 60 60)"
                className="sos-hold-ring-progress"
              />
            </svg>
            <button
              className="sos-hold-btn"
              onPointerDown={onHoldStart}
              onPointerUp={onHoldEnd}
              onPointerLeave={onHoldEnd}
              onPointerCancel={onHoldEnd}
              aria-label="Удерживайте для SOS"
            >
              SOS
            </button>
          </div>

          <p className="sos-location-status">
            {locating && "Определяем местоположение..."}
            {location && `Координаты получены (${Math.round(location.accuracy)}м)`}
            {!locating && !location && "GPS недоступен — будет отправлен без координат"}
          </p>

          <button className="sos-cancel-btn" onClick={cancel}>Отмена</button>
        </div>
      )}

      {stage === "situation" && (
        <div className="sos-panel">
          <p className="sos-panel-title">Выберите ситуацию</p>
          <p className="sos-countdown-text">
            Отправка через <span className="sos-countdown-num">{autoSendCountdown}</span>с
          </p>

          <div className="sos-situation-grid">
            <button className="sos-sit-btn" onClick={() => selectSituation("roof")}>
              <span className="sos-sit-icon">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 12l9-8 9 8" />
                  <path d="M5 10v9a1 1 0 001 1h12a1 1 0 001-1v-9" />
                </svg>
              </span>
              <span className="sos-sit-label">На крыше</span>
              <span className="sos-sit-sub">верхний этаж</span>
            </button>
            <button className="sos-sit-btn" onClick={() => selectSituation("water_inside")}>
              <span className="sos-sit-icon">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2l-5.5 9a6.5 6.5 0 1011 0z" />
                </svg>
              </span>
              <span className="sos-sit-label">Вода в доме</span>
              <span className="sos-sit-sub">затопление</span>
            </button>
            <button className="sos-sit-btn" onClick={() => selectSituation("road")}>
              <span className="sos-sit-icon">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 17H3a2 2 0 01-2-2V9a2 2 0 012-2h2" />
                  <path d="M19 17h2a2 2 0 002-2V9a2 2 0 00-2-2h-2" />
                  <rect x="5" y="5" width="14" height="14" rx="2" />
                  <circle cx="9" cy="17" r="1" />
                  <circle cx="15" cy="17" r="1" />
                </svg>
              </span>
              <span className="sos-sit-label">На дороге</span>
              <span className="sos-sit-sub">в машине</span>
            </button>
            <button className="sos-sit-btn" onClick={() => selectSituation("medical")}>
              <span className="sos-sit-icon">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 6v12M6 12h12" />
                  <rect x="3" y="3" width="18" height="18" rx="3" />
                </svg>
              </span>
              <span className="sos-sit-label">Медпомощь</span>
              <span className="sos-sit-sub">нужен врач</span>
            </button>
          </div>

          <button
            className="sos-skip-btn"
            onClick={() => {
              clearTimeout(autoSendTimerRef.current);
              clearInterval(countdownIntervalRef.current);
              sendSOS();
            }}
          >
            Отправить без выбора
          </button>
        </div>
      )}

      {stage === "sending" && (
        <div className="sos-panel">
          <div className="sos-spinner" />
          <p className="sos-panel-subtitle">Отправка сигнала...</p>
        </div>
      )}

      {stage === "sent" && (
        <div className="sos-panel">
          <div className="sos-check-icon">
            <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6L9 17l-5-5" />
            </svg>
          </div>
          <p className="sos-sent-title">SOS ОТПРАВЛЕН</p>
          {!online && (
            <p className="sos-offline-note">
              Нет связи. Сигнал сохранён и будет отправлен при подключении.
            </p>
          )}
          {online && <p className="sos-panel-subtitle">Ожидайте помощи</p>}
          {location && (
            <p className="sos-meta">
              {location.lat.toFixed(4)}, {location.lng.toFixed(4)}
            </p>
          )}
          {sentId && <p className="sos-meta">ID: {sentId.slice(0, 8)}</p>}
          <button className="sos-done-btn" onClick={close}>Закрыть</button>
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
          <button className="sos-retry-btn" onClick={() => setStage("confirm")}>
            Повторить
          </button>
          <button className="sos-cancel-btn" onClick={cancel}>Закрыть</button>
        </div>
      )}
    </div>
  );
}

async function getBatteryLevel(): Promise<number | undefined> {
  try {
    const nav = navigator as Navigator & { getBattery?: () => Promise<{ level: number }> };
    if (nav.getBattery) {
      const battery = await nav.getBattery();
      return Math.round(battery.level * 100);
    }
  } catch {}
  return undefined;
}
