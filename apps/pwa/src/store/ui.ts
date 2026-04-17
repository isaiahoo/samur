// SPDX-License-Identifier: AGPL-3.0-only
import { create } from "zustand";

interface ToastItem {
  message: string;
  type: "success" | "error" | "info";
}

interface UIState {
  sheetContent: React.ReactNode | null;
  openSheet: (content: React.ReactNode) => void;
  closeSheet: () => void;

  toast: ToastItem | null;
  toastQueue: ToastItem[];
  showToast: (message: string, type?: "success" | "error" | "info") => void;
  clearToast: () => void;

  socketConnected: boolean;
  setSocketConnected: (connected: boolean) => void;

  crisisMode: boolean;
  crisisRivers: string[];
  setCrisis: (mode: boolean, rivers: string[]) => void;

  reportFormOpen: boolean;
  setReportFormOpen: (open: boolean) => void;
}

let toastTimer: ReturnType<typeof setTimeout> | null = null;

function advanceToastQueue(set: (fn: (s: UIState) => Partial<UIState>) => void) {
  set((s) => {
    if (s.toastQueue.length > 0) {
      const [next, ...rest] = s.toastQueue;
      toastTimer = setTimeout(() => advanceToastQueue(set), 4000);
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
  showToast: (message, type = "info") => {
    const item: ToastItem = { message, type };
    set((s) => {
      if (s.toast) {
        // Queue if a toast is already showing
        return { toastQueue: [...s.toastQueue, item] };
      }
      // Show immediately
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(() => advanceToastQueue(set), 4000);
      return { toast: item };
    });
  },
  clearToast: () => {
    if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
    set({ toast: null, toastQueue: [] });
  },

  socketConnected: false,
  setSocketConnected: (connected) => set({ socketConnected: connected }),

  crisisMode: false,
  crisisRivers: [],
  setCrisis: (mode, rivers) => set({ crisisMode: mode, crisisRivers: rivers }),

  reportFormOpen: false,
  setReportFormOpen: (open) => set({ reportFormOpen: open }),
}));
