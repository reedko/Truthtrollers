import { create } from "zustand";
import { Task } from "../entities/Task";
import browser from "webextension-polyfill";

interface TaskStore {
  task: Task | null;
  currentUrl: string | null;
  isContentDetected: boolean;
  setTask: (task: Task) => void;
  setCurrentUrl: (url: string) => void;
  setContentDetected: (detected: boolean) => void;
}

const useTaskStore = create<TaskStore>((set) => {
  browser.storage.local
    .get(["task", "currentUrl", "isContentDetected"])
    .then((result) => {
      const maybeTask = result.task;
      const isValidTask =
        maybeTask && typeof maybeTask === "object" && "content_id" in maybeTask;
      set({
        task: isValidTask ? (maybeTask as Task) : null,
        currentUrl:
          typeof result.currentUrl === "string" ? result.currentUrl : null,
        isContentDetected:
          typeof result.isContentDetected === "boolean"
            ? result.isContentDetected
            : false,
      });
    });
  return {
    task: null,
    currentUrl: null,
    isContentDetected: false,
    setTask: (task) => {
      set({ task });
      browser.storage.local.set({ task });
    },
    setCurrentUrl: (url) => {
      set({ currentUrl: url });
      browser.storage.local.set({ currentUrl: url });
    },
    setContentDetected: (detected) => {
      set({ isContentDetected: detected });
      browser.storage.local.set({ isContentDetected: detected });
    },
  };
});

export default useTaskStore;
