// SPDX-License-Identifier: AGPL-3.0-only
import { z } from "zod";

const lat = z.number().min(-90).max(90);
const lng = z.number().min(-180).max(180);
const phone = z.string()
  .transform((v) => v.replace(/[\s\-\(\)]/g, ""))
  .transform((v) => {
    // Normalize Russian 8XXXXXXXXXX → +7XXXXXXXXXX
    if (/^8[0-9]{10}$/.test(v)) return "+7" + v.slice(1);
    return v;
  })
  .pipe(z.string().regex(/^\+?[0-9]{7,15}$/, "Неверный формат телефона"));
const cuid = z.string().min(1);

export const UserRoleSchema = z.enum([
  "resident",
  "volunteer",
  "coordinator",
  "admin",
]);

export const IncidentTypeSchema = z.enum([
  "flood",
  "mudslide",
  "landslide",
  "road_blocked",
  "building_damaged",
  "power_out",
  "water_contaminated",
]);

export const SeveritySchema = z.enum(["low", "medium", "high", "critical"]);

export const IncidentStatusSchema = z.enum([
  "unverified",
  "verified",
  "resolved",
  "false_report",
]);

export const HelpRequestTypeSchema = z.enum(["need", "offer"]);

export const HelpCategorySchema = z.enum([
  "rescue",
  "shelter",
  "food",
  "water",
  "medicine",
  "equipment",
  "transport",
  "labor",
  "generator",
  "pump",
]);

export const UrgencySchema = z.enum(["normal", "urgent", "critical"]);

export const SosSituationSchema = z.enum(["roof", "water_inside", "road", "medical"]);

export const HelpRequestStatusSchema = z.enum([
  "open",
  "claimed",
  "in_progress",
  "completed",
  "cancelled",
]);

export const AlertUrgencySchema = z.enum(["info", "warning", "critical"]);

export const ShelterStatusSchema = z.enum(["open", "full", "closed"]);

export const RiverTrendSchema = z.enum(["rising", "stable", "falling"]);

export const SourceSchema = z.enum([
  "pwa",
  "telegram",
  "vk",
  "sms",
  "meshtastic",
]);

export const ChannelSchema = z.enum([
  "pwa",
  "telegram",
  "vk",
  "sms",
  "meshtastic",
]);

export const AmenitySchema = z.enum([
  "food",
  "beds",
  "medical",
  "power",
  "wifi",
]);

export const CreateIncidentSchema = z.object({
  type: IncidentTypeSchema,
  severity: SeveritySchema,
  lat,
  lng,
  address: z.string().max(500).optional(),
  description: z.string().max(2000).optional(),
  photoUrls: z.array(z.string().url()).max(10).optional(),
  source: SourceSchema.optional(),
});

export const UpdateIncidentSchema = z.object({
  severity: SeveritySchema.optional(),
  description: z.string().max(2000).optional(),
  status: IncidentStatusSchema.optional(),
  photoUrls: z.array(z.string().url()).max(10).optional(),
});

export const CreateHelpRequestSchema = z.object({
  incidentId: cuid.optional(),
  type: HelpRequestTypeSchema,
  category: HelpCategorySchema,
  description: z.string().max(2000).optional(),
  lat,
  lng,
  address: z.string().max(500).optional(),
  urgency: UrgencySchema.optional(),
  contactPhone: phone.optional(),
  contactName: z.string().max(200).optional(),
  photoUrls: z.array(z.string().min(1).max(500).regex(/^\/api\/v1\/uploads\/[a-f0-9]+\.\w+$/, "Недопустимый URL фото")).max(5).optional(),
  source: SourceSchema.optional(),
});

export const UpdateHelpRequestSchema = z.object({
  description: z.string().max(2000).optional(),
  urgency: UrgencySchema.optional(),
  status: HelpRequestStatusSchema.optional(),
  contactPhone: phone.optional(),
  contactName: z.string().max(200).optional(),
  photoUrls: z.array(z.string().min(1).max(500).regex(/^\/api\/v1\/uploads\/[a-f0-9]+\.\w+$/, "Недопустимый URL фото")).max(5).optional(),
});

export const CreateSOSSchema = z.object({
  lat,
  lng,
  situation: SosSituationSchema.optional(),
  peopleCount: z.number().int().min(1).max(100).optional(),
  contactPhone: phone.optional(),
  contactName: z.string().max(200).optional(),
  batteryLevel: z.number().int().min(0).max(100).optional(),
  source: SourceSchema.optional(),
});

