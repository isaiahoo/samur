// SPDX-License-Identifier: AGPL-3.0-only
import { create } from "zustand";

/** Optional "tap me to see it" payload attached to a toast. When set,
 * the Toast component renders as a clickable button that navigates
 * the map to this point and highlights the matching marker. Used for
 * the "nearby SOS / help request just appeared" alerts so the user
 * can go from "oh, there's something" to "show me where" in one tap. */
export interface ToastFocus {
  id: string;
  markerType: "helpRequest" | "incident";
  lat: number;
  lng: number;
}

interface ToastItem {
  message: string;
  type: "success" | "error" | "info";
  focus?: ToastFocus;
}

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  /** Optional async handler. When provided, the dialog runs it on
   * confirm click, shows a spinner + disables both buttons, and
   * only closes once the handler resolves. Caller's await on
   * confirmAction() still resolves to true iff onConfirm finished. */
  onConfirm?: () => Promise<void> | void;
}

interface ConfirmRequest extends ConfirmOptions {
  resolve: (ok: boolean) => void;
}

interface UIState {
  sheetContent: React.ReactNode | null;
  openSheet: (content: React.ReactNode) => void;
  closeSheet: () => void;

  toast: ToastItem | null;
  toastQueue: ToastItem[];
  showToast: (message: string, type?: "success" | "error" | "info", focus?: ToastFocus) => void;
  clearToast: () => void;

  confirmRequest: ConfirmRequest | null;
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
  resolveConfirm: (ok: boolean) => void;

  socketConnected: boolean;
  setSocketConnected: (connected: boolean) => void;

  crisisMode: boolean;
  crisisRivers: string[];
  setCrisis: (mode: boolean, rivers: string[]) => void;

  reportFormOpen: boolean;
  setReportFormOpen: (open: boolean) => void;

  /** Ids of help-requests the current browser just created. Used to
   * suppress the "someone nearby asked for help" toast for the author
   * themselves — otherwise pressing SOS shows a toast about your own
   * request. Anonymous flows have no userId to match on, so we stash
   * the returned id client-side and check against it here. Cleared
   * after 10 min so the set doesn't grow unbounded in a long session. */
  ownRequestIds: Set<string>;
  addOwnRequest: (id: string) => void;

  /** Bumped by flows that change the caller's achievement eligibility
   * (e.g. PWA install marks `installed_pwa_at` server-side) so the
   * Layout-level stats fetch re-runs and the unlock modal picks up
   * the new medal regardless of which tab the user is on. */
  statsRefreshKey: number;
  bumpStatsRefresh: () => void;
}

let toastTimer: ReturnType<typeof setTimeout> | null = null;

function advanceToastQueue(set: (fn: (s: UIState) => Partial<UIState>) => void) {
  set((s) => {
    if (s.toastQueue.length > 0) {
      const [next, ...rest] = s.toastQueue;
      // Focus-toasts hold longer so the user has a fair chance to tap.
      const dwell = next.focus ? 6000 : 4000;
      toastTimer = setTimeout(() => advanceToastQueue(set), dwell);
      return { toast: next, toastQueue: rest };
    }
    toastTimer = null;
    return { toast: null };
  });
}

export const useUIStore = create<UIState>()((set) => ({
  sheetContent: null,
  openSheet: (content) => set({ sheetContent: content }),
  closeSheet: () => set({ sheetContent: null }),

  toast: null,
  toastQueue: [],
  showToast: (message, type = "info", focus) => {
    const item: ToastItem = focus ? { message, type, focus } : { message, type };
    set((s) => {
      if (s.toast) {
        // Queue if a toast is already showing
        return { toastQueue: [...s.toastQueue, item] };
      }
      // Show immediately. Focus-toasts get a longer dwell (6 s) so
      // the user has time to react and tap them; plain toasts
      // stay on the existing 4 s beat.
      if (toastTimer) clearTimeout(toastTimer);
      const dwell = focus ? 6000 : 4000;
      toastTimer = setTimeout(() => advanceToastQueue(set), dwell);
      return { toast: item };
    });
  },
  clearToast: () => {
    if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
    set({ toast: null, toastQueue: [] });
  },

  confirmRequest: null,
  confirm: (opts) =>
    new Promise<boolean>((resolve) => {
      set({ confirmRequest: { ...opts, resolve } });
    }),
  resolveConfirm: (ok) => {
    set((s) => {
      s.confirmRequest?.resolve(ok);
      return { confirmRequest: null };
    });
  },

  socketConnected: false,
  setSocketConnected: (connected) => set({ socketConnected: connected }),

  crisisMode: false,
  crisisRivers: [],
  setCrisis: (mode, rivers) => set({ crisisMode: mode, crisisRivers: rivers }),

  reportFormOpen: false,
  setReportFormOpen: (open) => set({ reportFormOpen: open }),

  statsRefreshKey: 0,
  bumpStatsRefresh: () => set((s) => ({ statsRefreshKey: s.statsRefreshKey + 1 })),

  ownRequestIds: new Set<string>(),
  addOwnRequest: (id) => {
    set((s) => {
      const next = new Set(s.ownRequestIds);
      next.add(id);
      return { ownRequestIds: next };
    });
    // Evict after 10 min — long enough to cover the toast window from
    // any reasonable socket delay, short enough that a stale set
    // doesn't mask a genuinely different request that happens to
    // reuse an id (shouldn't happen with cuid but defence in depth).
    setTimeout(() => {
      set((s) => {
        if (!s.ownRequestIds.has(id)) return s;
        const next = new Set(s.ownRequestIds);
        next.delete(id);
        return { ownRequestIds: next };
      });
    }, 10 * 60 * 1000);
  },
}));

/** Module-level shortcut for non-hook call sites (event handlers).
 * Defaults "Отмена" as the cancel label so the 7 destructive-action
 * sites don't each repeat the same boilerplate. */
export function confirmAction(opts: {
  title: string;
  message?: string;
  confirmLabel: string;
  kind?: "default" | "destructive";
  onConfirm?: () => Promise<void> | void;
}): Promise<boolean> {
  return useUIStore.getState().confirm({
    title: opts.title,
    message: opts.message,
    confirmLabel: opts.confirmLabel,
    cancelLabel: "Отмена",
    destructive: opts.kind === "destructive",
    onConfirm: opts.onConfirm,
  });
}
