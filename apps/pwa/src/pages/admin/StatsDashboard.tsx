// SPDX-License-Identifier: AGPL-3.0-only
import { useState, useEffect } from "react";
import type { DashboardStats } from "@samur/shared";
import { INCIDENT_TYPE_LABELS, HELP_CATEGORY_LABELS } from "@samur/shared";
import { getStats } from "../../services/api.js";
import { Spinner } from "../../components/Spinner.js";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";

const COLORS = ["#EF4444", "#F97316", "#F59E0B", "#22C55E", "#3B82F6", "#8B5CF6", "#EC4899", "#14B8A6", "#6366F1", "#A855F7"];

export function StatsDashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getStats()
      .then((res) => setStats(res.data as DashboardStats))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Spinner />;
  if (!stats) return <div className="empty-state"><p>Не удалось загрузить статистику</p></div>;

  const incidentData = Object.entries(stats.incidentsByType).map(([key, val]) => ({
    name: INCIDENT_TYPE_LABELS[key] ?? key,
    value: val,
  }));

  const helpData = Object.entries(stats.openHelpRequestsByCategory).map(([key, val]) => ({
    name: HELP_CATEGORY_LABELS[key] ?? key,
    value: val,
  }));

  const shelterPct = stats.shelterCapacity.total > 0
    ? Math.round((stats.shelterCapacity.occupied / stats.shelterCapacity.total) * 100)
    : 0;

  return (
    <div className="stats-dashboard">
      <div className="stats-counters">
        <div className="stat-card">
          <div className="stat-value">{stats.activeVolunteers}</div>
          <div className="stat-label">Активных волонтёров</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats.shelterCapacity.occupied}/{stats.shelterCapacity.total}</div>
          <div className="stat-label">Мест в убежищах ({shelterPct}%)</div>
        </div>
      </div>

      <div className="stats-chart-section">
        <h4>Инциденты по типу</h4>
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={incidentData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} angle={-20} textAnchor="end" height={60} />
            <YAxis allowDecimals={false} />
            <Tooltip />
            <Bar dataKey="value" fill="#3B82F6" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="stats-chart-section">
        <h4>Открытые заявки по категории</h4>
        <ResponsiveContainer width="100%" height={250}>
          <PieChart>
            <Pie
              data={helpData}
              cx="50%"
              cy="50%"
              outerRadius={90}
              dataKey="value"
              label={({ name, value }) => `${name}: ${value}`}
              labelLine={false}
            >
              {helpData.map((_entry, idx) => (
                <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
