// SPDX-License-Identifier: AGPL-3.0-only
import type { ApiResponse, PaginatedResponse } from "@samur/shared";

const BASE = "/api/v1";

function getToken(): string | null {
  try {
    const raw = localStorage.getItem("auth");
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.state?.token ?? null;
  } catch {
    return null;
  }
}

const REQUEST_TIMEOUT_MS = 15_000;

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string> ?? {}),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (options.body && typeof options.body === "string") {
    headers["Content-Type"] = "application/json";
  }

  // Race fetch against a timeout — avoids AbortController which breaks iOS Safari SW
  const res = await Promise.race([
    fetch(`${BASE}${path}`, { ...options, headers }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new ApiError(0, "TIMEOUT", "Превышено время ожидания")), REQUEST_TIMEOUT_MS),
    ),
  ]);
  const json = await res.json();

  if (!res.ok) {
    let msg = json?.error?.message ?? `Ошибка ${res.status}`;
    // Append field-level details for validation errors
    const details = json?.error?.details;
    if (details && typeof details === "object") {
      const fieldErrors = Object.entries(details)
        .map(([field, msgs]) => `${field}: ${(msgs as string[]).join(", ")}`)
        .join("; ");
      if (fieldErrors) msg += ` (${fieldErrors})`;
    }
    throw new ApiError(res.status, json?.error?.code ?? "UNKNOWN", msg);
  }
  return json;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function login(phone: string, password: string) {
  return request<ApiResponse<{ token: string; user: unknown }>>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ phone, password }),
  });
}

export function register(name: string, phone: string, password: string, role?: string) {
  return request<ApiResponse<{ token: string; user: unknown }>>("/auth/register", {
    method: "POST",
    body: JSON.stringify({ name, phone, password, role }),
  });
}

