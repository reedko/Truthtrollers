// src/store/useDashboardStore.ts
import { create } from "zustand";

interface DashboardStore {
  selectedTask: any | null;
  setSelectedTask: (task: any | null) => void;
}

export const useDashboardStore = create<DashboardStore>((set) => ({
  selectedTask: null,
  setSelectedTask: (task) => set({ selectedTask: task }),
}));
