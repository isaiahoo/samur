// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from "react";
import {
  Panel,
  PanelHeader,
  PanelHeaderBack,
  Group,
  FormItem,
  Select,
  Textarea,
  Button,
  Div,
  Banner,
  Snackbar,
} from "@vkontakte/vkui";
import { createIncident } from "../services/api";
import { getGeodata } from "../services/vkbridge";
import {
  INCIDENT_TYPE_LABELS,
  SEVERITY_LABELS,
  DAGESTAN_BOUNDS,
} from "@samur/shared";

interface Props {
  id: string;
  goBack: () => void;
}

export default function ReportPanel({ id, goBack }: Props) {
  const [type, setType] = useState("");
  const [severity, setSeverity] = useState("medium");
  const [description, setDescription] = useState("");
  const [address, setAddress] = useState("");
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [geoLoading, setGeoLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [snackbar, setSnackbar] = useState<string | null>(null);

  async function detectLocation() {
    setGeoLoading(true);
    const geo = await getGeodata();
    if (geo) {
      if (
        geo.lat >= DAGESTAN_BOUNDS.south &&
        geo.lat <= DAGESTAN_BOUNDS.north &&
        geo.long >= DAGESTAN_BOUNDS.west &&
        geo.long <= DAGESTAN_BOUNDS.east
      ) {
        setLat(geo.lat);
        setLng(geo.long);
        setSnackbar("Геолокация определена");
      } else {
        setSnackbar("Координаты вне территории Дагестана");
      }
    } else {
      setSnackbar("Не удалось определить геолокацию");
    }
    setGeoLoading(false);
  }

  async function handleSubmit() {
    if (!type) {
      setSnackbar("Выберите тип инцидента");
      return;
    }
    if (!lat || !lng) {
      if (!address) {
        setSnackbar("Укажите местоположение или адрес");
        return;
      }
      // Default to Makhachkala
      setLat(42.9849);
      setLng(47.5047);
    }

    setSubmitting(true);
    try {
      const incident = await createIncident({
        type,
        severity,
        lat: lat ?? 42.9849,
        lng: lng ?? 47.5047,
        address: address || undefined,
        description: description || undefined,
      });
      setSnackbar(`Отправлено! ID: #${incident.id.slice(0, 8)}`);
      setTimeout(goBack, 1500);
    } catch (err) {
      setSnackbar("Ошибка отправки. Попробуйте позже.");
    }
    setSubmitting(false);
  }

  return (
    <Panel id={id}>
      <PanelHeader before={<PanelHeaderBack onClick={goBack} />}>
        Сообщить об инциденте
      </PanelHeader>

      <Group>
        <FormItem top="Тип инцидента">
          <Select
            value={type}
            onChange={(e) => setType(e.target.value)}
            placeholder="Выберите тип"
            options={Object.entries(INCIDENT_TYPE_LABELS).map(([value, label]) => ({
              value,
              label,
            }))}
          />
        </FormItem>

        <FormItem top="Серьёзность">
          <Select
            value={severity}
            onChange={(e) => setSeverity(e.target.value)}
            options={Object.entries(SEVERITY_LABELS).map(([value, label]) => ({
              value,
              label,
            }))}
          />
        </FormItem>

        <FormItem top="Местоположение">
          <Div style={{ display: "flex", gap: 8 }}>
            <Button
              size="m"
              mode="secondary"
              loading={geoLoading}
              onClick={detectLocation}
              stretched
            >
              📍 Определить
            </Button>
            {lat && lng && (
              <span style={{ alignSelf: "center", fontSize: 13, color: "#888" }}>
                {lat.toFixed(4)}, {lng.toFixed(4)}
              </span>
            )}
          </Div>
        </FormItem>

        <FormItem top="Или введите адрес">
          <Textarea
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Улица, дом, район..."
          />
        </FormItem>

        <FormItem top="Описание">
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Опишите ситуацию..."
          />
        </FormItem>

        <Div>
          <Button
            size="l"
            mode="primary"
            stretched
            loading={submitting}
            disabled={!type}
            onClick={handleSubmit}
          >
            Отправить
          </Button>
        </Div>
      </Group>

      {snackbar && (
        <Snackbar onClose={() => setSnackbar(null)}>{snackbar}</Snackbar>
      )}
    </Panel>
  );
}
