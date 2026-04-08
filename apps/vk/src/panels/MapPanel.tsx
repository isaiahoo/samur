// SPDX-License-Identifier: AGPL-3.0-only
import { useState, useEffect } from "react";
import {
  Panel,
  PanelHeader,
  Div,
  Button,
  Alert as VkAlert,
  ScreenSpinner,
} from "@vkontakte/vkui";
import { MapContainer, TileLayer, Marker, Popup, useMapEvents } from "react-leaflet";
import type { LatLngBounds } from "leaflet";
import { getIncidents, getShelters, getHelpRequests } from "../services/api";
import { getGeodata } from "../services/vkbridge";
import { incidentIcons, helpNeedIcon, helpOfferIcon, shelterOpenIcon, shelterFullIcon } from "../components/MarkerIcons";
import {
  INCIDENT_TYPE_LABELS,
  SEVERITY_LABELS,
  HELP_CATEGORY_LABELS,
  SHELTER_STATUS_LABELS,
  MAKHACHKALA_CENTER,
} from "@samur/shared";
import type { Incident, HelpRequest, Shelter } from "@samur/shared";
import type { PanelId } from "../hooks/useNav";

interface Props {
  id: string;
  go: (panel: PanelId) => void;
}

function BoundsTracker({ onBoundsChange }: { onBoundsChange: (b: LatLngBounds) => void }) {
  useMapEvents({
    moveend(e) {
      onBoundsChange(e.target.getBounds());
    },
  });
  return null;
}

export default function MapPanel({ id, go }: Props) {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [helpReqs, setHelpReqs] = useState<HelpRequest[]>([]);
  const [shelters, setShelters] = useState<Shelter[]>([]);
  const [center, setCenter] = useState<[number, number]>([
    MAKHACHKALA_CENTER.lat,
    MAKHACHKALA_CENTER.lng,
  ]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function init() {
      const geo = await getGeodata();
      if (geo) setCenter([geo.lat, geo.long]);

      try {
        const [inc, hr, sh] = await Promise.all([
          getIncidents("limit=100&status=verified&status=unverified"),
          getHelpRequests("limit=100&status=open"),
          getShelters(),
        ]);
        setIncidents(inc);
        setHelpReqs(hr);
        setShelters(sh);
      } catch (err) {
        console.error("Failed to load map data:", err);
      }
      setLoading(false);
    }
    init();
  }, []);

  return (
    <Panel id={id}>
      <PanelHeader>ДагПомощь — Карта</PanelHeader>
      <div style={{ position: "relative", height: "calc(100vh - 96px)" }}>
        {loading && <ScreenSpinner />}
        <MapContainer
          center={center}
          zoom={11}
          style={{ height: "100%", width: "100%" }}
          zoomControl={false}
        >
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />

          {incidents.map((inc) => (
            <Marker
              key={`i-${inc.id}`}
              position={[inc.lat, inc.lng]}
              icon={incidentIcons[inc.severity] ?? incidentIcons.medium}
            >
              <Popup>
                <strong>{INCIDENT_TYPE_LABELS[inc.type] ?? inc.type}</strong>
                <br />
                {SEVERITY_LABELS[inc.severity] ?? inc.severity}
                {inc.description && (
                  <>
                    <br />
                    {inc.description}
                  </>
                )}
              </Popup>
            </Marker>
          ))}

          {helpReqs.map((hr) => (
            <Marker
              key={`h-${hr.id}`}
              position={[hr.lat, hr.lng]}
              icon={hr.type === "need" ? helpNeedIcon : helpOfferIcon}
            >
              <Popup>
                <strong>{HELP_CATEGORY_LABELS[hr.category] ?? hr.category}</strong>
                <br />
                {hr.type === "need" ? "Нужна помощь" : "Предложение помощи"}
                {hr.description && (
                  <>
                    <br />
                    {hr.description}
                  </>
                )}
                {hr.contactPhone && (
                  <>
                    <br />
                    📞 {hr.contactPhone}
                  </>
                )}
              </Popup>
            </Marker>
          ))}

          {shelters.map((s) => (
            <Marker
              key={`s-${s.id}`}
              position={[s.lat, s.lng]}
              icon={s.status === "full" ? shelterFullIcon : shelterOpenIcon}
            >
              <Popup>
                <strong>{s.name}</strong>
                <br />
                {s.address}
                <br />
                👥 {s.currentOccupancy}/{s.capacity} —{" "}
                {SHELTER_STATUS_LABELS[s.status] ?? s.status}
                {s.contactPhone && (
                  <>
                    <br />
                    📞 {s.contactPhone}
                  </>
                )}
              </Popup>
            </Marker>
          ))}
        </MapContainer>

        <div
          style={{
            position: "absolute",
            bottom: 16,
            right: 16,
            zIndex: 1000,
          }}
        >
          <Button
            size="l"
            mode="primary"
            onClick={() => go("report")}
            style={{ borderRadius: "50%", width: 56, height: 56, padding: 0 }}
          >
            📍
          </Button>
        </div>
      </div>
    </Panel>
  );
}
