// SPDX-License-Identifier: AGPL-3.0-only
import { useState, useEffect, useCallback, useMemo } from "react";
import { Link } from "react-router-dom";
import type { Shelter } from "@samur/shared";
import { SHELTER_STATUS_LABELS, AMENITY_LABELS } from "@samur/shared";
import { getShelters } from "../services/api.js";
import { getCachedItems } from "../services/db.js";
import { Spinner } from "../components/Spinner.js";
import { useGeolocation } from "../hooks/useGeolocation.js";
import { calculateDistance, formatDistance } from "@samur/shared";
import { RoutePickerSheet } from "../components/RoutePickerSheet.js";
import { PullToRefresh } from "../components/PullToRefresh.js";

export function InfoPage() {
  const [activeSection, setActiveSection] = useState<"info" | "shelters">("info");
  const [shelters, setShelters] = useState<Shelter[]>([]);
  const [loading, setLoading] = useState(false);
  const { position, requestPosition } = useGeolocation();

  const fetchShelters = useCallback(async () => {
    try {
      const res = await getShelters({ limit: 100, status: "open" });
      setShelters((res.data ?? []) as Shelter[]);
    } catch {
      const cached = await getCachedItems("shelters");
      setShelters(cached as unknown as Shelter[]);
    }
  }, []);

  useEffect(() => {
    if (activeSection === "shelters") {
      setLoading(true);
      fetchShelters().finally(() => setLoading(false));
      requestPosition();
    }
  }, [activeSection, fetchShelters, requestPosition]);

  const sortedShelters = useMemo(() => {
    if (!position) return shelters;
    return [...shelters].sort((a, b) => {
      const da = calculateDistance(position.lat, position.lng, a.lat, a.lng);
      const db = calculateDistance(position.lat, position.lng, b.lat, b.lng);
      return da - db;
    });
  }, [shelters, position]);

  return (
    <div className="info-page">
      <div className="info-tabs">
        <button
          className={`help-tab ${activeSection === "info" ? "help-tab--active" : ""}`}
          onClick={() => setActiveSection("info")}
        >
          Памятка
        </button>
        <button
          className={`help-tab ${activeSection === "shelters" ? "help-tab--active" : ""}`}
          onClick={() => setActiveSection("shelters")}
        >
          Убежища
        </button>
      </div>

      {activeSection === "info" && <EmergencyInfo />}
      {activeSection === "shelters" && (
        loading ? <Spinner /> : (
          <PullToRefresh onRefresh={fetchShelters}>
            <div className="shelters-list">
              {sortedShelters.length === 0 ? (
                <div className="empty-state"><p>Нет доступных убежищ</p></div>
              ) : (
                sortedShelters.map((s) => (
                  <ShelterCard
                    key={s.id}
                    shelter={s}
                    distance={
                      position
                        ? calculateDistance(position.lat, position.lng, s.lat, s.lng)
                        : null
                    }
                  />
                ))
              )}
            </div>
          </PullToRefresh>
        )
      )}
    </div>
  );
}

