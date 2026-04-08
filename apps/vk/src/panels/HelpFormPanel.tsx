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
  Input,
  Button,
  Div,
  Snackbar,
} from "@vkontakte/vkui";
import { createHelpRequest } from "../services/api";
import { getGeodata, shareToWall } from "../services/vkbridge";
import {
  HELP_CATEGORY_LABELS,
  HELP_REQUEST_TYPE_LABELS,
  DAGESTAN_BOUNDS,
} from "@samur/shared";

interface Props {
  id: string;
  goBack: () => void;
}

export default function HelpFormPanel({ id, goBack }: Props) {
  const [kind, setKind] = useState<"need" | "offer">("need");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [contactPhone, setContactPhone] = useState("");
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
        setSnackbar("Координаты вне Дагестана");
      }
    } else {
      setSnackbar("Не удалось определить");
    }
    setGeoLoading(false);
  }

  async function handleSubmit() {
    if (!category) {
      setSnackbar("Выберите категорию");
      return;
    }

    setSubmitting(true);
    try {
      const hr = await createHelpRequest({
        type: kind,
        category,
        lat: lat ?? 42.9849,
        lng: lng ?? 47.5047,
        address: address || undefined,
        description: description || undefined,
        urgency: kind === "need" ? "urgent" : "normal",
        contactPhone: contactPhone || undefined,
      });

      setSnackbar("Заявка отправлена!");

      // Offer to share on VK wall
      if (kind === "need") {
        const catLabel = HELP_CATEGORY_LABELS[category] ?? category;
        const text = `Моим соседям нужна помощь: ${catLabel}${description ? ` — ${description.slice(0, 100)}` : ""}. Откройте приложение Самур!`;
        try {
          await shareToWall(text, "https://vk.com/app"); // app link placeholder
        } catch {
          // User cancelled share
        }
      }

      setTimeout(goBack, 1000);
    } catch {
      setSnackbar("Ошибка отправки");
    }
    setSubmitting(false);
  }

  return (
    <Panel id={id}>
      <PanelHeader before={<PanelHeaderBack onClick={goBack} />}>
        Создать заявку
      </PanelHeader>

      <Group>
        <FormItem top="Тип">
          <Select
            value={kind}
            onChange={(e) => setKind(e.target.value as "need" | "offer")}
            options={Object.entries(HELP_REQUEST_TYPE_LABELS).map(
              ([value, label]) => ({ value, label }),
            )}
          />
        </FormItem>

        <FormItem top="Категория">
          <Select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="Выберите категорию"
            options={Object.entries(HELP_CATEGORY_LABELS).map(
              ([value, label]) => ({ value, label }),
            )}
          />
        </FormItem>

        <FormItem top="Местоположение">
          <Div style={{ display: "flex", gap: 8, padding: 0 }}>
            <Button
              size="m"
              mode="secondary"
              loading={geoLoading}
              onClick={detectLocation}
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

        <FormItem top="Адрес">
          <Input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Улица, дом..."
          />
        </FormItem>

        <FormItem top="Описание">
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Что нужно / что предлагаете..."
          />
        </FormItem>

        <FormItem top="Контактный телефон">
          <Input
            type="tel"
            value={contactPhone}
            onChange={(e) => setContactPhone(e.target.value)}
            placeholder="+7..."
          />
        </FormItem>

        <Div>
          <Button
            size="l"
            mode="primary"
            stretched
            loading={submitting}
            disabled={!category}
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