export function vkExchange(data: {
  code: string;
  codeVerifier: string;
  redirectUri: string;
  deviceId?: string;
}) {
  return request<ApiResponse<{ token: string; user: unknown }>>("/auth/vk/exchange", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function telegramInit() {
  return request<ApiResponse<{ token: string }>>("/auth/telegram/init", {
    method: "POST",
  });
}

export function telegramCheck(token: string) {
  return request<ApiResponse<{ status: string; token?: string; user?: unknown }>>(
    `/auth/telegram/check?token=${encodeURIComponent(token)}`,
  );
}

export function phoneRequest(phone: string) {
  return request<ApiResponse<{ method: string; expiresIn: number }>>("/auth/phone/request", {
    method: "POST",
    body: JSON.stringify({ phone }),
  });
}

export function phoneVerify(phone: string, code: string, name?: string, role?: string) {
  return request<ApiResponse<{ token: string; user: unknown; isNew: boolean }>>("/auth/phone/verify", {
    method: "POST",
    body: JSON.stringify({ phone, code, name, role }),
  });
}

export function telegramAuth(data: {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
}) {
  return request<ApiResponse<{ token: string; user: unknown }>>("/auth/telegram", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function getMe() {
  return request<ApiResponse>("/auth/me");
}

export function updateProfile(data: { name?: string; role?: string }) {
  return request<ApiResponse>("/auth/me", {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function uploadPhotos(files: File[]): Promise<string[]> {
  const form = new FormData();
  for (const file of files) {
    form.append("photos", file);
  }
  const token = getToken();
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${BASE}/uploads`, {
    method: "POST",
    headers,
    body: form,
  });
  const json = await res.json();
  if (!res.ok) {
    const msg = json?.error?.message ?? `Ошибка ${res.status}`;
    throw new ApiError(res.status, json?.error?.code ?? "UNKNOWN", msg);
  }
  return json.data.urls as string[];
}

export function getIncidents(params?: Record<string, string | number | boolean>) {
  const qs = params ? "?" + new URLSearchParams(toStringRecord(params)).toString() : "";
  return request<PaginatedResponse<unknown>>(`/incidents${qs}`);
}

export function getIncident(id: string) {
  return request<ApiResponse>(`/incidents/${id}`);
}

export function createIncident(data: Record<string, unknown>) {
  return request<ApiResponse>("/incidents", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function updateIncident(id: string, data: Record<string, unknown>) {
  return request<ApiResponse>(`/incidents/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export function deleteIncident(id: string) {
  return request<ApiResponse>(`/incidents/${id}`, { method: "DELETE" });
}

export function getHelpRequests(params?: Record<string, string | number | boolean>) {
  const qs = params ? "?" + new URLSearchParams(toStringRecord(params)).toString() : "";
  return request<PaginatedResponse<unknown>>(`/help-requests${qs}`);
}

export function getHelpRequest(id: string) {
  return request<ApiResponse>(`/help-requests/${id}`);
}

export function createHelpRequest(data: Record<string, unknown>) {
  return request<ApiResponse>("/help-requests", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function createSOS(data: Record<string, unknown>) {
  return request<ApiResponse>("/help-requests/sos", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function updateHelpRequest(id: string, data: Record<string, unknown>) {
  return request<ApiResponse>(`/help-requests/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export function deleteHelpRequest(id: string) {
  return request<ApiResponse>(`/help-requests/${id}`, { method: "DELETE" });
}

export function getAlerts(params?: Record<string, string | number | boolean>) {
  const qs = params ? "?" + new URLSearchParams(toStringRecord(params)).toString() : "";
  return request<PaginatedResponse<unknown>>(`/alerts${qs}`);
}

export function getAlert(id: string) {
  return request<ApiResponse>(`/alerts/${id}`);
}

export function createAlert(data: Record<string, unknown>) {
  return request<ApiResponse>("/alerts", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function updateAlert(id: string, data: Record<string, unknown>) {
  return request<ApiResponse>(`/alerts/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export function deleteAlert(id: string) {
  return request<ApiResponse>(`/alerts/${id}`, { method: "DELETE" });
}

export function getShelters(params?: Record<string, string | number | boolean>) {
  const qs = params ? "?" + new URLSearchParams(toStringRecord(params)).toString() : "";
  return request<PaginatedResponse<unknown>>(`/shelters${qs}`);
}

export function getShelter(id: string) {
  return request<ApiResponse>(`/shelters/${id}`);
}

export function createShelter(data: Record<string, unknown>) {
  return request<ApiResponse>("/shelters", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function updateShelter(id: string, data: Record<string, unknown>) {
  return request<ApiResponse>(`/shelters/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export function deleteShelter(id: string) {
  return request<ApiResponse>(`/shelters/${id}`, { method: "DELETE" });
}

export function getRiverLevels(params?: Record<string, string | number | boolean>) {
  const qs = params ? "?" + new URLSearchParams(toStringRecord(params)).toString() : "";
  return request<PaginatedResponse<unknown>>(`/river-levels${qs}`);
}

export function createRiverLevel(data: Record<string, unknown>) {
  return request<ApiResponse>("/river-levels", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function deleteRiverLevel(id: string) {
  return request<ApiResponse>(`/river-levels/${id}`, { method: "DELETE" });
}

export function getRiverLevelHistory(riverName: string, stationName: string, days = 7, includeForecast = true) {
  const qs = new URLSearchParams({ days: String(days), includeForecast: String(includeForecast) }).toString();
  return request<ApiResponse<Array<{
    levelCm: number | null;
    dangerLevelCm: number | null;
    dischargeCubicM: number | null;
    dischargeMean: number | null;
    dischargeMax: number | null;
    dataSource: string | null;
    isForecast: boolean;
    trend: string;
    measuredAt: string;
  }>>>(
    `/river-levels/history/${encodeURIComponent(riverName)}/${encodeURIComponent(stationName)}?${qs}`,
  );
}

export function getRiverLevelForecast() {
  return request<ApiResponse<Array<{
    riverName: string;
    stationName: string;
    lat: number;
    lng: number;
    levelCm: number | null;
    dangerLevelCm: number | null;
    dischargeCubicM: number | null;
    dischargeMean: number | null;
    dischargeMax: number | null;
    dataSource: string | null;
    isForecast: boolean;
    trend: string;
    measuredAt: string;
  }>>>("/river-levels/forecast");
}

export function getRiverStations() {
  return request<ApiResponse>("/river-levels/stations");
}

export interface AiForecastPoint {
  riverName: string;
  stationName: string;
  levelCm: number | null;
  dangerLevelCm: number | null;
  predictionLower: number | null;
  predictionUpper: number | null;
  trend: string;
  measuredAt: string;
  createdAt: string;
  dataSource?: string;
}

export type AiSkillTier = "high" | "medium" | "low" | "none";
export type AiInputsSource = "live-observations" | "historical-imports" | "climatology" | "training-csv" | "unknown";
export interface AiOodWarning {
  feature: string;
  value: number;
  training_max: number;
  ratio: number | null;
}
export interface AiStationMeta {
  tier: AiSkillTier;
  bestNse: number | null;
  source: AiInputsSource;
  ood?: AiOodWarning[];
  modelVersion?: string | null;
}

export interface AiForecastResponse extends ApiResponse<AiForecastPoint[]> {
  meta?: { skills?: Record<string, AiStationMeta> };
}

export function getAiForecast() {
  return request<AiForecastResponse>("/river-levels/ai-forecast");
}

export interface AiSkillRow {
  riverName: string;
  stationName: string;
  horizonDays: number;
  n: number;
  nse: number | null;
  rmseCm: number;
  biasCm: number;
  climatologyShare: number;
}
export interface AiSkillResponse extends ApiResponse<AiSkillRow[]> {
  meta?: {
    days: number;
    windowStart: string;
    windowEnd: string;
    totalSnapshots: number;
    evaluatedPairs: number;
  };
}
export function getAiSkill(days = 30) {
  return request<AiSkillResponse>(`/river-levels/ai-skill?days=${days}`);
}

// ── Historical river data (AllRivers.info) ──────────────────────────────

export interface HistoricalStat {
  dayOfYear: number;
  avgCm: number;
  minCm: number;
  maxCm: number;
  p10Cm: number;
  p90Cm: number;
  sampleCount: number;
}

export interface HistoricalPeak {
  date: string;
  valueCm: number;
}

const historicalStatsCache = new Map<string, HistoricalStat[]>();

export async function getHistoricalStats(riverName: string, stationName: string): Promise<ApiResponse<HistoricalStat[]>> {
  const key = `${riverName}::${stationName}`;
  const cached = historicalStatsCache.get(key);
  if (cached) return { success: true, data: cached };
  const res = await request<ApiResponse<HistoricalStat[]>>(
    `/river-levels/historical/${encodeURIComponent(riverName)}/${encodeURIComponent(stationName)}/stats`,
  );
  if (res.data && res.data.length > 0) historicalStatsCache.set(key, res.data);
  return res;
}

export function getHistoricalPeaks(riverName: string, stationName: string, top = 5) {
  return request<ApiResponse<HistoricalPeak[]>>(
    `/river-levels/historical/${encodeURIComponent(riverName)}/${encodeURIComponent(stationName)}/peaks?top=${top}`,
  );
}

export function getHistoricalRaw(riverName: string, stationName: string, from?: string, to?: string) {
  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const qs = params.toString();
  return request<ApiResponse<Array<{ date: string; valueCm: number; source: string }>>>(
    `/river-levels/historical/${encodeURIComponent(riverName)}/${encodeURIComponent(stationName)}${qs ? `?${qs}` : ""}`,
  );
}

export function getNews(params?: Record<string, string | number | boolean>) {
  const qs = params ? "?" + new URLSearchParams(toStringRecord(params)).toString() : "";
  return request<PaginatedResponse<unknown>>(`/news${qs}`);
}

export function getPrecipitation() {
  return request<ApiResponse<Array<{ lat: number; lng: number; precipitation: number; peakHourlyMm: number }>>>("/weather/precipitation");
}

export function getSoilMoisture() {
  return request<ApiResponse<Array<{ lat: number; lng: number; moisture: number }>>>("/weather/soil-moisture");
}

export function getSnowData() {
  return request<ApiResponse<Array<{
    lat: number; lng: number;
    snowDepthM: number; temperatureC: number;
    snowfall24hCm: number; rain24hMm: number;
    meltIndex: number;
    forecast: Array<{
      date: string; snowDepthM: number; tempMaxC: number; tempMinC: number;
      snowfallCm: number; rainMm: number; meltIndex: number;
    }>;
  }>>>("/weather/snow");
}

export function getRunoffData() {
  return request<ApiResponse<Array<{
    lat: number; lng: number;
    runoffDepth: number;
    riskIndex: number;
    riskLevel: string;
    precipitation24h: number;
    soilMoisture: number;
  }>>>("/weather/runoff");
}

export function getEarthquakes(params?: { days?: number; minmag?: number }) {
  const qs = params ? "?" + new URLSearchParams(toStringRecord(params as Record<string, unknown>)).toString() : "";
  return request<ApiResponse<Array<{
    id: string;
    usgsId: string;
    magnitude: number;
    depth: number;
    lat: number;
    lng: number;
    place: string;
    time: string;
    felt: number | null;
    mmi: number | null;
    source: string;
  }>>>(`/seismic/recent${qs}`);
}

export function getMapClusters(params: Record<string, string | number>) {
  const qs = "?" + new URLSearchParams(toStringRecord(params)).toString();
  return request<ApiResponse>(`/map/clusters${qs}`);
}

export function getStats() {
  return request<ApiResponse>("/stats");
}

function toStringRecord(obj: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined && v !== null && v !== "") out[k] = String(v);
  }
  return out;
}
