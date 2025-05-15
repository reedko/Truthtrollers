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
        console.log("🔐 setAuth called with:", user);

        // Patch: don't overwrite existing real user with broken payload
        if (!user?.user_id) {
          console.warn(
            "⚠️ setAuth called with no user_id – skipping store update."
          );
          return;
        }

        set({ user, token, hydrated: true });

        setTimeout(() => {
          const current = get().user;
          console.log("🔍 Zustand user state after setAuth:", current);
        }, 50);
      },

      logout: () => {
        console.log("🚪 Logging out, clearing Zustand auth");
        set({ user: null, token: null });
      },
    })),
    {
      name: "auth-storage",
      onRehydrateStorage: () => (state, error) => {
        if (error) {
          console.error("Zustand rehydration error:", error);
        } else {
          // Hydration must be explicitly marked complete
          setTimeout(() => {
            useAuthStore.setState({ hydrated: true });
            console.log("💾 Zustand auth store rehydrated.");
          }, 0);
        }
      },
    }
  )
);
