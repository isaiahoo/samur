// SPDX-License-Identifier: AGPL-3.0-only

/**
 * In-memory conversation state for multi-step flows (report, help).
 * Keyed by chatId. Auto-expires after 10 minutes of inactivity.
 */

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

interface StateEntry {
  state: ConversationState;
  updatedAt: number;
}

const STATE_TTL_MS = 10 * 60 * 1000;
const conversations = new Map<number, StateEntry>();

export function getState(chatId: number): ConversationState | null {
  const entry = conversations.get(chatId);
  if (!entry) return null;
  if (Date.now() - entry.updatedAt > STATE_TTL_MS) {
    conversations.delete(chatId);
    return null;
  }
  return entry.state;
}

export function setState(chatId: number, state: ConversationState): void {
  conversations.set(chatId, { state, updatedAt: Date.now() });
}

export function clearState(chatId: number): void {
  conversations.delete(chatId);
}

// Periodic cleanup of expired entries
setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of conversations) {
    if (now - entry.updatedAt > STATE_TTL_MS) {
      conversations.delete(id);
    }
  }
}, 60_000);
