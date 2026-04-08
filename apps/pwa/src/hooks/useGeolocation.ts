// SPDX-License-Identifier: AGPL-3.0-only
import { useState, useCallback } from "react";

interface GeoPosition {
  lat: number;
  lng: number;
  accuracy: number;
}

interface UseGeolocationResult {
  position: GeoPosition | null;
  loading: boolean;
  error: string | null;
  requestPosition: () => void;
}

export function useGeolocation(): UseGeolocationResult {
  const [position, setPosition] = useState<GeoPosition | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestPosition = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setError("Геолокация не поддерживается");
      return;
    }

    setLoading(true);
    setError(null);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setPosition({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        });
        setLoading(false);
      },
      (err) => {
        const messages: Record<number, string> = {
          1: "Доступ к геолокации запрещён",
          2: "Не удалось определить местоположение",
          3: "Таймаут определения местоположения",
        };
        setError(messages[err.code] ?? "Ошибка геолокации");
        setLoading(false);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  }, []);

  return { position, loading, error, requestPosition };
}
