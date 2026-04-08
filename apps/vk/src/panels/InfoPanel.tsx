// SPDX-License-Identifier: AGPL-3.0-only
import { useState, useEffect } from "react";
import {
  Panel,
  PanelHeader,
  Group,
  Header,
  SimpleCell,
  Button,
  Div,
  Spinner,
  Banner,
  Link,
} from "@vkontakte/vkui";
import { getShelters } from "../services/api";
import { shareApp, getGeodata } from "../services/vkbridge";
import { calculateDistance, SHELTER_STATUS_LABELS } from "@samur/shared";
import type { Shelter } from "@samur/shared";

interface Props {
  id: string;
}

const PHONES = [
  { label: "Экстренные службы", number: "112" },
  { label: "Пожарная / МЧС", number: "101" },
  { label: "Полиция", number: "102" },
  { label: "Скорая помощь", number: "103" },
  { label: "МЧС Дагестана", number: "+7 (8722) 39-99-99" },
  { label: "Горячая линия паводок", number: "+7 (8722) 67-20-55" },
];

export default function InfoPanel({ id }: Props) {
  const [shelters, setShelters] = useState<(Shelter & { dist?: number })[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const geo = await getGeodata();
        const data = await getShelters(geo?.lat, geo?.long);

        if (geo) {
          const withDist = data.map((s) => ({
            ...s,
            dist: calculateDistance(geo.lat, geo.long, s.lat, s.lng),
          }));
          withDist.sort((a, b) => a.dist - b.dist);
          setShelters(withDist);
        } else {
          setShelters(data);
        }
      } catch {
        // ignore
      }
      setLoading(false);
    }
    load();
  }, []);

  function handleShare() {
    shareApp(
      "Самур — координация помощи при наводнении в Дагестане. Скачайте приложение!",
    );
  }

  return (
    <Panel id={id}>
      <PanelHeader>Информация</PanelHeader>

      <Group header={<Header>Экстренные телефоны</Header>}>
        {PHONES.map((p) => (
          <SimpleCell key={p.number}>
            <Link href={`tel:${p.number.replace(/[^+\d]/g, "")}`}>
              📞 {p.label}: <strong>{p.number}</strong>
            </Link>
          </SimpleCell>
        ))}
      </Group>

      <Group header={<Header>При наводнении</Header>}>
        <Banner
          header="До наводнения"
          subheader="Подготовьте документы, аптечку, запас воды и еды. Зарядите телефон. Узнайте маршрут к ближайшему укрытию."
        />
        <Banner
          header="Во время наводнения"
          subheader="Поднимитесь на верхние этажи. НЕ ходите по затопленным улицам. Не трогайте электропроводку. Слушайте оповещения МЧС."
        />
        <Banner
          header="После наводнения"
          subheader="Не пейте водопроводную воду без проверки. Проверьте газ и электричество перед включением. Сообщите о повреждениях."
        />
      </Group>

      <Group header={<Header>Укрытия</Header>}>
        {loading ? (
          <Div style={{ textAlign: "center", padding: 16 }}>
            <Spinner />
          </Div>
        ) : shelters.length === 0 ? (
          <Div style={{ color: "#888", textAlign: "center" }}>
            Нет открытых укрытий
          </Div>
        ) : (
          shelters.map((s) => {
            const pct = s.capacity > 0
              ? Math.round((s.currentOccupancy / s.capacity) * 100)
              : 0;
            const distStr = s.dist !== undefined
              ? s.dist < 1
                ? `${Math.round(s.dist * 1000)} м`
                : `${s.dist.toFixed(1)} км`
              : null;

            return (
              <SimpleCell
                key={s.id}
                subtitle={
                  <>
                    {s.address} · {SHELTER_STATUS_LABELS[s.status]}
                    {distStr && ` · ${distStr}`}
                    {` · 👥 ${s.currentOccupancy}/${s.capacity} (${pct}%)`}
                  </>
                }
                after={
                  <Link
                    href={`https://yandex.ru/maps/?rtext=~${s.lat},${s.lng}&rtt=auto`}
                    target="_blank"
                  >
                    🗺️
                  </Link>
                }
              >
                {s.name}
              </SimpleCell>
            );
          })
        )}
      </Group>

      <Group>
        <Div>
          <Button size="l" mode="secondary" stretched onClick={handleShare}>
            📤 Поделиться приложением
          </Button>
        </Div>
      </Group>
    </Panel>
  );
}
