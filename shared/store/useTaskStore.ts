import { create } from "zustand";
import { Task } from "../entities/Task";

interface TaskStore {
  task: Task | null;
  currentUrl: string | null;
  isContentDetected: boolean;
  setTask: (task: Task) => void;
  setCurrentUrl: (url: string) => void;
  setContentDetected: (detected: boolean) => void;
}

const useTaskStore = create<TaskStore>((set) => {
  // Initialize state from chrome.storage
  chrome.storage.local.get(
    ["task", "currentUrl", "isContentDetected"],
    (result) => {
      set({
        task: result.task || null,
        currentUrl: result.currentUrl || null,
        isContentDetected: result.isContentDetected || false,
      });
    }
  );

  return {
    task: null,
    currentUrl: null,
    isContentDetected: false,
    setTask: (task) => {
      set({ task });
      chrome.storage.local.set({ task });
    },
    setCurrentUrl: (url) => {
      set({ currentUrl: url });
      chrome.storage.local.set({ currentUrl: url });
    },
    setContentDetected: (detected) => {
      set({ isContentDetected: detected });
      chrome.storage.local.set({ isContentDetected: detected });
    },
  };
});

export default useTaskStore;
