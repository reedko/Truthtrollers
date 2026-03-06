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
        const user = get().user;
        const token = get().token;

        console.log("🚪 LOGOUT TRIGGERED - Clearing Zustand auth");
        console.log(`   User being logged out: ${user?.username} (ID: ${user?.user_id})`);
        console.log(`   Stack trace:`, new Error().stack);

        // Log token status at logout
        if (token) {
          try {
            const payload = JSON.parse(atob(token.split('.')[1]));
            const expiresAt = payload.exp * 1000;
            const now = Date.now();
            const wasExpired = expiresAt < now;
            const minutesRemaining = Math.floor((expiresAt - now) / 1000 / 60);

            console.log(`   Token status at logout: ${wasExpired ? 'EXPIRED' : 'VALID'}`);
            console.log(`   Token expired at: ${new Date(expiresAt).toLocaleTimeString()}`);
            console.log(`   Current time: ${new Date(now).toLocaleTimeString()}`);
            if (wasExpired) {
              console.log(`   Token was expired ${Math.abs(minutesRemaining)} minutes ago`);
            } else {
              console.log(`   Token still had ${minutesRemaining} minutes remaining`);
            }
          } catch (error) {
            console.error('   Could not parse token at logout:', error);
          }
        }

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
