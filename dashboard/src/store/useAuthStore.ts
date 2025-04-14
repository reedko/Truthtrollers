// src/store/useAuthStore.ts
import { create } from "zustand";
import { devtools } from "zustand/middleware";
import { User } from "../../../shared/entities/types";

interface AuthState {
  user: User | null;
  setUser: (user: User) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  devtools((set) => ({
    user: null,
    setUser: (user) => set({ user }),
    logout: () => set({ user: null }),
  }))
);
