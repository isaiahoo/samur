// SPDX-License-Identifier: AGPL-3.0-only

export type UserRole = "resident" | "volunteer" | "coordinator" | "admin";

export type IncidentType =
  | "flood"
  | "mudslide"
  | "landslide"
  | "road_blocked"
  | "building_damaged"
  | "power_out"
  | "water_contaminated";

export type Severity = "low" | "medium" | "high" | "critical";

export type IncidentStatus =
  | "unverified"
  | "verified"
  | "resolved"
  | "false_report";

export type HelpRequestType = "need" | "offer";

export type HelpCategory =
  | "rescue"
  | "shelter"
  | "food"
  | "water"
  | "medicine"
  | "equipment"
  | "transport"
  | "labor"
  | "generator"
  | "pump";

export type Urgency = "normal" | "urgent" | "critical";

export type SosSituation = "roof" | "water_inside" | "road" | "medical";

export type HelpRequestStatus =
  | "open"
  | "claimed"
  | "in_progress"
  | "completed"
  | "cancelled";

export type HelpResponseStatus =
  | "responded"
  | "on_way"
  | "arrived"
  | "helped"
  | "cancelled";

export type AlertUrgency = "info" | "warning" | "critical";
export type AlertSource = "manual" | "river" | "seismic" | "ai_forecast" | "news";

export type ShelterStatus = "open" | "full" | "closed";

export type RiverTrend = "rising" | "stable" | "falling";

export type Source = "pwa" | "telegram" | "vk" | "sms" | "meshtastic";

export type Channel = "pwa" | "telegram" | "vk" | "sms" | "meshtastic";

export type Amenity = "food" | "beds" | "medical" | "power" | "wifi";

