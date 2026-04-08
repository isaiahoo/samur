// SPDX-License-Identifier: AGPL-3.0-only
import type {
  ApiResponse,
  PaginatedResponse,
  Incident,
  HelpRequest,
  Alert,
  Shelter,
  RiverLevel,
} from "@samur/shared";

const BASE = "/api/v1";

let authToken: string | null = null;

export function setToken(token: string): void {
  authToken = token;
}

export function getToken(): string | null {
  return authToken;
}

class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (authToken) headers["Authorization"] = `Bearer ${authToken}`;

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const json = (await res.json()) as ApiResponse<T>;
  if (!res.ok || !json.success) {
    throw new ApiError(
      res.status,
      json.error?.code ?? "UNKNOWN",
      json.error?.message ?? "Ошибка сервера",
    );
  }
  return json.data as T;
}

async function list<T>(path: string): Promise<T[]> {
  const headers: Record<string, string> = {};
  if (authToken) headers["Authorization"] = `Bearer ${authToken}`;

  const res = await fetch(`${BASE}${path}`, { headers });
  const json = (await res.json()) as PaginatedResponse<T>;
  if (!res.ok || !json.success) {
    throw new ApiError(
      res.status,
      json.error?.code ?? "UNKNOWN",
      json.error?.message ?? "Ошибка сервера",
    );
  }
  return json.data ?? [];
}

// Auth
export function authVk(launchParams: string, name?: string) {
  return request<{ token: string; user: unknown }>("POST", "/auth/vk", {
    launchParams,
    name,
  });
}

// Incidents
export function getIncidents(params: string) {
  return list<Incident>(`/incidents?${params}`);
}

export function createIncident(data: Record<string, unknown>) {
  return request<Incident>("POST", "/incidents", { ...data, source: "vk" });
}

// Help Requests
export function getHelpRequests(params: string) {
  return list<HelpRequest>(`/help-requests?${params}`);
}

export function createHelpRequest(data: Record<string, unknown>) {
  return request<HelpRequest>("POST", "/help-requests", { ...data, source: "vk" });
}

export function claimHelpRequest(id: string) {
  return request<HelpRequest>("PATCH", `/help-requests/${id}`, { status: "claimed" });
}

// Alerts
export function getAlerts() {
  return list<Alert>("/alerts?limit=20&active=true");
}

// Shelters
export function getShelters(lat?: number, lng?: number) {
  let path = "/shelters?limit=20&status=open";
  if (lat !== undefined && lng !== undefined) {
    path += `&lat=${lat}&lng=${lng}&radius=50`;
  }
  return list<Shelter>(path);
}

// River Levels
export function getRiverLevels() {
  return list<RiverLevel>("/river-levels?latest=true&limit=20");
}

export { ApiError };
