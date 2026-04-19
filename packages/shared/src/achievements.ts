// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Achievement system — recognition of civic contribution, not a game.
 *
 * Every achievement is derivable from the existing help_responses,
 * help_requests, and users tables — no new schema, no "awarded_at"
 * storage. The server computes the earned set on each profile load.
 *
 * This file is the single source of truth: the server imports the
 * dictionary and derivation function; the client imports the dictionary
 * to render locked states + copy, and trusts the server's earned list.
 */

export type AchievementTier = "bronze" | "silver" | "gold";

export type AchievementUnlock =
  | { kind: "helps"; threshold: number; minConfirmed?: number; minDistinctConfirmers?: number }
  | { kind: "requests"; threshold: number }
  | { kind: "tenure_days"; threshold: number }
  | { kind: "category_helps"; category: string; threshold: number; confirmedOnly?: boolean }
  | { kind: "fast_response"; thresholdMinutes: number; minHelps: number; minConfirmed?: number }
  | { kind: "early_adopter"; cutoffDate: string } // ISO yyyy-mm-dd
  | { kind: "installed_pwa" };

export interface Achievement {
  key: string;
  name: string;
  description: string;
  icon: string; // emoji — renders consistently on every device without assets
  tier: AchievementTier;
  unlock: AchievementUnlock;
}

export const ACHIEVEMENTS: readonly Achievement[] = [
  // ── Milestones ──────────────────────────────────────────────────────
  {
    key: "first_help",
    name: "Первая помощь",
    description: "Завершили первый отклик — добро пожаловать в сообщество.",
    icon: "🤝",
    tier: "bronze",
    unlock: { kind: "helps", threshold: 1 },
  },
  {
    key: "five_helps",
    name: "Пять откликов",
    description: "Пять завершённых помощей. Вас узнают соседи.",
    icon: "🤝",
    tier: "bronze",
    unlock: { kind: "helps", threshold: 5 },
  },
  {
    key: "ten_helps",
    name: "Опытный кунак",
    description: "Десять помощей, минимум две подтверждены спасибо от соседей.",
    icon: "⭐",
    tier: "silver",
    unlock: { kind: "helps", threshold: 10, minConfirmed: 2 },
  },
  {
    key: "fifty_helps",
    name: "Столп сообщества",
    description: "Пятьдесят помощей, десять подтверждены разными людьми.",
    icon: "🌟",
    tier: "gold",
    unlock: { kind: "helps", threshold: 50, minConfirmed: 10, minDistinctConfirmers: 10 },
  },

  // ── Request-side ────────────────────────────────────────────────────
  {
    key: "first_request",
    name: "Попросили помощи",
    description: "Создали первую заявку — просить помощь не стыдно.",
    icon: "📣",
    tier: "bronze",
    unlock: { kind: "requests", threshold: 1 },
  },

  // ── Speed / quality ─────────────────────────────────────────────────
  {
    key: "fast_responder",
    name: "Быстрый отклик",
    description: "В среднем выезжаете за 30 минут — хотя бы одно спасибо подтверждено.",
    icon: "⚡",
    tier: "silver",
    unlock: { kind: "fast_response", thresholdMinutes: 30, minHelps: 5, minConfirmed: 1 },
  },

  // ── Category specialisations (require confirmed помощь) ─────────────
  {
    key: "rescue_specialist",
    name: "Спасатель",
    description: "Три подтверждённые спасательные помощи.",
    icon: "🛟",
    tier: "silver",
    unlock: { kind: "category_helps", category: "rescue", threshold: 3, confirmedOnly: true },
  },
  {
    key: "medical_helper",
    name: "Медицинская помощь",
    description: "Три подтверждённые медицинские помощи.",
    icon: "💊",
    tier: "silver",
    unlock: { kind: "category_helps", category: "medicine", threshold: 3, confirmedOnly: true },
  },
  {
    key: "food_water",
    name: "Накормил и напоил",
    description: "Три подтверждённые помощи с едой или водой.",
    icon: "🍞",
    tier: "silver",
    unlock: { kind: "category_helps", category: "food_water", threshold: 3, confirmedOnly: true },
  },
  {
    key: "transporter",
    name: "Свой транспорт",
    description: "Три подтверждённые транспортные помощи.",
    icon: "🚗",
    tier: "silver",
    unlock: { kind: "category_helps", category: "transport", threshold: 3, confirmedOnly: true },
  },
  {
    key: "shelter_provider",
    name: "Приютил",
    description: "Три подтверждённые помощи с убежищем.",
    icon: "🏠",
    tier: "silver",
    unlock: { kind: "category_helps", category: "shelter", threshold: 3, confirmedOnly: true },
  },

  // ── Install / engagement ────────────────────────────────────────────
  {
    key: "installed_pwa",
    name: "В сообществе",
    description: "Установили Кунак на главный экран — всегда под рукой в кризис.",
    icon: "📱",
    tier: "bronze",
    unlock: { kind: "installed_pwa" },
  },

  // ── Tenure ──────────────────────────────────────────────────────────
  {
    key: "early_adopter",
    name: "Первопроходец",
    description: "Присоединились в первый месяц работы платформы.",
    icon: "🚀",
    tier: "gold",
    unlock: { kind: "early_adopter", cutoffDate: "2026-05-01" },
  },
  {
    key: "veteran",
    name: "Ветеран",
    description: "Полгода в сообществе.",
    icon: "🕰️",
    tier: "gold",
    unlock: { kind: "tenure_days", threshold: 180 },
  },
] as const;