export type CreateSOSInput = z.infer<typeof CreateSOSSchema>;

export const CreateAlertSchema = z.object({
  urgency: AlertUrgencySchema,
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(5000),
  geoBounds: z
    .object({
      type: z.literal("Polygon"),
      coordinates: z.array(z.array(z.tuple([z.number(), z.number()]))),
    })
    .optional(),
  channels: z.array(ChannelSchema).min(1),
  expiresAt: z.string().datetime().optional(),
});

export const UpdateAlertSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  body: z.string().min(1).max(5000).optional(),
  expiresAt: z.string().datetime().nullable().optional(),
});

export const CreateShelterSchema = z.object({
  name: z.string().min(1).max(300),
  lat,
  lng,
  address: z.string().min(1).max(500),
  capacity: z.number().int().positive(),
  currentOccupancy: z.number().int().min(0).optional(),
  amenities: z.array(AmenitySchema).optional(),
  contactPhone: phone.optional(),
  status: ShelterStatusSchema.optional(),
});

export const UpdateShelterSchema = z.object({
  name: z.string().min(1).max(300).optional(),
  capacity: z.number().int().positive().optional(),
  currentOccupancy: z.number().int().min(0).optional(),
  amenities: z.array(AmenitySchema).optional(),
  contactPhone: phone.optional(),
  status: ShelterStatusSchema.optional(),
});

export const CreateRiverLevelSchema = z.object({
  riverName: z.string().min(1).max(200),
  stationName: z.string().min(1).max(200),
  lat,
  lng,
  levelCm: z.number().positive().nullable().optional(),
  dangerLevelCm: z.number().positive().nullable().optional(),
  dischargeCubicM: z.number().nonnegative().nullable().optional(),
  dischargeMean: z.number().nonnegative().nullable().optional(),
  dischargeMax: z.number().nonnegative().nullable().optional(),
  dischargeMedian: z.number().nonnegative().nullable().optional(),
  dischargeMin: z.number().nonnegative().nullable().optional(),
  dischargeP25: z.number().nonnegative().nullable().optional(),
  dischargeP75: z.number().nonnegative().nullable().optional(),
  dischargeAnnualMean: z.number().nonnegative().nullable().optional(),
  dataSource: z.string().max(50).nullable().optional(),
  isForecast: z.boolean().optional().default(false),
  trend: RiverTrendSchema,
  measuredAt: z.string().datetime(),
});

export const TelegramAuthSchema = z.object({
  id: z.coerce.number().int().positive(),
  first_name: z.string().min(1).max(200),
  last_name: z.string().max(200).optional(),
  username: z.string().max(200).optional(),
  photo_url: z.string().url().optional(),
  auth_date: z.coerce.number().int().positive(),
  hash: z.string().length(64),
});

export const LoginSchema = z.object({
  phone: phone,
  password: z.string().min(6).max(128),
});

export const RegisterSchema = z.object({
  name: z.string().min(1).max(200),
  phone: phone,
  password: z.string().min(6).max(128),
});

export const PhoneRequestSchema = z.object({
  phone: phone,
});

export const PhoneVerifySchema = z.object({
  phone: phone,
  code: z.string().regex(/^\d{4,6}$/, "Код должен состоять из 4-6 цифр"),
  name: z.string().min(1).max(200).optional(),
  role: z.enum(["resident", "volunteer"]).optional(),
});

export const SortOrderSchema = z.enum(["asc", "desc"]).default("desc");

export const PaginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const GeoFilterSchema = z.object({
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  radius: z.coerce.number().positive().max(100000).optional(), // meters, max 100km
});

export const IncidentQuerySchema = PaginationSchema.merge(GeoFilterSchema).extend({
  type: IncidentTypeSchema.optional(),
  severity: SeveritySchema.optional(),
  status: IncidentStatusSchema.optional(),
  source: SourceSchema.optional(),
  sort: z.enum(["created_at", "severity", "updated_at"]).default("created_at"),
  order: SortOrderSchema,
  north: z.coerce.number().optional(),
  south: z.coerce.number().optional(),
  east: z.coerce.number().optional(),
  west: z.coerce.number().optional(),
});

export const HelpRequestQuerySchema = PaginationSchema.merge(GeoFilterSchema).extend({
  type: HelpRequestTypeSchema.optional(),
  category: HelpCategorySchema.optional(),
  status: HelpRequestStatusSchema.optional(),
  urgency: UrgencySchema.optional(),
  source: SourceSchema.optional(),
  sort: z.enum(["created_at", "urgency", "updated_at"]).default("created_at"),
  order: SortOrderSchema,
  north: z.coerce.number().optional(),
  south: z.coerce.number().optional(),
  east: z.coerce.number().optional(),
  west: z.coerce.number().optional(),
});

