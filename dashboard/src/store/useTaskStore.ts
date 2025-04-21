import { create } from "zustand";
import { devtools, persist } from "zustand/middleware";
import {
  Task,
  User,
  Author,
  Publisher,
  LitReference,
  TaskAuthor,
  TaskReference,
  AuthReference,
  Claim,
} from "../../../shared/entities/types";
import {
  fetchTasks as fetchTasksAPI,
  fetchUsers,
  fetchAssignedUsers,
  fetchTasksForUser as fetchTasksForUserAPI,
  fetchReferencesForTask,
  fetchClaimsForTask,
  fetchClaimReferences,
  fetchAuthors,
  fetchPublishers,
  addReferenceToTask,
  addReferenceToClaim,
  deleteReferenceFromTask,
} from "../services/useDashboardAPI";

export interface TaskStoreState {
  content: Task[];
  assignedTasks: Task[];
  filteredTasks: Task[];
  selectedTopic: string | undefined;
  searchQuery: string;
  users: User[];
  references: { [taskId: number]: LitReference[] };
  claimReferences: {
    [claimId: number]: { referenceId: number; supportLevel: number }[];
  };
  authors: { [taskId: number]: Author[] };
  publishers: { [taskId: number]: Publisher[] };
  assignedUsers: { [taskId: number]: User[] };
  content_authors: TaskAuthor[];
  content_relations: TaskReference[];
  auth_references: AuthReference[];
  selectedTaskId: number | null;
  selectedTask: Task | null;
  selectedRedirect: string;
  currentPage: number;
  claimsByTask: { [taskId: number]: Claim[] };

  setSelectedTask: (input: Task | number | null) => void;
  setRedirect: (path: string) => void;
  fetchTasks: () => Promise<void>;
  fetchTasksForUser: (userId: number) => Promise<void>;
  fetchUsers: () => Promise<void>;
  fetchAssignedUsers: (taskId: number) => Promise<void>;
  fetchAuthors: (taskId: number) => Promise<void>;
  fetchPublishers: (taskId: number) => Promise<void>;
  fetchReferences: (taskId: number) => Promise<void>;
  fetchClaims: (taskId: number) => Promise<void>;
  fetchClaimReferences: (claimId: number) => Promise<void>;

  addReferenceToTask: (taskId: number, referenceId: number) => Promise<void>;
  deleteReferenceFromTask: (
    taskId: number,
    referenceId: number
  ) => Promise<void>;
  addReferenceToClaim: (
    claimId: number,
    referenceId: number,
    userId: number,
    supportLevel: number
  ) => Promise<void>;

  setSelectedTopic: (topicName: string | undefined) => void;
  setSearchQuery: (query: string) => void;
  loadMoreTasks: () => Promise<void>;
}

