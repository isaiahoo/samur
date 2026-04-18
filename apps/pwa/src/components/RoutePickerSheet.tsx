// SPDX-License-Identifier: AGPL-3.0-only
import { BottomSheet } from "./BottomSheet.js";

interface Props {
  lat: number;
  lng: number;
  label?: string;
  onClose: () => void;
}

type Provider = {
  id: "yandex" | "google" | "apple" | "twogis";
  name: string;
  hint: string;
  href: (lat: number, lng: number) => string;
};

const PROVIDERS: Record<Provider["id"], Provider> = {
  yandex: {
    id: "yandex",
    name: "Яндекс Карты",
    hint: "yandex.ru/maps",
    href: (lat, lng) => `https://yandex.ru/maps/?rtext=~${lat},${lng}&rtt=auto`,
  },
  twogis: {
    id: "twogis",
    name: "2ГИС",
    hint: "2gis.ru",
    href: (lat, lng) => `https://2gis.ru/routeSearch/rsType/car/to/${lng},${lat}`,
  },
  google: {
    id: "google",
    name: "Google Maps",
    hint: "google.com/maps",
    href: (lat, lng) =>
      `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`,
  },
  apple: {
    id: "apple",
    name: "Apple Maps",
    hint: "maps.apple.com",
    href: (lat, lng) => `https://maps.apple.com/?daddr=${lat},${lng}&dirflg=d`,
  },
};

/** Order providers by platform. Yandex + 2GIS stay near the top because
 * they're the only ones with accurate coverage of Dagestan side-roads,
 * but on iOS we surface Apple first since that's the user's muscle
 * memory for "open in maps" and it deep-links into the native app. */
function orderForPlatform(): Provider[] {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const isApple = /iPhone|iPad|iPod|Macintosh/.test(ua);
  if (isApple) return [PROVIDERS.apple, PROVIDERS.yandex, PROVIDERS.twogis, PROVIDERS.google];
  return [PROVIDERS.yandex, PROVIDERS.twogis, PROVIDERS.google];
}

export function RoutePickerSheet({ lat, lng, label, onClose }: Props) {
  const providers = orderForPlatform();
  return (
    <BottomSheet onClose={onClose}>
      <div className="route-picker">
        <h3 className="route-picker-title">Открыть маршрут</h3>
        {label && <p className="route-picker-subtitle">{label}</p>}
        <div className="route-picker-list">
          {providers.map((p) => (
            <a
              key={p.id}
              href={p.href(lat, lng)}
              target="_blank"
              rel="noopener noreferrer"
              className="route-picker-item"
              onClick={onClose}
            >
              <span className="route-picker-name">{p.name}</span>
              <span className="route-picker-hint">{p.hint}</span>
            </a>
          ))}
        </div>
      </div>
    </BottomSheet>
  );
}
