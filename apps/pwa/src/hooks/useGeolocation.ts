// SPDX-License-Identifier: AGPL-3.0-only
import { useState, useCallback } from "react";

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

  const requestPosition = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setError("Геолокация не поддерживается");
      setStatus("unavailable");
      return;
    }

    setLoading(true);
    setError(null);
    setStatus("loading");

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setPosition({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        });
        setLoading(false);
        setStatus("granted");
      },
      (err) => {
        if (err.code === 1) {
          // PERMISSION_DENIED
          setError("Доступ к геолокации запрещён");
          setStatus("denied");
        } else if (err.code === 2) {
          setError("Не удалось определить местоположение");
          setStatus("error");
        } else {
          setError("Таймаут определения местоположения");
          setStatus("error");
        }
        setLoading(false);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  }, []);

  return { position, loading, error, status, requestPosition };
}
