// SPDX-License-Identifier: AGPL-3.0-only

export const INCIDENT_TYPE_LABELS: Record<string, string> = {
  flood: "Затопление",
  mudslide: "Сель",
  landslide: "Оползень",
  road_blocked: "Дорога перекрыта",
  building_damaged: "Повреждение здания",
  power_out: "Отключение электричества",
  water_contaminated: "Загрязнение воды",
};

export const SEVERITY_LABELS: Record<string, string> = {
  low: "Низкая",
  medium: "Средняя",
  high: "Высокая",
  critical: "Критическая",
};

export const INCIDENT_STATUS_LABELS: Record<string, string> = {
  unverified: "Не подтверждено",
  verified: "Подтверждено",
  resolved: "Решено",
  false_report: "Ложный отчёт",
};

export const HELP_REQUEST_TYPE_LABELS: Record<string, string> = {
  need: "Нужна помощь",
  offer: "Предлагаю помощь",
};

export const HELP_CATEGORY_LABELS: Record<string, string> = {
  rescue: "Спасение",
  shelter: "Убежище",
  food: "Еда",
  water: "Вода",
  medicine: "Медикаменты",
  equipment: "Оборудование",
  transport: "Транспорт",
  labor: "Рабочая сила",
  generator: "Генератор",
  pump: "Насос",
};

export const URGENCY_LABELS: Record<string, string> = {
  normal: "Обычная",
  urgent: "Срочная",
  critical: "Критическая",
};

export const HELP_REQUEST_STATUS_LABELS: Record<string, string> = {
  open: "Открыта",
  claimed: "Принята",
  in_progress: "В работе",
  completed: "Выполнена",
  cancelled: "Отменена",
};

export const ALERT_URGENCY_LABELS: Record<string, string> = {
  info: "Информация",
  warning: "Предупреждение",
  critical: "Критическое",
};

export const ALERT_SOURCE_LABELS: Record<string, string> = {
  manual: "Координатор",
  river: "Датчик реки",
  seismic: "Сейсмособытие",
  ai_forecast: "Кунак AI",
  news: "Новости",
};

export const ALERT_SOURCE_ICONS: Record<string, string> = {
  manual: "📢",
  river: "🌊",
  seismic: "🌋",
  ai_forecast: "🤖",
  news: "📰",
};

export const SHELTER_STATUS_LABELS: Record<string, string> = {
  open: "Открыт",
  full: "Заполнен",
  closed: "Закрыт",
};

export const RIVER_TREND_LABELS: Record<string, string> = {
  rising: "Растёт",
  stable: "Стабильный",
  falling: "Падает",
};

export const SOURCE_LABELS: Record<string, string> = {
  pwa: "Сайт",
  telegram: "Telegram",
  vk: "ВКонтакте",
  sms: "СМС",
  meshtastic: "Meshtastic",
};

export const AMENITY_LABELS: Record<string, string> = {
  food: "Еда",
  beds: "Спальные места",
  medical: "Медпомощь",
  power: "Электричество",
  wifi: "Wi-Fi",
};

export const USER_ROLE_LABELS: Record<string, string> = {
  resident: "Житель",
  volunteer: "Волонтёр",
  coordinator: "Координатор",
  admin: "Администратор",
};

export const INCIDENT_TYPES = [
  "flood",
  "mudslide",
  "landslide",
  "road_blocked",
  "building_damaged",
  "power_out",
  "water_contaminated",
] as const;

export const SEVERITIES = ["low", "medium", "high", "critical"] as const;

export const INCIDENT_STATUSES = [
  "unverified",
  "verified",
  "resolved",
  "false_report",
] as const;

export const HELP_REQUEST_TYPES = ["need", "offer"] as const;

export const HELP_CATEGORIES = [
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
] as const;

export const URGENCIES = ["normal", "urgent", "critical"] as const;

export const HELP_REQUEST_STATUSES = [
  "open",
  "claimed",
  "in_progress",
  "completed",
  "cancelled",
] as const;

export const ALERT_URGENCIES = ["info", "warning", "critical"] as const;

export const SHELTER_STATUSES = ["open", "full", "closed"] as const;

export const RIVER_TRENDS = ["rising", "stable", "falling"] as const;

export const SOURCES = [
  "pwa",
  "telegram",
  "vk",
  "sms",
  "meshtastic",
] as const;

export const CHANNELS = [
  "pwa",
  "telegram",
  "vk",
  "sms",
  "meshtastic",
] as const;

export const AMENITIES = [
  "food",
  "beds",
  "medical",
  "power",
  "wifi",
] as const;

export const USER_ROLES = [
  "resident",
  "volunteer",
  "coordinator",
  "admin",
] as const;

export const SEVERITY_COLORS: Record<string, string> = {
  low: "#3B82F6",       // blue
  medium: "#F59E0B",    // amber
  high: "#F97316",      // orange
  critical: "#EF4444",  // red
};

export const URGENCY_COLORS: Record<string, string> = {
  normal: "#3B82F6",
  urgent: "#F97316",
  critical: "#EF4444",
};

export const ALERT_URGENCY_COLORS: Record<string, string> = {
  info: "#3B82F6",
  warning: "#F59E0B",
  critical: "#EF4444",
};

export const SOS_SITUATION_LABELS: Record<string, string> = {
  roof: "На крыше / верхний этаж",
  water_inside: "Вода в доме",
  road: "На дороге / в машине",
  medical: "Нужна медпомощь",
};

export const SOS_SITUATIONS = [
  "roof",
  "water_inside",
  "road",
  "medical",
] as const;

export const DAGESTAN_BOUNDS = {
  north: 44.3,
  south: 41.1,
  east: 48.6,
  west: 45.0,
} as const;

export const MAKHACHKALA_CENTER = {
  lat: 42.9849,
  lng: 47.5047,
} as const;

// Center of all river monitoring stations across Dagestan
export const DAGESTAN_CENTER = {
  lat: 42.35,
  lng: 47.8,
} as const;

export const DEFAULT_MAP_ZOOM = 8;

export const TILE_CACHE_ZOOM_RANGE = { min: 8, max: 16 } as const;
