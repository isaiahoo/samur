// SPDX-License-Identifier: AGPL-3.0-only
import { useState, useRef, useCallback, useEffect } from "react";
import { SOS_SITUATION_LABELS } from "@samur/shared";
import type { SosSituation } from "@samur/shared";
import { createSOS } from "../services/api.js";
import { addToOutbox } from "../services/db.js";
import { useOnline } from "../hooks/useOnline.js";
import { useUIStore } from "../store/ui.js";

type Stage = "idle" | "confirm" | "situation" | "sending" | "sent" | "error";

const HOLD_DURATION = 2000;
const AUTO_SEND_DELAY = 5000;

const SITUATION_ICONS: Record<string, string> = {
  roof: "M3 12l9-9 9 9M5 10v10a1 1 0 001 1h3a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1h3a1 1 0 001-1V10",
  water_inside: "M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM12 3C6.5 3 2 6.58 2 11c0 1.5.5 3.5 2 5l-1 3 3-1c1.5 1 3 1.5 4.5 1.5",
  road: "M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13V7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4",
  medical: "M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z",
};

export function SOSButton() {
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

  const online = useOnline();
  const showToast = useUIStore((s) => s.showToast);

  // Acquire GPS when confirm overlay opens
  const acquireLocation = useCallback(() => {
    if (location) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy });
        setLocating(false);
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 },
    );
  }, [location]);

  // Send the SOS signal
  const sendSOS = useCallback(async (situation?: SosSituation) => {
    if (!location) return;
    setStage("sending");

    const batteryLevel = await getBatteryLevel();
    const payload: Record<string, unknown> = {
      lat: location.lat,
      lng: location.lng,
      batteryLevel,
    };
    if (situation) payload.situation = situation;

    try {
      if (online) {
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
  }, [location, online, showToast]);

  // Long-press handlers
  const onHoldStart = useCallback(() => {
    holdStartRef.current = performance.now();
    try { navigator.vibrate?.(50); } catch {}

    const animate = () => {
      const elapsed = performance.now() - holdStartRef.current;
      const progress = Math.min(elapsed / HOLD_DURATION, 1);
      setHoldProgress(progress);

      if (progress >= 1) {
        // Activated!
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
    clearTimeout(autoSendTimerRef.current);
    clearInterval(countdownIntervalRef.current);
  }, []);

  const close = useCallback(() => {
    setStage("idle");
    setHoldProgress(0);
    setSentId(null);
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

  // All other stages render in full-screen overlay
  return (
    <div className="sos-overlay" role="dialog" aria-label="Экстренный сигнал SOS" aria-modal="true">
      {stage === "confirm" && (
        <div className="sos-confirm">
          <p className="sos-confirm-title">Я в беде</p>
          <p className="sos-confirm-subtitle">
            Удерживайте кнопку 2 секунды для отправки сигнала SOS
          </p>

          <div className="sos-hold-wrapper">
            <svg className="sos-hold-ring" viewBox="0 0 120 120">
              <circle cx="60" cy="60" r="54" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="6" />
              <circle
                cx="60" cy="60" r="54"
                fill="none" stroke="#fff" strokeWidth="6"
                strokeDasharray={`${2 * Math.PI * 54}`}
                strokeDashoffset={`${2 * Math.PI * 54 * (1 - holdProgress)}`}
                strokeLinecap="round"
                transform="rotate(-90 60 60)"
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

          {locating && <p className="sos-locating">Определяем местоположение...</p>}
          {location && (
            <p className="sos-locating sos-located">
              Координаты получены (точность: {Math.round(location.accuracy)}м)
            </p>
          )}

          <button className="sos-cancel" onClick={cancel}>Отмена</button>
        </div>
      )}

      {stage === "situation" && (
        <div className="sos-situation">
          <p className="sos-situation-title">Выберите ситуацию</p>
          <p className="sos-situation-countdown">
            Автоматическая отправка через {autoSendCountdown}с
          </p>

          <div className="sos-situation-grid">
            {(Object.keys(SOS_SITUATION_LABELS) as SosSituation[]).map((sit) => (
              <button
                key={sit}
                className="sos-situation-btn"
                onClick={() => selectSituation(sit)}
              >
                <svg width="32" height="32" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                  <path d={SITUATION_ICONS[sit]} />
                </svg>
                <span>{SOS_SITUATION_LABELS[sit]}</span>
              </button>
            ))}
          </div>

          <button
            className="sos-skip"
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
        <div className="sos-status">
          <div className="sos-spinner" />
          <p className="sos-status-text">Отправка сигнала...</p>
        </div>
      )}

      {stage === "sent" && (
        <div className="sos-status">
          <div className="sos-check">
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6L9 17l-5-5" />
            </svg>
          </div>
          <p className="sos-status-title">SOS ОТПРАВЛЕН</p>
          {!online && (
            <p className="sos-status-offline">
              Нет связи. Сигнал сохранён и будет отправлен при подключении.
            </p>
          )}
          {online && <p className="sos-status-subtitle">Ожидайте помощи</p>}
          {sentId && <p className="sos-status-id">ID: {sentId.slice(0, 8)}</p>}
          {location && (
            <p className="sos-status-coords">
              {location.lat.toFixed(4)}, {location.lng.toFixed(4)}
            </p>
          )}
          <button className="sos-close-btn" onClick={close}>Закрыть</button>
        </div>
      )}

      {stage === "error" && (
        <div className="sos-status">
          <p className="sos-status-title sos-status-error">Ошибка отправки</p>
          <p className="sos-status-subtitle">Попробуйте ещё раз</p>
          <button className="sos-retry-btn" onClick={() => setStage("confirm")}>
            Повторить
          </button>
          <button className="sos-cancel" onClick={cancel}>Закрыть</button>
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
