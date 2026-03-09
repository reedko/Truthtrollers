import { create } from "zustand";
import { devtools, persist } from "zustand/middleware";
import { User } from "../../../shared/entities/types";

interface AuthState {
  user: User | null;
  token: string | null;
  hydrated: boolean;
  setAuth: (user: User, token: string) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    devtools((set, get) => ({
      user: null,
      token: null,
      hydrated: false,

      setAuth: (user, token) => {
        // Patch: don't overwrite existing real user with broken payload
        if (!user?.user_id) {
          return;
        }

        set({ user, token, hydrated: true });
      },

      logout: () => {
        set({ user: null, token: null });
      },
    })),
    {
      name: "auth-storage",
      onRehydrateStorage: () => (state, error) => {
        if (!error) {
          // Hydration must be explicitly marked complete
          setTimeout(() => {
            useAuthStore.setState({ hydrated: true });
          }, 0);
        }
      },
    }
  )
);
