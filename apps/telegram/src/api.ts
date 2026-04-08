// SPDX-License-Identifier: AGPL-3.0-only
import { config } from "./config.js";
import type {
  ApiResponse,
  PaginatedResponse,
  Incident,
  HelpRequest,
  Alert,
  Shelter,
  RiverLevel,
} from "@samur/shared";

const BASE = `${config.API_BASE_URL}/api/v1`;

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
  token?: string,
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (config.API_INTERNAL_TOKEN)
    headers["X-Internal-Token"] = config.API_INTERNAL_TOKEN;

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
      json.error?.message ?? "API error",
    );
  }
  return json.data as T;
}

async function requestPaginated<T>(
  path: string,
  token?: string,
): Promise<{ data: T[]; total: number }> {
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (config.API_INTERNAL_TOKEN)
    headers["X-Internal-Token"] = config.API_INTERNAL_TOKEN;

  const res = await fetch(`${BASE}${path}`, { headers });
  const json = (await res.json()) as PaginatedResponse<T>;
  if (!res.ok || !json.success) {
    throw new ApiError(
      res.status,
      json.error?.code ?? "UNKNOWN",
      json.error?.message ?? "API error",
    );
  }
  return { data: json.data ?? [], total: json.meta?.total ?? 0 };
}

// -- Auth --

export async function findOrCreateTelegramUser(
  tgId: string,
  name: string,
): Promise<{ token: string }> {
  // Register with tgId as phone placeholder — the API will link by tgId
  const token = await request<{ token: string; user: unknown }>(
    "POST",
    "/auth/register",
    {
      phone: `tg_${tgId}`,
      password: `tg_${tgId}_auto`,
      name,
      role: "resident",
    },
  ).then((r) => r.token);
  return { token };
}

export async function loginTelegramUser(
  tgId: string,
): Promise<{ token: string } | null> {
  try {
    const result = await request<{ token: string; user: unknown }>(
      "POST",
      "/auth/login",
      {
        phone: `tg_${tgId}`,
        password: `tg_${tgId}_auto`,
      },
    );
    return { token: result.token };
  } catch {
    return null;
  }
}

// -- Incidents --

export async function createIncident(
  data: {
    type: string;
    severity: string;
    lat: number;
    lng: number;
    address?: string;
    description?: string;
    photoUrls?: string[];
  },
  token: string,
): Promise<Incident> {
  return request<Incident>("POST", "/incidents", { ...data, source: "telegram" }, token);
}

export async function getUserIncidents(
  token: string,
): Promise<Incident[]> {
  const { data } = await requestPaginated<Incident>(
    "/incidents?limit=10&sort=createdAt&order=desc",
    token,
  );
  return data;
}

// -- Help Requests --

export async function createHelpRequest(
  data: {
    type: string;
    category: string;
    lat: number;
    lng: number;
    address?: string;
    description?: string;
    urgency?: string;
    contactPhone?: string;
    contactName?: string;
  },
  token: string,
): Promise<HelpRequest> {
  return request<HelpRequest>(
    "POST",
    "/help-requests",
    { ...data, source: "telegram" },
    token,
  );
}

export async function getUserHelpRequests(
  token: string,
): Promise<HelpRequest[]> {
  const { data } = await requestPaginated<HelpRequest>(
    "/help-requests?limit=10&sort=createdAt&order=desc",
    token,
  );
  return data;
}

export async function cancelHelpRequest(
  id: string,
  token: string,
): Promise<void> {
  await request("PATCH", `/help-requests/${id}`, { status: "cancelled" }, token);
}

// -- Alerts --

export async function getLatestAlerts(): Promise<Alert[]> {
  const { data } = await requestPaginated<Alert>(
    "/alerts?limit=5&active=true",
  );
  return data;
}

// -- Shelters --

export async function getShelters(
  lat?: number,
  lng?: number,
): Promise<Shelter[]> {
  let path = "/shelters?limit=20&status=open";
  if (lat !== undefined && lng !== undefined) {
    path += `&lat=${lat}&lng=${lng}&radius=50`;
  }
  const { data } = await requestPaginated<Shelter>(path);
  return data;
}

// -- River Levels --

export async function getLatestRiverLevels(): Promise<RiverLevel[]> {
  const { data } = await requestPaginated<RiverLevel>(
    "/river-levels?latest=true&limit=20",
  );
  return data;
}

export { ApiError };
