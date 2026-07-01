import { Author, Publisher, User, Task } from "../../../shared/entities/types";
import { useTaskStore } from "../store/useTaskStore";
export function ensureArray<T>(val: unknown): T[] {
  if (typeof val === "string") {
    if (val.trim() === "") return []; // 👈 Early exit
    try {
      const parsed = JSON.parse(val);
      if (Array.isArray(parsed)) return parsed;
    } catch (e) {
      console.warn("🧨 Failed to parse stringified array:", val);
    }
  }
  if (Array.isArray(val)) return val;
  if (val && typeof val === "object") return Object.values(val) as T[];
  return [];
}

export function extractMeta(
  task: Task,
  useStore = true
): {
  authors: Author[];
  publishers: Publisher[];
  users: User[];
} {
  if (!task || !("content_id" in task))
    return { authors: [], publishers: [], users: [] };

  const contentId = task.content_id;

  if (useStore) {
    const state = useTaskStore.getState();
    return {
      authors: state.authors?.[contentId] || [],
      publishers: state.publishers?.[contentId] || [],
      users: state.assignedUsers?.[contentId] || [],
    };
  }

  return {
    authors: ensureArray<Author>(task.authors),
    publishers: ensureArray<Publisher>(task.publishers),
    users: ensureArray<User>(task.users),
  };
}
