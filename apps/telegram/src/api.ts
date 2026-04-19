// SPDX-License-Identifier: AGPL-3.0-only
import crypto from "node:crypto";
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
const TIMEOUT_MS = 15_000;
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 1_000;

class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(id);
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

  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetchWithTimeout(`${BASE}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });

      const json = (await res.json()) as ApiResponse<T>;
      if (!res.ok || !json.success) {
        const err = new ApiError(
          res.status,
          json.error?.code ?? "UNKNOWN",
          json.error?.message ?? "API error",
        );
        // Don't retry 4xx (client errors)
        if (res.status >= 400 && res.status < 500) throw err;
        lastError = err;
      } else {
        return json.data as T;
      }
    } catch (err) {
      if (err instanceof ApiError && err.status >= 400 && err.status < 500) throw err;
      lastError = err;
    }

    if (attempt < MAX_RETRIES) {
      await new Promise((r) => setTimeout(r, RETRY_BASE_MS * 2 ** attempt));
    }
  }

  throw lastError;
}

async function requestPaginated<T>(
  path: string,
  token?: string,
): Promise<{ data: T[]; total: number }> {
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (config.API_INTERNAL_TOKEN)
    headers["X-Internal-Token"] = config.API_INTERNAL_TOKEN;

  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetchWithTimeout(`${BASE}${path}`, { headers });
      const json = (await res.json()) as PaginatedResponse<T>;
      if (!res.ok || !json.success) {
        const err = new ApiError(
          res.status,
          json.error?.code ?? "UNKNOWN",
          json.error?.message ?? "API error",
        );
        if (res.status >= 400 && res.status < 500) throw err;
        lastError = err;
      } else {
        return { data: json.data ?? [], total: json.meta?.total ?? 0 };
      }
    } catch (err) {
      if (err instanceof ApiError && err.status >= 400 && err.status < 500) throw err;
      lastError = err;
    }

    if (attempt < MAX_RETRIES) {
      await new Promise((r) => setTimeout(r, RETRY_BASE_MS * 2 ** attempt));
    }
  }

  throw lastError;
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

export async function createSOS(
  data: {
    lat: number;
    lng: number;
    situation?: string;
    peopleCount?: number;
    contactName?: string;
  },
  token: string,
): Promise<HelpRequest> {
  return request<HelpRequest>(
    "POST",
    "/help-requests/sos",
    { ...data, source: "telegram" },
    token,
  );
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

export async function getMe(token: string): Promise<Record<string, unknown>> {
  return request<Record<string, unknown>>("GET", "/auth/me", undefined, token);
}

/**
 * Authenticate a Telegram user via the PWA's /auth/telegram endpoint.
 * The bot generates the HMAC hash using the bot token — same verification
 * as the Telegram Login Widget, but constructed server-side.
 */
export async function authenticateForPWA(
  tgId: number,
  firstName: string,
  lastName?: string,
  consent?: { processing: boolean; distribution: boolean },
): Promise<{ token: string; user: Record<string, unknown> }> {
  const authDate = Math.floor(Date.now() / 1000);
  const data: Record<string, string | number> = {
    id: tgId,
    first_name: firstName,
    auth_date: authDate,
  };
  if (lastName) data.last_name = lastName;

  // Generate HMAC-SHA256 hash. Note: `consent` is NOT included in the
  // HMAC — Telegram's Login Widget spec hashes only the user-identity
  // fields, and we mirror that on the server. Consent is a separate
  // sibling field on the request body.
  const secretKey = crypto.createHash("sha256").update(config.TG_BOT_TOKEN).digest();
  const checkString = Object.keys(data)
    .sort()
    .map((k) => `${k}=${data[k]}`)
    .join("\n");
  const hash = crypto.createHmac("sha256", secretKey).update(checkString).digest("hex");

  data.hash = hash;

  return request<{ token: string; user: Record<string, unknown> }>(
    "POST",
    "/auth/telegram",
    consent ? { ...data, consent } : data,
  );
}

export { ApiError };
