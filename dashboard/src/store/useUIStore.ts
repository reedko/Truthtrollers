import { create } from "zustand";
import { persist } from "zustand/middleware";

interface UIStoreState {
  isHeaderVisible: boolean;
  toggleHeaderVisibility: () => void;
  setHeaderVisible: (visible: boolean) => void;
}

export const useUIStore = create<UIStoreState>()(
  persist(
    (set) => ({
      isHeaderVisible: true,

      toggleHeaderVisibility: () =>
        set((state) => ({ isHeaderVisible: !state.isHeaderVisible })),

      setHeaderVisible: (visible: boolean) =>
        set({ isHeaderVisible: visible }),
    }),
    {
      name: "ui-storage", // localStorage key
    }
  )
);
