// SPDX-License-Identifier: AGPL-3.0-only
import { useState, useCallback, useRef, useEffect } from "react";

interface GeoPosition {
  lat: number;
  lng: number;
  accuracy: number;
}

type GeoStatus = "idle" | "loading" | "granted" | "denied" | "unavailable" | "error";

interface UseGeolocationResult {
  position: GeoPosition | null;
  loading: boolean;
  error: string | null;
  status: GeoStatus;
  requestPosition: () => void;
}

export function useGeolocation(): UseGeolocationResult {
  const [position, setPosition] = useState<GeoPosition | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<GeoStatus>("idle");
  const hasRequested = useRef(false);
  const statusRef = useRef<GeoStatus>("idle");

  const requestPosition = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setError("Геолокация не поддерживается");
      setStatus("unavailable");
      statusRef.current = "unavailable";
      return;
    }

    // First call can use cached position; retries force fresh lookup
    const maxAge = hasRequested.current ? 0 : 60000;
    hasRequested.current = true;

    setLoading(true);
    setError(null);
    setStatus("loading");
    statusRef.current = "loading";

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setPosition({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        });
        setLoading(false);
        setError(null);
        setStatus("granted");
        statusRef.current = "granted";
      },
      (err) => {
        if (err.code === 1) {
          setError("Доступ к геолокации запрещён");
          setStatus("denied");
          statusRef.current = "denied";
        } else if (err.code === 2) {
          setError("Не удалось определить местоположение");
          setStatus("error");
          statusRef.current = "error";
        } else {
          setError("Таймаут определения местоположения");
          setStatus("error");
          statusRef.current = "error";
        }
        setLoading(false);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: maxAge },
    );
  }, []);

  // Re-check geolocation when the page becomes visible again
  // (user may have just returned from iOS Settings after granting permission)
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "visible" && statusRef.current === "denied") {
        requestPosition();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [requestPosition]);

  return { position, loading, error, status, requestPosition };
}