export interface User {
  id: string;
  name: string | null;
  phone: string | null;
  role: UserRole;
  vkId: string | null;
  tgId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Incident {
  id: string;
  userId: string | null;
  type: IncidentType;
  severity: Severity;
  lat: number;
  lng: number;
  address: string | null;
  description: string | null;
  photoUrls: string[];
  status: IncidentStatus;
  verifiedBy: string | null;
  source: Source;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface UserStats {
  helpsCompleted: number;
  helpsActive: number;
  requestsResolved: number;
  requestsActive: number;
  joinedAt: string;
}

export interface HelpRequestParty {
  id: string;
  name: string | null;
  role: string;
  phone?: string | null;
  // Foundation for the achievements layer — populated server-side for
  // responders on the list / detail / respond endpoints.
  stats?: UserStats;
}

export interface HelpResponse {
  id: string;
  helpRequestId: string;
  userId: string;
  status: HelpResponseStatus;
  note: string | null;
  createdAt: string;
  updatedAt: string;
  user?: HelpRequestParty;
}

export interface HelpMessage {
  id: string;
  helpRequestId: string;
  authorId: string;
  body: string;
  createdAt: string;
  deletedAt?: string | null;
  author?: HelpRequestParty;
}

export interface HelpRequest {
  id: string;
  userId: string | null;
  incidentId: string | null;
  type: HelpRequestType;
  category: HelpCategory;
  description: string | null;
  lat: number;
  lng: number;
  address: string | null;
  urgency: Urgency;
  contactPhone: string | null;
  contactName: string | null;
  status: HelpRequestStatus;
  claimedBy: string | null;
  isSOS: boolean;
  situation: SosSituation | null;
  peopleCount: number | null;
  batteryLevel: number | null;
  photoUrls: string[];
  sourceIp: string | null;
  confidenceScore: number | null;
  source: Source;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  author?: HelpRequestParty | null;
  claimer?: HelpRequestParty | null;
  responses?: HelpResponse[];
  responseCount?: number;
  // Per-caller activity — populated server-side for authenticated callers
  // so the client can surface "Мои отклики" and unread badges without
  // extra round-trips.
  myResponseStatus?: HelpResponseStatus | null;
  unreadMessages?: number;
  lastMessageAt?: string | null;
}

export interface Alert {
  id: string;
  authorId: string;
  urgency: AlertUrgency;
  source: AlertSource;
  title: string;
  body: string;
  geoBounds: unknown | null;
  channels: Channel[];
  sentAt: string;
  expiresAt: string | null;
  deletedAt: string | null;
}

export interface Shelter {
  id: string;
  name: string;
  lat: number;
  lng: number;
  address: string;
  capacity: number;
  currentOccupancy: number;
  amenities: Amenity[];
  contactPhone: string | null;
  status: ShelterStatus;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface RiverLevel {
  id: string;
  riverName: string;
  stationName: string;
  lat: number;
  lng: number;
  levelCm: number | null;
  dangerLevelCm: number | null;
  dischargeCubicM: number | null;
  dischargeMean: number | null;
  dischargeMax: number | null;
  dischargeMedian: number | null;
  dischargeMin: number | null;
  dischargeP25: number | null;
  dischargeP75: number | null;
  dischargeAnnualMean: number | null;
  dataSource: string | null;
  isForecast: boolean;
  trend: RiverTrend;
  measuredAt: string;
  createdAt: string;
  deletedAt: string | null;
}

export interface NewsArticle {
  id: string;
  feedId: string;
  externalId: string;
  title: string;
  summary: string | null;
  body: string | null;
  url: string;
  imageUrl: string | null;
  category: string | null;
  publishedAt: string;
  fetchedAt: string;
  deletedAt: string | null;
}

export interface EarthquakeEvent {
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
}

export interface MapCluster {
  lat: number;
  lng: number;
  count: number;
  type: "incident" | "help_request";
  mostUrgentSeverity: Severity | Urgency;
}

export interface MapPoint {
  id: string;
  lat: number;
  lng: number;
  type: "incident" | "help_request";
  subType: IncidentType | HelpCategory;
  severity: Severity | Urgency;
  status: string;
}

export interface DashboardStats {
  incidentsByType: Record<IncidentType, number>;
  openHelpRequestsByCategory: Record<HelpCategory, number>;
  activeVolunteers: number;
  shelterCapacity: { total: number; occupied: number };
}

export type ChannelStatus = "online" | "degraded" | "offline";

export interface ChannelHealth {
  pwa: ChannelStatus;
  telegram: ChannelStatus;
  vk: ChannelStatus;
  sms: ChannelStatus;
  meshtastic: ChannelStatus;
}

export interface SmsBroadcastEntry {
  phone: string;
  message: string;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: Record<string, string[]>;
  };
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  meta?: {
    total: number;
    page: number;
    limit: number;
  };
}

export interface JwtPayload {
  sub: string;
  role: UserRole;
  iat: number;
  exp: number;
}

export interface AuthResponse {
  token: string;
  user: User;
}

export interface ServerToClientEvents {
  "incident:created": (incident: Incident) => void;
  "incident:updated": (incident: Incident) => void;
  "help_request:created": (request: HelpRequest) => void;
  "help_request:updated": (request: HelpRequest) => void;
  "help_request:claimed": (request: HelpRequest) => void;
  "help_response:changed": (payload: {
    helpRequestId: string;
    responseId: string;
    status: HelpResponseStatus;
    user: HelpRequestParty;
    responseCount: number;
    derivedStatus: HelpRequestStatus;
  }) => void;
  "help_message:created": (message: HelpMessage) => void;
  "alert:broadcast": (alert: Alert) => void;
  "river_level:updated": (level: RiverLevel) => void;
  "shelter:updated": (shelter: Shelter) => void;
  "earthquake:new": (earthquake: EarthquakeEvent) => void;
  "sos:created": (request: HelpRequest) => void;
}

export interface ClientToServerEvents {
  "subscribe:area": (sub: { lat: number; lng: number; radius: number }) => void;
  "unsubscribe:area": () => void;
}
