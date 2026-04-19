// SPDX-License-Identifier: AGPL-3.0-only
import type { ApiResponse, PaginatedResponse, RiverLevel } from "@samur/shared";

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
  consent?: { processing: boolean; distribution: boolean };
}) {
  return request<ApiResponse<{ token: string; user: unknown }>>("/auth/vk/exchange", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function telegramInit(consent?: { processing: boolean; distribution: boolean }) {
  return request<ApiResponse<{ token: string }>>("/auth/telegram/init", {
    method: "POST",
    body: JSON.stringify({ consent }),
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

export function phoneVerify(
  phone: string,
  code: string,
  name?: string,
  role?: string,
  consent?: { processing: boolean; distribution: boolean },
) {
  return request<ApiResponse<{ token: string; user: unknown; isNew: boolean }>>("/auth/phone/verify", {
    method: "POST",
    body: JSON.stringify({ phone, code, name, role, consent }),
  });
}

// 152-ФЗ consent endpoints. /me drives the ConsentGate (existing-user
// gate on first login post-deploy). /record writes a single grant.
export function getMyConsent() {
  return request<ApiResponse<{
    processing: { accepted: boolean; at: string; version: string } | null;
    distribution: { accepted: boolean; at: string; version: string } | null;
    currentVersion: string;
  }>>("/consent/me");
}

export function recordConsent(type: "processing" | "distribution", accepted: boolean) {
  return request<ApiResponse<{ recorded: true }>>("/consent", {
    method: "POST",
    body: JSON.stringify({ type, accepted }),
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
  // Backend includes a fresh JWT in the response when it detects the caller's
  // token carries a stale role claim (e.g. role was changed server-side since
  // the token was issued). Callers should swap it into the auth store.
  return request<ApiResponse & { token?: string }>("/auth/me");
}

// Per-user action record — helpsCompleted / requestsResolved / joinedAt /
// etc. Returned as the `data` field. Foundation for the achievements layer.
export function getUserStats(id: string) {
  return request<ApiResponse>(`/users/${encodeURIComponent(id)}/stats`);
}

// Caller's in-flight work snapshot — drives the profile-menu activity rows
// and the header unread dot. Scoped to the authenticated user.
export interface MyActivity {
  activeResponses: number;
  ownOpenRequests: number;
  unreadMessages: number;
}
export function getMyActivity() {
  return request<ApiResponse<MyActivity>>("/users/me/activity");
}

export function updateProfile(data: { name?: string; role?: string }) {
  // Backend returns a fresh JWT alongside the user whenever the role
  // actually changed — callers should swap it into the auth store.
  return request<ApiResponse & { token?: string }>("/auth/me", {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

/** Invalidate every outstanding JWT for the current user across every
 * device — the server bumps user.tokenVersion, the middleware starts
 * rejecting tokens on the old version. The caller's own token stops
 * working the moment the next request lands, so the client should
 * clear local state and redirect to login immediately after. */
export function logoutAll() {
  return request<ApiResponse<{ tokenVersion: number }>>("/auth/logout-all", {
    method: "POST",
  });
}

/** Admin-only: force a specific user out of every session. Bumps their
 * tokenVersion, disconnects their sockets. Requires coordinator/admin
 * role; self-targeting is rejected server-side (admins use logoutAll). */
export function forceLogoutUser(userId: string) {
  return request<ApiResponse<{ userId: string; tokenVersion: number }>>(
    `/admin/users/${userId}/force-logout`,
    { method: "POST" },
  );
}

export interface AdminUserSummary {
  id: string;
  name: string | null;
  phone: string | null;
  role: string;
  vkId: string | null;
  tgId: string | null;
  createdAt: string;
}

/** Admin-only: paginated user list for the operator UI. `search` does
 * a case-insensitive substring match on name or phone. */
export function getUsers(opts?: { limit?: number; offset?: number; search?: string }) {
  const qs = new URLSearchParams();
  if (opts?.limit) qs.set("limit", String(opts.limit));
  if (opts?.offset) qs.set("offset", String(opts.offset));
  if (opts?.search) qs.set("search", opts.search);
  const suffix = qs.toString() ? `?${qs}` : "";
  return request<ApiResponse<AdminUserSummary[]> & { meta?: { total: number; limit: number; offset: number } }>(
    `/admin/users${suffix}`,
  );
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

/** Attach a typed description and/or an audio URL to an already-fired
 * SOS. For anonymous authors, pass the updateToken returned by the
 * initial POST /sos response. Logged-in authors can omit the token —
 * the server will accept their JWT. */
export function sosFollowUp(
  id: string,
  data: {
    updateToken?: string;
    description?: string;
    audioUrl?: string | null;
    cancel?: boolean;
  },
) {
  return request<ApiResponse>(`/help-requests/sos/${id}/follow-up`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

/** Upload a recorded audio blob for an SOS follow-up. Returns the URL
 * that should be sent back via sosFollowUp({ audioUrl }). */
export async function uploadAudio(blob: Blob): Promise<string> {
  const form = new FormData();
  const ext = blob.type.includes("mp4") ? "mp4" : blob.type.includes("ogg") ? "ogg" : "webm";
  form.append("audio", blob, `voice.${ext}`);
  const token = getToken();
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}/uploads/audio`, {
    method: "POST",
    headers,
    body: form,
  });
  const json = (await res.json()) as { success: boolean; data?: { url: string }; error?: { message: string } };
  if (!res.ok || !json.success || !json.data?.url) {
    throw new ApiError(res.status, "UPLOAD_FAILED", json.error?.message ?? "Ошибка загрузки аудио");
  }
  return json.data.url;
}

export function updateHelpRequest(id: string, data: Record<string, unknown>) {
  return request<ApiResponse>(`/help-requests/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

// Multi-responder endpoints. Any volunteer/coordinator/admin can respond to a
// help request; each responder manages their own progress state independently.
export function respondToHelpRequest(id: string, note?: string) {
  return request<ApiResponse>(`/help-requests/${id}/respond`, {
    method: "POST",
    body: JSON.stringify({ note }),
  });
}
export function updateMyHelpResponse(
  id: string,
  status: "responded" | "on_way" | "arrived" | "helped" | "cancelled",
  note?: string | null,
) {
  return request<ApiResponse>(`/help-requests/${id}/my-response`, {
    method: "PATCH",
    body: JSON.stringify({ status, ...(note !== undefined ? { note } : {}) }),
  });
}
export function cancelMyHelpResponse(id: string) {
  return request<ApiResponse>(`/help-requests/${id}/my-response`, {
    method: "DELETE",
  });
}

// ── Help-request chat (Phase 2) ──────────────────────────────────────────
export function getHelpMessages(id: string, opts?: { before?: string; limit?: number }) {
  const qs = new URLSearchParams();
  if (opts?.before) qs.set("before", opts.before);
  if (opts?.limit) qs.set("limit", String(opts.limit));
  const suffix = qs.toString() ? `?${qs}` : "";
  return request<ApiResponse & { meta?: { unread: number; lastReadAt: string; joinedAt?: string | null } }>(
    `/help-requests/${id}/messages${suffix}`,
  );
}
export function sendHelpMessage(id: string, payload: { body?: string; photoUrls?: string[] }) {
  return request<ApiResponse>(`/help-requests/${id}/messages`, {
    method: "POST",
    body: JSON.stringify({
      body: payload.body ?? "",
      photoUrls: payload.photoUrls ?? [],
    }),
  });
}
export function markHelpMessagesRead(id: string) {
  return request<ApiResponse>(`/help-requests/${id}/messages/read`, {
    method: "POST",
  });
}

export function reportHelpMessage(
  id: string,
  msgId: string,
  payload: { reason: "abuse" | "spam" | "doxxing" | "off_topic" | "other"; details?: string },
) {
  return request<ApiResponse>(`/help-requests/${id}/messages/${msgId}/report`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function deleteHelpMessage(id: string, msgId: string) {
  return request<ApiResponse>(`/help-requests/${id}/messages/${msgId}`, {
    method: "DELETE",
  });
}

export function removeHelpParticipant(id: string, userId: string) {
  return request<ApiResponse>(`/help-requests/${id}/participants/${userId}`, {
    method: "DELETE",
  });
}

export function getMessageReports(status: "open" | "resolved_delete" | "resolved_dismiss" | "all" = "open") {
  return request<ApiResponse>(`/moderation/message-reports?status=${status}`);
}

export function resolveMessageReport(
  reportId: string,
  action: "delete_message" | "dismiss",
) {
  return request<ApiResponse>(`/moderation/message-reports/${reportId}`, {
    method: "PATCH",
    body: JSON.stringify({ action }),
  });
}

export function deleteHelpRequest(id: string) {
  return request<ApiResponse>(`/help-requests/${id}`, { method: "DELETE" });
}

export interface AlertsSituation {
  riverLevels: RiverLevel[];
  incidents: { active: number };
  helpRequests: { urgent: number; critical: number };
  earthquakes: { last24h: number; last24hStrong: number };
  generatedAt: string;
}
export function getAlertsSituation() {
  return request<ApiResponse<AlertsSituation>>("/alerts/situation");
}

export interface AlertsContextItem {
  id: string;
  kind: "news" | "quake" | "help" | "ai-watch";
  timestamp: string;
  title: string;
  subtitle?: string;
  navigateTo?: string;
  externalUrl?: string;
  icon: string;
}
export function getAlertsContext() {
  return request<ApiResponse<AlertsContextItem[]>>("/alerts/context");
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
