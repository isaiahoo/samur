// SPDX-License-Identifier: AGPL-3.0-only
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { User, UserRole } from "@samur/shared";
import { disconnectSocket } from "../services/socket.js";

/** Decode JWT payload without verification (browser-side, server already verified) */
function decodeJwtPayload(token: string): { exp?: number } | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
    return payload;
  } catch {
    return null;
  }
}

/** Check if a JWT token has expired (with 60s grace period) */
function isTokenExpired(token: string): boolean {
  const payload = decodeJwtPayload(token);
  if (!payload?.exp) return false; // no exp claim = never expires
  return payload.exp * 1000 < Date.now() - 60_000;
}

interface AuthState {
  token: string | null;
  user: User | null;
  setAuth: (token: string, user: User) => void;
  logout: () => void;
  isLoggedIn: () => boolean;
  hasRole: (...roles: UserRole[]) => boolean;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      token: null,
      user: null,
      setAuth: (token, user) => set({ token, user }),
      logout: () => {
        disconnectSocket();
        set({ token: null, user: null });
      },
      isLoggedIn: () => {
        const token = get().token;
        if (!token) return false;
        // Auto-logout on expired token
        if (isTokenExpired(token)) {
          disconnectSocket();
          set({ token: null, user: null });
          return false;
        }
        return true;
      },
      hasRole: (...roles) => {
        const user = get().user;
        return user !== null && roles.includes(user.role);
      },
    }),
    {
      name: "auth",
      onRehydrateStorage: () => (state) => {
        // Validate rehydrated state — clear if corrupted or expired
        if (state && state.token) {
          if (typeof state.token !== "string" || isTokenExpired(state.token)) {
            state.token = null;
            state.user = null;
          }
        }
      },
    },
  ),
);
