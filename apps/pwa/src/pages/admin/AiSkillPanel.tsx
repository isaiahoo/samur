// SPDX-License-Identifier: AGPL-3.0-only
import { useState, useEffect, useCallback, useMemo } from "react";
import { getAiSkill } from "../../services/api.js";
import type { AiSkillRow } from "../../services/api.js";
import { Spinner } from "../../components/Spinner.js";
import { useUIStore } from "../../store/ui.js";

const HORIZONS = [1, 3, 7] as const;

interface StationCell {
  nse: number | null;
  rmseCm: number;
  biasCm: number;
  n: number;
  climatologyShare: number;
}
interface StationRow {
  key: string;
  riverName: string;
  stationName: string;
  cells: Map<number, StationCell>;
}

function cellColor(nse: number | null, n: number): string {
  if (n < 3 || nse === null) return "#e4e4e7";
  if (nse >= 0.5) return "#bbf7d0";
  if (nse >= 0.3) return "#fef08a";
  if (nse >= 0) return "#fed7aa";
  return "#fecaca";
}

function cellTextColor(nse: number | null, n: number): string {
  if (n < 3 || nse === null) return "#71717a";
  if (nse >= 0.5) return "#14532d";
  if (nse >= 0.3) return "#713f12";
  if (nse >= 0) return "#7c2d12";
  return "#7f1d1d";
}

export function AiSkillPanel() {
  const [rows, setRows] = useState<AiSkillRow[]>([]);
  const [meta, setMeta] = useState<{ totalSnapshots: number; evaluatedPairs: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);
  const showToast = useUIStore((s) => s.showToast);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getAiSkill(days);
      setRows(res.data ?? []);
      setMeta(res.meta ? {
        totalSnapshots: res.meta.totalSnapshots,
        evaluatedPairs: res.meta.evaluatedPairs,
      } : null);
    } catch {
      showToast("Не удалось загрузить данные точности", "error");
    } finally {
      setLoading(false);
    }
  }, [days, showToast]);

  useEffect(() => { fetch(); }, [fetch]);

  const stationRows: StationRow[] = useMemo(() => {
    const map = new Map<string, StationRow>();
    for (const r of rows) {
      const key = `${r.riverName}::${r.stationName}`;
      let row = map.get(key);
      if (!row) {
        row = { key, riverName: r.riverName, stationName: r.stationName, cells: new Map() };
        map.set(key, row);
      }
      row.cells.set(r.horizonDays, {
        nse: r.nse, rmseCm: r.rmseCm, biasCm: r.biasCm, n: r.n, climatologyShare: r.climatologyShare,
      });
    }
    return Array.from(map.values()).sort((a, b) => {
      if (a.riverName !== b.riverName) return a.riverName.localeCompare(b.riverName);
      return a.stationName.localeCompare(b.stationName);
    });
  }, [rows]);

  return (
    <div>
      <div className="admin-filter-row">
        <label style={{ fontSize: 13, color: "#52525b" }}>Окно:</label>
        {[7, 30, 90].map((d) => (
          <button
            key={d}
            className={`btn btn-sm ${days === d ? "btn-primary" : ""}`}
            onClick={() => setDays(d)}
          >
            {d} дн.
          </button>
        ))}
        <button className="btn btn-sm" onClick={fetch} style={{ marginLeft: "auto" }}>
          Обновить
        </button>
      </div>

      <div className="ai-skill-intro">
        <p>
          <strong>Кунак AI — точность прогнозов.</strong> Сравнение прогнозов,
          сохранённых в момент их выпуска, с наблюдёнными уровнями рек за
          окно в {days} дней. NSE ≥ 0.5 — хорошо, 0.3–0.5 — приемлемо,
          {" "}&lt; 0.3 — прогноз ненадёжен.
        </p>
        {meta && (
          <p className="text-muted" style={{ fontSize: 12 }}>
            Всего снимков прогнозов в окне: {meta.totalSnapshots} ·
            сравнимых пар: {meta.evaluatedPairs}
          </p>
        )}
      </div>

      {loading ? (
        <Spinner />
      ) : stationRows.length === 0 ? (
        <div className="empty-state">
          <p>Пока нет сравнимых прогнозов.</p>
          <p className="text-muted" style={{ fontSize: 13 }}>
            Система только начала копить снимки. Панель заполнится, когда
            выпущенные сегодня прогнозы дозреют до сравнения с фактом (через
            1–7 дней).
          </p>
        </div>
      ) : (
        <div className="ai-skill-wrap">
          <table className="ai-skill-table">
            <thead>
              <tr>
                <th>Створ</th>
                {HORIZONS.map((h) => (
                  <th key={h}>t+{h} дн.</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {stationRows.map((row) => (
                <tr key={row.key}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{row.stationName}</div>
                    <div className="text-muted" style={{ fontSize: 11 }}>{row.riverName}</div>
                  </td>
                  {HORIZONS.map((h) => {
                    const c = row.cells.get(h);
                    if (!c) {
                      return (
                        <td key={h} style={{ background: "#f4f4f5", color: "#a1a1aa" }}>
                          <div style={{ fontSize: 12 }}>нет данных</div>
                        </td>
                      );
                    }
                    return (
                      <td
                        key={h}
                        style={{ background: cellColor(c.nse, c.n), color: cellTextColor(c.nse, c.n) }}
                      >
                        <div style={{ fontSize: 18, fontWeight: 700 }}>
                          {c.nse === null ? "—" : c.nse.toFixed(2)}
                        </div>
                        <div style={{ fontSize: 11, opacity: 0.85 }}>
                          RMSE {c.rmseCm} см · смещ. {c.biasCm >= 0 ? "+" : ""}{c.biasCm}
                        </div>
                        <div style={{ fontSize: 10, opacity: 0.7 }}>
                          n={c.n}
                          {c.climatologyShare > 0.1 && ` · клим. ${Math.round(c.climatologyShare * 100)}%`}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="ai-skill-legend">
        <span><span className="ai-skill-swatch" style={{ background: "#bbf7d0" }} />NSE ≥ 0.5</span>
        <span><span className="ai-skill-swatch" style={{ background: "#fef08a" }} />0.3–0.5</span>
        <span><span className="ai-skill-swatch" style={{ background: "#fed7aa" }} />0–0.3</span>
        <span><span className="ai-skill-swatch" style={{ background: "#fecaca" }} />&lt; 0</span>
        <span><span className="ai-skill-swatch" style={{ background: "#e4e4e7" }} />n &lt; 3</span>
      </div>
      <p className="text-muted" style={{ fontSize: 12, marginTop: 12 }}>
        NSE = 1 − Σ(факт − прогноз)² / Σ(факт − ср. факт)². Смещение — средняя
        разница (прогноз − факт) в см; положительное = модель переоценивает.
        Клим. — доля прогнозов, построенных на сезонной норме из-за отсутствия
        свежих данных.
      </p>
    </div>
  );
}
