// src/store/useTaskStore.ts
import { create } from "zustand";
import { Task } from "../entities/Task";

// Define the store for task, URL, and detection state
interface TaskStore {
  task: Task | null;
  currentUrl: string | null;
  isContentDetected: boolean;
  setTask: (task: Task) => void;
  setCurrentUrl: (url: string) => void;
  setContentDetected: (detected: boolean) => void;
}

// Create the Zustand store
const useTaskStore = create<TaskStore>((set) => ({
  task: null,
  currentUrl: "MYYYY",
  isContentDetected: false,
  setTask: (task) => set({ task }),
  setCurrentUrl: (url) => set({ currentUrl: url }),
  setContentDetected: (detected) => set({ isContentDetected: detected }),
}));

export default useTaskStore;
