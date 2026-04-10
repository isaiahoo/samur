// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Conversation state for multi-step flows (report, help).
 * Persisted to Redis with configurable TTL.
 */

import { redis } from "./redis.js";
import { config } from "./config.js";

export type FlowType = "report" | "help";

export interface ReportState {
  flow: "report";
  step: "type" | "location" | "severity" | "description" | "done";
  type?: string;
  lat?: number;
  lng?: number;
  address?: string;
  severity?: string;
  description?: string;
  photoUrls?: string[];
}

export interface HelpState {
  flow: "help";
  step: "kind" | "category" | "location" | "description" | "contact" | "done";
  kind?: "need" | "offer";
  category?: string;
  lat?: number;
  lng?: number;
  address?: string;
  description?: string;
  contactPhone?: string;
  contactName?: string;
}

export type ConversationState = ReportState | HelpState;

const KEY_PREFIX = "tg:state:";

export async function getState(chatId: number): Promise<ConversationState | null> {
  try {
    const raw = await redis.get(`${KEY_PREFIX}${chatId}`);
    if (!raw) return null;
    return JSON.parse(raw) as ConversationState;
  } catch {
    return null;
  }
}

export async function setState(chatId: number, state: ConversationState): Promise<void> {
  try {
    await redis.set(
      `${KEY_PREFIX}${chatId}`,
      JSON.stringify(state),
      "EX",
      config.STATE_TTL_SEC,
    );
  } catch (err) {
    console.error("Failed to persist state:", err);
  }
}

export async function clearState(chatId: number): Promise<void> {
  try {
    await redis.del(`${KEY_PREFIX}${chatId}`);
  } catch {
    // best-effort
  }
}