export const AlertQuerySchema = PaginationSchema.extend({
  urgency: AlertUrgencySchema.optional(),
  active: z.coerce.boolean().optional(), // only non-expired
  sort: z.enum(["sent_at", "urgency"]).default("sent_at"),
  order: SortOrderSchema,
});

export const ShelterQuerySchema = PaginationSchema.merge(GeoFilterSchema).extend({
  status: ShelterStatusSchema.optional(),
  amenity: AmenitySchema.optional(),
  sort: z.enum(["created_at", "current_occupancy", "name"]).default("created_at"),
  order: SortOrderSchema,
});

export const RiverLevelQuerySchema = PaginationSchema.extend({
  riverName: z.string().optional(),
  stationName: z.string().optional(),
  latest: z.coerce.boolean().optional(), // only latest per station
  sort: z.enum(["measured_at", "level_cm"]).default("measured_at"),
  order: SortOrderSchema,
});

export const NewsArticleQuerySchema = PaginationSchema.extend({
  feedId: z.string().optional(),
  category: z.string().optional(),
  sort: z.enum(["published_at", "fetched_at"]).default("published_at"),
  order: SortOrderSchema,
});

export type NewsArticleQuery = z.infer<typeof NewsArticleQuerySchema>;

export const MapClusterQuerySchema = z.object({
  zoom: z.coerce.number().int().min(1).max(20),
  south: z.coerce.number(),
  west: z.coerce.number(),
  north: z.coerce.number(),
  east: z.coerce.number(),
});

export const SmsWebhookSchema = z.object({
  from: z.string(),
  message: z.string().min(1).max(500),
  timestamp: z.string().datetime().optional(),
});

export const MeshtasticWebhookSchema = z.object({
  node_id: z.string().regex(/^[0-9a-f]{4,8}$/i, "Invalid Meshtastic node ID format"),
  message: z.string().min(1).max(500),
  lat: z.number().optional(),
  lng: z.number().optional(),
  timestamp: z.string().datetime().optional(),
});

export type CreateIncidentInput = z.infer<typeof CreateIncidentSchema>;
export type UpdateIncidentInput = z.infer<typeof UpdateIncidentSchema>;
export type CreateHelpRequestInput = z.infer<typeof CreateHelpRequestSchema>;
export type UpdateHelpRequestInput = z.infer<typeof UpdateHelpRequestSchema>;
export type CreateAlertInput = z.infer<typeof CreateAlertSchema>;
export type UpdateAlertInput = z.infer<typeof UpdateAlertSchema>;
export type CreateShelterInput = z.infer<typeof CreateShelterSchema>;
export type UpdateShelterInput = z.infer<typeof UpdateShelterSchema>;
export type CreateRiverLevelInput = z.infer<typeof CreateRiverLevelSchema>;
export type TelegramAuthInput = z.infer<typeof TelegramAuthSchema>;
export type LoginInput = z.infer<typeof LoginSchema>;
export type RegisterInput = z.infer<typeof RegisterSchema>;
export type PhoneRequestInput = z.infer<typeof PhoneRequestSchema>;
export type PhoneVerifyInput = z.infer<typeof PhoneVerifySchema>;
export type IncidentQuery = z.infer<typeof IncidentQuerySchema>;
export type HelpRequestQuery = z.infer<typeof HelpRequestQuerySchema>;
export type AlertQuery = z.infer<typeof AlertQuerySchema>;
export type ShelterQuery = z.infer<typeof ShelterQuerySchema>;
export type RiverLevelQuery = z.infer<typeof RiverLevelQuerySchema>;
export type MapClusterQuery = z.infer<typeof MapClusterQuerySchema>;
export const MeshtasticHeartbeatSchema = z.object({
  node_id: z.string().regex(/^[0-9a-f]{4,8}$/i, "Invalid Meshtastic node ID format"),
  uptime_seconds: z.number().optional(),
  battery_level: z.number().optional(),
  channel_utilization: z.number().optional(),
});

export type SmsWebhookInput = z.infer<typeof SmsWebhookSchema>;
export type MeshtasticWebhookInput = z.infer<typeof MeshtasticWebhookSchema>;
export type MeshtasticHeartbeatInput = z.infer<typeof MeshtasticHeartbeatSchema>;
