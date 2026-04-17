// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Curated 48-hour context feed shown at the bottom of the Alerts tab.
 * Not a duplicate of other tabs — every row is a teaser that deep-links
 * to its canonical surface (News / Map / Help). The unique value-add
 * is the "ai-watch" kind: stations whose AI forecast sits between 50%
 * and 75% of danger, below the alert threshold but worth noticing —
 * these don't appear anywhere else in the product.
 */

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { formatRelativeTime } from "@samur/shared";
import { getAlertsContext } from "../../services/api.js";
import type { AlertsContextItem } from "../../services/api.js";

export function ContextFeed() {
  const [items, setItems] = useState<AlertsContextItem[] | null>(null);
  const [loaded, setLoaded] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    getAlertsContext()
      .then((res) => {
        if (cancelled) return;
        setItems(res.data ?? []);
      })
      .catch(() => {
        if (cancelled) return;
        setItems([]);
      })
      .finally(() => {
        if (cancelled) return;
        setLoaded(true);
      });
    return () => { cancelled = true; };
  }, []);

  if (!loaded) return null;
  if (!items || items.length === 0) {
    return (
      <section className="context-feed context-feed--empty" aria-label="Контекст">
        <div className="context-feed-header">Что происходило</div>
        <p className="context-feed-empty-note">В регионе всё спокойно за последние 48 часов.</p>
      </section>
    );
  }

  return (
    <section className="context-feed" aria-label="Контекст">
      <div className="context-feed-header">Что происходило · 48 часов</div>
      <ul className="context-feed-list">
        {items.map((it) => {
          // News rows carry a low-signal subtitle (feed id like "tass"),
          // which clutters without informing. Non-news rows keep their
          // subtitle since it carries real context (place + depth for
          // quakes, address for help, peak date for AI-watch).
          const showSubtitle = it.kind !== "news" && Boolean(it.subtitle);
          return (
            <li key={it.id}>
              <button
                type="button"
                className={`context-row context-row--${it.kind}`}
                onClick={() => it.navigateTo && navigate(it.navigateTo)}
                disabled={!it.navigateTo}
              >
                <span className="context-row-icon" aria-hidden="true">{it.icon}</span>
                <span className="context-row-body">
                  <span className="context-row-title">{it.title}</span>
                  {showSubtitle && <span className="context-row-subtitle">{it.subtitle}</span>}
                </span>
                <span className="context-row-time">{formatRelativeTime(it.timestamp)}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
