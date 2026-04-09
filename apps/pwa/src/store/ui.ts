// SPDX-License-Identifier: AGPL-3.0-only
import { create } from "zustand";

interface UIState {
  unreadAlerts: number;
  incrementUnread: () => void;
  resetUnread: () => void;

  sheetContent: React.ReactNode | null;
  openSheet: (content: React.ReactNode) => void;
  closeSheet: () => void;

  toast: { message: string; type: "success" | "error" | "info" } | null;
  showToast: (message: string, type?: "success" | "error" | "info") => void;
  clearToast: () => void;

  crisisMode: boolean;
  crisisRivers: string[];
  setCrisis: (mode: boolean, rivers: string[]) => void;
}

export const useUIStore = create<UIState>()((set) => ({
  unreadAlerts: 0,
  incrementUnread: () => set((s) => ({ unreadAlerts: s.unreadAlerts + 1 })),
  resetUnread: () => set({ unreadAlerts: 0 }),

  sheetContent: null,
  openSheet: (content) => set({ sheetContent: content }),
  closeSheet: () => set({ sheetContent: null }),

  toast: null,
  showToast: (message, type = "info") => {
    set({ toast: { message, type } });
    setTimeout(() => set({ toast: null }), 4000);
  },
  clearToast: () => set({ toast: null }),

  crisisMode: false,
  crisisRivers: [],
  setCrisis: (mode, rivers) => set({ crisisMode: mode, crisisRivers: rivers }),
}));
