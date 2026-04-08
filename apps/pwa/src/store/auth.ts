// SPDX-License-Identifier: AGPL-3.0-only
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { User, UserRole } from "@samur/shared";

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
      logout: () => set({ token: null, user: null }),
      isLoggedIn: () => get().token !== null,
      hasRole: (...roles) => {
        const user = get().user;
        return user !== null && roles.includes(user.role);
      },
    }),
    { name: "auth" },
  ),
);
