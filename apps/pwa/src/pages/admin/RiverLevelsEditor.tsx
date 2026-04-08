// SPDX-License-Identifier: AGPL-3.0-only
import { useState, useEffect, useCallback } from "react";
import type { RiverLevel } from "@samur/shared";
import { RIVER_TREND_LABELS } from "@samur/shared";
import { formatRelativeTime } from "@samur/shared";
import { getRiverLevels, createRiverLevel, deleteRiverLevel } from "../../services/api.js";
import { Spinner } from "../../components/Spinner.js";
import { useUIStore } from "../../store/ui.js";

export function RiverLevelsEditor() {
  const [levels, setLevels] = useState<RiverLevel[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const showToast = useUIStore((s) => s.showToast);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getRiverLevels({ latest: true });
      setLevels((res.data ?? []) as RiverLevel[]);
    } catch {
      showToast("Не удалось загрузить данные", "error");
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { fetch(); }, [fetch]);

  const handleDelete = async (id: string) => {
    try {
      await deleteRiverLevel(id);
      setLevels((prev) => prev.filter((l) => l.id !== id));
      showToast("Удалено", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Ошибка", "error");
    }
  };

  return (
    <div>
      <div className="admin-filter-row">
        <button className="btn btn-primary btn-sm" onClick={() => setShowForm(!showForm)}>
          {showForm ? "Скрыть форму" : "Добавить замер"}
        </button>
      </div>

      {showForm && <RiverLevelForm onCreated={() => { setShowForm(false); fetch(); }} />}

      {loading ? <Spinner /> : levels.length === 0 ? (
        <div className="empty-state"><p>Нет данных об уровне рек</p></div>
      ) : (
        <div className="river-list">
          {levels.map((rl) => {
            const pct = (rl.levelCm && rl.dangerLevelCm) ? Math.round((rl.levelCm / rl.dangerLevelCm) * 100) : 0;
            return (
              <div key={rl.id} className="river-card">
                <div className="river-card-header">
                  <strong>{rl.riverName} — {rl.stationName}</strong>
                  <span className={`river-trend river-trend--${rl.trend}`}>
                    {RIVER_TREND_LABELS[rl.trend]}
                  </span>
                </div>
                <div className="river-level-bar">
                  <div
                    className="river-level-fill"
                    style={{
                      width: `${Math.min(pct, 100)}%`,
                      backgroundColor: pct >= 100 ? "#EF4444" : pct >= 80 ? "#F97316" : "#3B82F6",
                    }}
                  />
                </div>
                <p>{rl.levelCm} / {rl.dangerLevelCm} см ({pct}%)</p>
                <p className="text-muted">{formatRelativeTime(rl.measuredAt)}</p>
                <button className="btn btn-danger btn-sm" onClick={() => handleDelete(rl.id)}>
                  Удалить
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function RiverLevelForm({ onCreated }: { onCreated: () => void }) {
  const [riverName, setRiverName] = useState("");
  const [stationName, setStationName] = useState("");
  const [lat, setLat] = useState("42.9849");
  const [lng, setLng] = useState("47.5047");
  const [levelCm, setLevelCm] = useState("");
  const [dangerLevelCm, setDangerLevelCm] = useState("");
  const [trend, setTrend] = useState("stable");
  const [submitting, setSubmitting] = useState(false);
  const showToast = useUIStore((s) => s.showToast);

  const handleSubmit = async () => {
    if (!riverName || !stationName || !levelCm || !dangerLevelCm) {
      showToast("Заполните все обязательные поля", "error");
      return;
    }

    setSubmitting(true);
    try {
      await createRiverLevel({
        riverName,
        stationName,
        lat: parseFloat(lat),
        lng: parseFloat(lng),
        levelCm: parseFloat(levelCm),
        dangerLevelCm: parseFloat(dangerLevelCm),
        trend,
        measuredAt: new Date().toISOString(),
      });
      showToast("Замер добавлен", "success");
      onCreated();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Ошибка", "error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="river-form">
      <div className="form-row">
        <div className="form-group">
          <label>Река</label>
          <input className="form-input" value={riverName} onChange={(e) => setRiverName(e.target.value)} placeholder="Сулак" />
        </div>
        <div className="form-group">
          <label>Станция</label>
          <input className="form-input" value={stationName} onChange={(e) => setStationName(e.target.value)} placeholder="Кизилюрт" />
        </div>
      </div>
      <div className="form-row">
        <div className="form-group">
          <label>Широта</label>
          <input className="form-input" type="number" step="0.0001" value={lat} onChange={(e) => setLat(e.target.value)} />
        </div>
        <div className="form-group">
          <label>Долгота</label>
          <input className="form-input" type="number" step="0.0001" value={lng} onChange={(e) => setLng(e.target.value)} />
        </div>
      </div>
      <div className="form-row">
        <div className="form-group">
          <label>Уровень (см)</label>
          <input className="form-input" type="number" value={levelCm} onChange={(e) => setLevelCm(e.target.value)} />
        </div>
        <div className="form-group">
          <label>Опасный уровень (см)</label>
          <input className="form-input" type="number" value={dangerLevelCm} onChange={(e) => setDangerLevelCm(e.target.value)} />
        </div>
      </div>
      <div className="form-group">
        <label>Тренд</label>
        <select className="form-input" value={trend} onChange={(e) => setTrend(e.target.value)}>
          <option value="rising">Растёт</option>
          <option value="stable">Стабильный</option>
          <option value="falling">Падает</option>
        </select>
      </div>
      <button className="btn btn-primary" onClick={handleSubmit} disabled={submitting}>
        {submitting ? "Сохранение..." : "Сохранить"}
      </button>
    </div>
  );
}