export const useTaskStore = create<TaskStoreState>()(
  persist(
    devtools((set, get) => ({
      content: [],
      filteredTasks: [],
      selectedTopic: undefined,
      searchQuery: "",
      users: [],
      references: {},
      claimReferences: {},
      authors: {},
      publishers: {},
      assignedUsers: {},
      content_authors: [],
      content_relations: [],
      auth_references: [],
      selectedTaskId: null,
      selectedTask: null,
      selectedRedirect: "/dashboard",
      currentPage: 0,
      claimsByTask: {},

      setRedirect: (path) => {
        set({ selectedRedirect: path });
      },

      setSelectedTask: (input) => {
        if (input === null) {
          set({ selectedTask: null, selectedTaskId: null });
        } else if (typeof input === "number") {
          const found = get().content.find((t) => t.content_id === input);
          if (found) {
            set({ selectedTaskId: input, selectedTask: found });
          } else {
            set({ selectedTaskId: input, selectedTask: null });
          }
        } else {
          set({ selectedTask: input, selectedTaskId: input.content_id });
        }
      },

      fetchTasks: async () => {
        const { currentPage } = get();
        const content = await fetchTasksAPI(currentPage + 1, 100);
        const authorsMap: Record<number, Author[]> = {};
        const publishersMap: Record<number, Publisher[]> = {};

        content.forEach((task) => {
          authorsMap[task.content_id] = Array.isArray(task.authors)
            ? task.authors
            : [];
          publishersMap[task.content_id] = Array.isArray(task.publishers)
            ? task.publishers
            : [];
        });

        const combined = [...get().content, ...content];
        const deduped = Array.from(
          new Map(combined.map((t) => [t.content_id, t])).values()
        );

        set({
          content: deduped,
          filteredTasks: deduped,
          authors: { ...get().authors, ...authorsMap },
          publishers: { ...get().publishers, ...publishersMap },
          currentPage: currentPage + 1,
        });
      },

      fetchTasksForUser: async (userId: number) => {
        const tasks = await fetchTasksForUserAPI(userId);

        const authorsMap: Record<number, Author[]> = {};
        const publishersMap: Record<number, Publisher[]> = {};

        tasks.forEach((task) => {
          authorsMap[task.content_id] = Array.isArray(task.authors)
            ? task.authors
            : [];
          publishersMap[task.content_id] = Array.isArray(task.publishers)
            ? task.publishers
            : [];
        });

        set({
          assignedTasks: tasks,
          authors: { ...get().authors, ...authorsMap },
          publishers: { ...get().publishers, ...publishersMap },
        });
      },

      fetchUsers: async () => {
        const users = await fetchUsers();
        set({ users });
      },

      fetchAssignedUsers: async (taskId) => {
        const assigned = await fetchAssignedUsers(taskId);
        set((s) => ({
          assignedUsers: { ...s.assignedUsers, [taskId]: assigned },
        }));
      },

      fetchAuthors: async (taskId) => {
        const authors = await fetchAuthors(taskId);
        set((s) => ({
          authors: { ...s.authors, [taskId]: authors },
        }));
      },

      fetchPublishers: async (taskId) => {
        const publishers = await fetchPublishers(taskId);
        set((s) => ({
          publishers: { ...s.publishers, [taskId]: publishers },
        }));
      },

      fetchReferences: async (taskId) => {
        const refs = await fetchReferencesForTask(taskId);
        set((s) => ({
          references: { ...s.references, [taskId]: refs },
        }));
      },

      fetchClaims: async (taskId) => {
        const claims = await fetchClaimsForTask(taskId);
        set((s) => ({
          claimsByTask: {
            ...s.claimsByTask, // 🛡️ preserve existing claims
            [taskId]: claims, // ✅ just update this one
          },
        }));
      },
      fetchClaimReferences: async (claimId) => {
        const refs = await fetchClaimReferences(claimId);
        set((s) => ({
          claimReferences: { ...s.claimReferences, [claimId]: refs },
        }));
      },

      addReferenceToTask: async (taskId, refId) => {
        await addReferenceToTask(taskId, refId);
        await get().fetchReferences(taskId);
      },

      deleteReferenceFromTask: async (taskId, refId) => {
        await deleteReferenceFromTask(taskId, refId);
        await get().fetchReferences(taskId);
      },

      addReferenceToClaim: async (claimId, refId, userId, level) => {
        await addReferenceToClaim(claimId, refId, userId, level);
        set((s) => ({
          claimReferences: {
            ...s.claimReferences,
            [claimId]: [
              ...(s.claimReferences[claimId] || []),
              { referenceId: refId, supportLevel: level },
            ],
          },
        }));
      },

      setSelectedTopic: (topic) => {
        const filtered = get().content.filter((t) =>
          topic ? t.topic === topic : true
        );
        set({ selectedTopic: topic, filteredTasks: filtered });
      },

      setSearchQuery: (query) => {
        const { content, selectedTopic } = get();
        const filtered = content.filter((t) => {
          return (
            (!selectedTopic || t.topic === selectedTopic) &&
            (!query ||
              t.content_name.toLowerCase().includes(query.toLowerCase()))
          );
        });
        set({ searchQuery: query, filteredTasks: filtered });
      },

      loadMoreTasks: async () => {
        const { currentPage } = get();
        const newTasks = await fetchTasksAPI(currentPage + 1, 25);
        const combined = [...get().content, ...newTasks];
        const deduped = Array.from(
          new Map(combined.map((t) => [t.content_id, t])).values()
        );
        set({ content: deduped, currentPage: currentPage + 1 });
      },
    })),
    {
      name: "task-store",
      partialize: (state) => ({
        selectedTaskId: state.selectedTaskId,
        selectedTask: state.selectedTask,
        selectedRedirect: state.selectedRedirect,
      }),
    }
  )
);