function EmergencyInfo() {
  return (
    <div className="emergency-info">
      <section className="info-section">
        <h3>Экстренные телефоны</h3>
        <div className="phone-list">
          <a href="tel:112" className="phone-item">
            <strong>112</strong>
            <span>Единая служба спасения</span>
          </a>
          <a href="tel:101" className="phone-item">
            <strong>101</strong>
            <span>Пожарная служба</span>
          </a>
          <a href="tel:102" className="phone-item">
            <strong>102</strong>
            <span>Полиция</span>
          </a>
          <a href="tel:103" className="phone-item">
            <strong>103</strong>
            <span>Скорая помощь</span>
          </a>
          <a href="tel:+78722674090" className="phone-item">
            <strong>+7 (8722) 67-40-90</strong>
            <span>МЧС Дагестана</span>
          </a>
          <a href="tel:+78722670521" className="phone-item">
            <strong>+7 (8722) 67-05-21</strong>
            <span>Горячая линия по наводнению</span>
          </a>
        </div>
      </section>

      <section className="info-section">
        <h3>До наводнения</h3>
        <ul className="info-list">
          <li>Подготовьте тревожный чемоданчик: документы в водонепроницаемом пакете, вода, еда, фонарик, аптечка, зарядка для телефона</li>
          <li>Знайте маршруты эвакуации и расположение убежищ</li>
          <li>Переместите ценные вещи на верхние этажи</li>
          <li>Зарядите все устройства, портативные аккумуляторы</li>
          <li>Запасите питьевую воду (минимум 3 литра на человека в день)</li>
          <li>Наполните ванну водой для бытовых нужд</li>
        </ul>
      </section>

      <section className="info-section">
        <h3>Во время наводнения</h3>
        <ul className="info-list">
          <li>Поднимитесь на верхние этажи, на крышу — НЕ в подвал</li>
          <li>Отключите электричество и газ</li>
          <li>НЕ ходите по затопленным улицам — там могут быть открытые люки, провода</li>
          <li>НЕ пейте водопроводную воду — она может быть загрязнена</li>
          <li>Если вы в машине — не въезжайте в затопленную зону, 30 см воды сносит автомобиль</li>
          <li>Отправьте SOS через это приложение или по СМС на горячую линию</li>
        </ul>
      </section>

      <section className="info-section">
        <h3>После наводнения</h3>
        <ul className="info-list">
          <li>Не возвращайтесь домой, пока власти не дадут разрешение</li>
          <li>Сфотографируйте повреждения для страховки</li>
          <li>Не включайте электроприборы в затопленных помещениях</li>
          <li>Выбросьте все продукты, которые контактировали с водой</li>
          <li>Проветрите и просушите помещения</li>
          <li>Обратитесь за помощью через это приложение</li>
        </ul>
      </section>

      <section className="info-section info-section--legal">
        <h3>Правовая информация</h3>
        <ul className="info-list">
          <li><Link to="/privacy">Политика конфиденциальности</Link></li>
        </ul>
      </section>
    </div>
  );
}

function ShelterCard({ shelter, distance }: { shelter: Shelter; distance: number | null }) {
  const [routeOpen, setRouteOpen] = useState(false);
  const occupancyPct = Math.round((shelter.currentOccupancy / shelter.capacity) * 100);

  return (
    <div className="shelter-card">
      <div className="shelter-card-header">
        <h4>{shelter.name}</h4>
        <span className={`status-badge status-badge--${shelter.status}`}>
          {SHELTER_STATUS_LABELS[shelter.status]}
        </span>
      </div>
      <p className="shelter-address">{shelter.address}</p>

      <div className="shelter-capacity">
        <div className="capacity-bar">
          <div
            className="capacity-fill"
            style={{
              width: `${Math.min(occupancyPct, 100)}%`,
              backgroundColor: occupancyPct >= 90 ? "#EF4444" : occupancyPct >= 70 ? "#F59E0B" : "#22C55E",
            }}
          />
        </div>
        <span>{shelter.currentOccupancy}/{shelter.capacity} мест</span>
      </div>

      {shelter.amenities.length > 0 && (
        <p className="shelter-amenities">
          {shelter.amenities.map((a) => AMENITY_LABELS[a] ?? a).join(" · ")}
        </p>
      )}

      <div className="shelter-card-actions">
        {distance !== null && (
          <span className="shelter-distance">{formatDistance(distance)}</span>
        )}
        {shelter.contactPhone && (
          <a href={`tel:${shelter.contactPhone}`} className="btn btn-secondary btn-sm">
            Позвонить
          </a>
        )}
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={() => setRouteOpen(true)}
        >
          Маршрут
        </button>
      </div>
      {routeOpen && (
        <RoutePickerSheet
          lat={shelter.lat}
          lng={shelter.lng}
          label={shelter.name}
          onClose={() => setRouteOpen(false)}
        />
      )}
    </div>
  );
}
