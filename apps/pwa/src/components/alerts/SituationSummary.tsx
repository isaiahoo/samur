// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Live status strip at the top of the Alerts tab. Gives the page a
 * reason to exist when there are no critical broadcasts — each chip
 * is a tap-through to the relevant tab (Map for rivers/incidents/
 * quakes, Help for urgent requests).
 */

import { useNavigate } from "react-router-dom";
import type { RiverLevel } from "@samur/shared";
import type { AlertsSituation } from "../../services/api.js";
import { computeTier } from "../map/gaugeUtils.js";

interface Props {
  data: AlertsSituation;
}

type ChipVariant = "ok" | "caution" | "danger";

interface Chip {
  label: string;
  value: number | string;
  variant: ChipVariant;
  onTap?: () => void;
  /** Whether to render even with value 0. Low-signal chips (quakes,
   * urgent help) hide at zero; the headline chip (rivers) always
   * renders so the page has a permanent reference number. */
  showWhenZero?: boolean;
}

function bucketizeRivers(levels: RiverLevel[]): { normal: number; elevated: number; dangerous: number; critical: number; total: number } {
  const buckets = { normal: 0, elevated: 0, dangerous: 0, critical: 0, total: 0 };
  for (const r of levels) {
    const t = computeTier(r);
    if (!t.hasData) continue;
    buckets.total++;
    if (t.tier === 1) buckets.normal++;
    else if (t.tier === 2) buckets.elevated++;
    else if (t.tier === 3) buckets.dangerous++;
    else if (t.tier === 4) buckets.critical++;
  }
  return buckets;
}

export function SituationSummary({ data }: Props) {
  const navigate = useNavigate();
  const rivers = bucketizeRivers(data.riverLevels);

  const headline = (() => {
    if (rivers.critical > 0) return { text: `${rivers.critical} в зоне затопления`, variant: "danger" as const };
    if (rivers.dangerous > 0) return { text: `${rivers.dangerous} у опасной отметки`, variant: "danger" as const };
    if (rivers.elevated > 0) return { text: `${rivers.elevated} под наблюдением`, variant: "caution" as const };
    if (rivers.total > 0) return { text: `Все ${rivers.total} в норме`, variant: "ok" as const };
    return { text: "Нет данных", variant: "ok" as const };
  })();

  const chips: Chip[] = [
    {
      label: "Реки",
      value: headline.text,
      variant: headline.variant,
      onTap: () => navigate("/"),
      showWhenZero: true,
    },
    {
      label: "Инциденты",
      value: data.incidents.active,
      variant: data.incidents.active > 0 ? "caution" : "ok",
      onTap: () => navigate("/"),
    },
    {
      label: "Срочная помощь",
      value: data.helpRequests.critical + data.helpRequests.urgent,
      variant: data.helpRequests.critical > 0 ? "danger" : data.helpRequests.urgent > 0 ? "caution" : "ok",
      onTap: () => navigate("/help"),
    },
    {
      label: "Землетрясения за 24ч",
      value: data.earthquakes.last24h,
      variant: data.earthquakes.last24hStrong > 0 ? "caution" : "ok",
      onTap: () => navigate("/"),
    },
  ];

  const visible = chips.filter((c) => c.showWhenZero || c.value !== 0);

  return (
    <div className="situation-summary" role="region" aria-label="Ситуация в регионе">
      <div className="situation-summary-chips">
        {visible.map((c) => {
          const Tag = c.onTap ? "button" : "div";
          return (
            <Tag
              key={c.label}
              type={c.onTap ? "button" : undefined}
              className={`situation-chip situation-chip--${c.variant}${c.onTap ? " situation-chip--tappable" : ""}`}
              onClick={c.onTap}
            >
              <span className="situation-chip-label">{c.label}</span>
              <span className="situation-chip-value">{c.value}</span>
            </Tag>
          );
        })}
      </div>
    </div>
  );
}
