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

  const res = await fetch(`${BASE}${path}`, { ...options, headers });
  const json = await res.json();

  if (!res.ok) {
    const msg = json?.error?.message ?? `Ошибка ${res.status}`;
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

export function getMe() {
  return request<ApiResponse>("/auth/me");
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

export function getNews(params?: Record<string, string | number | boolean>) {
  const qs = params ? "?" + new URLSearchParams(toStringRecord(params)).toString() : "";
  return request<PaginatedResponse<unknown>>(`/news${qs}`);
}

export function getPrecipitation() {
  return request<ApiResponse<Array<{ lat: number; lng: number; precipitation: number }>>>("/weather/precipitation");
}

export function getSoilMoisture() {
  return request<ApiResponse<Array<{ lat: number; lng: number; moisture: number }>>>("/weather/soil-moisture");
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
