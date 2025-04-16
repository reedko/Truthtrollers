// src/store/useAuthStore.ts
import { create } from "zustand";
import { devtools, persist } from "zustand/middleware";
import { User } from "../../../shared/entities/types";

interface AuthState {
  user: User | null;
  setUser: (user: User) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    devtools((set) => ({
      user: null,
      setUser: (user) => set({ user }),
      logout: () => set({ user: null }),
    })),
    {
      name: "auth-storage", // 🗝 storage key in localStorage
    }
  )
);
