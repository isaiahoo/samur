// SPDX-License-Identifier: AGPL-3.0-only
import { create } from "zustand";
import type { Alert } from "@samur/shared";

/**
 * App-wide alerts cache + per-device "last read" watermark.
 *
 * Design rationale:
 * - Client-side + localStorage: the platform has many anonymous
 *   visitors, so requiring auth to remember what you've seen would
 *   leave most users with session-local badges. localStorage gives
 *   everyone persistent read-state per device.
 * - Timestamp-based, not a counter: unread is always reconciled
 *   against the actual fetched alerts — if the client was offline
 *   for a week and two alerts expired in the meantime, they
 *   correctly drop out of the count. A raw counter would drift.
 * - Global socket listener (installed in Layout): alerts arriving
 *   while the user is on any tab update the badge. Without this the
 *   only listener was in AlertsPage and the badge bug from the
 *   earlier implementation silently swallowed broadcasts.
 */

const LAST_READ_KEY = "kunak.alerts.lastReadAt";
const MAX_CACHED = 50;

function initialLastReadAt(): string {
  if (typeof window === "undefined") return new Date().toISOString();
  try {
    const v = localStorage.getItem(LAST_READ_KEY);
    if (v) return v;
    // First install — seed with "now" so the badge doesn't start out
    // counting alerts from before the user knew the app existed.
    const now = new Date().toISOString();
    localStorage.setItem(LAST_READ_KEY, now);
    return now;
  } catch {
    return new Date().toISOString();
  }
}

interface AlertsState {
  recentAlerts: Alert[];
  lastReadAt: string;
  setAlerts: (alerts: Alert[]) => void;
  appendAlert: (alert: Alert) => void;
  markAllRead: () => void;
}

export const useAlertsStore = create<AlertsState>()((set) => ({
  recentAlerts: [],
  lastReadAt: initialLastReadAt(),
  setAlerts: (alerts) => set({ recentAlerts: alerts.slice(0, MAX_CACHED) }),
  appendAlert: (alert) => set((s) => {
    const deduped = s.recentAlerts.filter((a) => a.id !== alert.id);
    return { recentAlerts: [alert, ...deduped].slice(0, MAX_CACHED) };
  }),
  markAllRead: () => {
    const now = new Date().toISOString();
    try { localStorage.setItem(LAST_READ_KEY, now); } catch { /* ignore */ }
    set({ lastReadAt: now });
  },
}));

/** Unread count — re-evaluated whenever either the alerts list or the
 * watermark changes. Caps at 99+ in the UI; we return the raw number
 * here so callers can decide. */
export function useUnreadCount(): number {
  return useAlertsStore((s) => {
    const watermark = new Date(s.lastReadAt).getTime();
    let n = 0;
    for (const a of s.recentAlerts) {
      if (new Date(a.sentAt).getTime() > watermark) n++;
    }
    return n;
  });
}

/** Whether a single alert counts as "new" relative to a given snapshot
 * of lastReadAt. AlertsPage snapshots at mount so the visual indicator
 * survives the concurrent call to markAllRead(). */
export function isAlertNew(alert: Alert, snapshot: string): boolean {
  return new Date(alert.sentAt).getTime() > new Date(snapshot).getTime();
}