// ── Derivation ──────────────────────────────────────────────────────────

export interface UserActivitySnapshot {
  helpsCompleted: number;
  requestsCreated: number;
  joinedAt: string; // ISO
  helpsByCategory: Record<string, number>;
  avgResponseToOnWayMinutes: number | null;
  installedPwa: boolean;
  /** Кунак-рукопожатие counts — mutually confirmed help only. */
  confirmedHelps: number;
  confirmedHelpsByCategory: Record<string, number>;
  distinctConfirmers: number;
}

/**
 * Given a user's activity, return the keys of achievements they've earned.
 * Pure, deterministic — lives in shared so client can show progress for
 * locked achievements by comparing the same snapshot against unlock criteria.
 */
export function computeEarnedAchievements(a: UserActivitySnapshot): string[] {
  const earned: string[] = [];
  const now = Date.now();
  const joined = new Date(a.joinedAt).getTime();
  const tenureDays = Math.floor((now - joined) / (86_400_000));

  for (const ach of ACHIEVEMENTS) {
    let unlocked = false;
    switch (ach.unlock.kind) {
      case "helps": {
        const u = ach.unlock;
        unlocked =
          a.helpsCompleted >= u.threshold &&
          (u.minConfirmed == null || a.confirmedHelps >= u.minConfirmed) &&
          (u.minDistinctConfirmers == null || a.distinctConfirmers >= u.minDistinctConfirmers);
        break;
      }
      case "requests":
        unlocked = a.requestsCreated >= ach.unlock.threshold;
        break;
      case "tenure_days":
        unlocked = tenureDays >= ach.unlock.threshold;
        break;
      case "category_helps": {
        const bucket = ach.unlock.confirmedOnly ? a.confirmedHelpsByCategory : a.helpsByCategory;
        // food_water is a synthetic category combining food + water counts.
        const count =
          ach.unlock.category === "food_water"
            ? (bucket.food ?? 0) + (bucket.water ?? 0)
            : bucket[ach.unlock.category] ?? 0;
        unlocked = count >= ach.unlock.threshold;
        break;
      }
      case "fast_response": {
        const u = ach.unlock;
        unlocked =
          a.helpsCompleted >= u.minHelps &&
          a.avgResponseToOnWayMinutes !== null &&
          a.avgResponseToOnWayMinutes <= u.thresholdMinutes &&
          (u.minConfirmed == null || a.confirmedHelps >= u.minConfirmed);
        break;
      }
      case "early_adopter":
        unlocked = new Date(a.joinedAt) < new Date(ach.unlock.cutoffDate);
        break;
      case "installed_pwa":
        unlocked = a.installedPwa === true;
        break;
    }
    if (unlocked) earned.push(ach.key);
  }
  return earned;
}

/**
 * For locked achievements — how close is the user? Returns a 0–1 fraction
 * for those with a numeric progress model; null for boolean-style unlocks
 * (early_adopter, fast_response).
 */
export function computeAchievementProgress(
  ach: Achievement,
  a: UserActivitySnapshot,
): { current: number; target: number } | null {
  switch (ach.unlock.kind) {
    case "helps": {
      // When the achievement also requires confirmed helps, show whichever
      // gate the user is further from — otherwise the progress bar fills
      // to 100% on self-reported helps while the silver/gold stays locked.
      const u = ach.unlock;
      const helpsFrac = a.helpsCompleted / u.threshold;
      const confirmedFrac = u.minConfirmed != null ? a.confirmedHelps / u.minConfirmed : Infinity;
      const distinctFrac = u.minDistinctConfirmers != null ? a.distinctConfirmers / u.minDistinctConfirmers : Infinity;
      if (confirmedFrac < helpsFrac && u.minConfirmed != null) {
        return { current: Math.min(a.confirmedHelps, u.minConfirmed), target: u.minConfirmed };
      }
      if (distinctFrac < helpsFrac && u.minDistinctConfirmers != null) {
        return { current: Math.min(a.distinctConfirmers, u.minDistinctConfirmers), target: u.minDistinctConfirmers };
      }
      return { current: Math.min(a.helpsCompleted, u.threshold), target: u.threshold };
    }
    case "requests":
      return { current: Math.min(a.requestsCreated, ach.unlock.threshold), target: ach.unlock.threshold };
    case "tenure_days": {
      const days = Math.floor((Date.now() - new Date(a.joinedAt).getTime()) / 86_400_000);
      return { current: Math.min(days, ach.unlock.threshold), target: ach.unlock.threshold };
    }
    case "category_helps": {
      const bucket = ach.unlock.confirmedOnly ? a.confirmedHelpsByCategory : a.helpsByCategory;
      const count =
        ach.unlock.category === "food_water"
          ? (bucket.food ?? 0) + (bucket.water ?? 0)
          : bucket[ach.unlock.category] ?? 0;
      return { current: Math.min(count, ach.unlock.threshold), target: ach.unlock.threshold };
    }
    // Non-numeric unlocks don't show a progress bar.
    case "fast_response":
    case "early_adopter":
    case "installed_pwa":
      return null;
  }
}
