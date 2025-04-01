import { create } from "zustand";
import { devtools } from "zustand/middleware";
import {
  Task,
  User,
  Author,
  Publisher,
  LitReference,
  TaskAuthor,
  TaskReference,
  AuthReference,
} from "../../../shared/entities/types";
import {
  fetchTasks as fetchTasksAPI,
  fetchUsers,
  fetchAssignedUsers,
  fetchReferencesForTask,
  fetchClaimReferences,
  fetchAuthors,
  fetchPublishers,
  addReferenceToTask,
  addReferenceToClaim,
  deleteReferenceFromTask,
} from "../services/useDashboardAPI";

export interface TaskStoreState {
  content: Task[];
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
  selectedTaskId: number;
  currentPage: number;
  loadMoreTasks: () => Promise<void>;
  setSearchQuery: (query: string) => void;
  setSelectedTopic: (topicName: string | undefined) => void;
  setSelectedTask: (taskId: number) => void;

  fetchTasks: () => Promise<void>;
  fetchUsers: () => Promise<void>;
  fetchAssignedUsers: (taskId: number) => Promise<void>;
  fetchReferences: (taskId: number) => Promise<void>;
  fetchClaimReferences: (claimId: number) => Promise<void>;
  fetchAuthors: (taskId: number) => Promise<void>;
  fetchPublishers: (taskId: number) => Promise<void>;

  addReferenceToTask: (taskId: number, referenceId: number) => Promise<void>;
  addReferenceToClaim: (
    claimId: number,
    referenceId: number,
    userId: number,
    supportLevel: number
  ) => Promise<void>;
  deleteReferenceFromTask: (
    taskId: number,
    referenceId: number
  ) => Promise<void>;
}

export const useTaskStore = create<TaskStoreState>()(
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
    selectedTaskId: 0,
    currentPage: 0,
    setSelectedTask: (taskId: number) => set({ selectedTaskId: taskId }),

    fetchTasks: async () => {
      const limit = 25;

      const { currentPage } = get();
      try {
        const content = await fetchTasksAPI(currentPage + 1, limit);
        const authorsMap: Record<number, Author[]> = {};
        const publishersMap: Record<number, Publisher[]> = {};

        content.forEach((task) => {
          authorsMap[task.content_id] =
            typeof task.authors === "string"
              ? JSON.parse(task.authors)
              : task.authors || [];
          publishersMap[task.content_id] =
            typeof task.publishers === "string"
              ? JSON.parse(task.publishers)
              : task.publishers || [];
        });

        const newContent = [...get().content, ...content];

        set({
          content: newContent,
          filteredTasks: newContent,
          authors: { ...get().authors, ...authorsMap },
          publishers: { ...get().publishers, ...publishersMap },
          currentPage: currentPage + 1,
        });
      } catch (error) {
        console.error("❌ Error fetching content:", error);
      }
    },

    setSelectedTopic: (topicName) => {
      const { content, searchQuery } = get();
      console.log("Setting selected topic:", topicName);
      const filteredTasks = content.filter((task) => {
        const matchesTopic = topicName ? task.topic === topicName : true;
        const matchesSearch = searchQuery
          ? task.content_name.toLowerCase().includes(searchQuery.toLowerCase())
          : true;
        return matchesTopic && matchesSearch;
      });

      set({ selectedTopic: topicName, filteredTasks });
    },

    setSearchQuery: (query) => {
      const { content, selectedTopic } = get();
      const filteredTasks = content.filter((task) => {
        const matchesTopic = selectedTopic
          ? task.topic === selectedTopic
          : true;
        const matchesSearch = query
          ? task.content_name.toLowerCase().includes(query.toLowerCase())
          : true;
        return matchesTopic && matchesSearch;
      });
      set({ searchQuery: query, filteredTasks });
    },

    fetchUsers: async () => {
      const users = await fetchUsers();
      set({ users });
    },

    fetchAssignedUsers: async (taskId) => {
      try {
        const assignedUsers = await fetchAssignedUsers(taskId);
        set((state) => ({
          assignedUsers: { ...state.assignedUsers, [taskId]: assignedUsers },
        }));
      } catch (error) {
        console.error("❌ Error fetching assigned users:", error);
      }
    },

    fetchReferences: async (taskId) => {
      const references = await fetchReferencesForTask(taskId);
      set((state) => ({
        references: { ...state.references, [taskId]: references },
      }));
    },

    fetchAuthors: async (taskId) => {
      const authors = await fetchAuthors(taskId);
      set((state) => ({
        authors: { ...state.authors, [taskId]: authors },
      }));
    },

    fetchPublishers: async (taskId) => {
      const publishers = await fetchPublishers(taskId);
      set((state) => ({
        publishers: { ...state.publishers, [taskId]: publishers },
      }));
    },

    fetchClaimReferences: async (claimId) => {
      try {
        const claimReferences = await fetchClaimReferences(claimId);
        set((state) => ({
          claimReferences: {
            ...state.claimReferences,
            [claimId]: claimReferences,
          },
        }));
      } catch (error) {
        console.error("❌ Error fetching claim references:", error);
      }
    },

    addReferenceToTask: async (taskContentId, referenceContentId) => {
      try {
        const currentRefs = get().references[taskContentId] || [];

        if (
          currentRefs.some(
            (ref) => ref.reference_content_id === referenceContentId
          )
        ) {
          console.warn("⚠️ Reference already exists, skipping API call.");
          return;
        }

        await addReferenceToTask(taskContentId, referenceContentId);
        console.log("✅ Reference added to task");

        await get().fetchReferences(taskContentId);
      } catch (error) {
        console.error("❌ Error adding reference to task:", error);
      }
    },

    deleteReferenceFromTask: async (taskContentId, referenceContentId) => {
      try {
        await deleteReferenceFromTask(taskContentId, referenceContentId);
        console.log("✅ Reference removed from task");

        await get().fetchReferences(taskContentId);
      } catch (error) {
        console.error("❌ Error removing reference from task:", error);
      }
    },

    addReferenceToClaim: async (claimId, referenceId, userId, supportLevel) => {
      try {
        await addReferenceToClaim(claimId, referenceId, userId, supportLevel);

        set((state) => ({
          claimReferences: {
            ...state.claimReferences,
            [claimId]: [
              ...(state.claimReferences[claimId] || []),
              { referenceId, supportLevel },
            ],
          },
        }));

        console.log(
          `✅ Reference added to claim ${claimId} with support level ${supportLevel}`
        );
      } catch (error) {
        console.error("❌ Error adding reference to claim:", error);
      }
    },

    loadMoreTasks: async () => {
      const { currentPage, content } = get();
      const nextPage = currentPage + 1;
      try {
        const newTasks = await fetchTasksAPI(nextPage, 25);
        set((state) => ({
          content: [...state.content, ...newTasks],
          filteredTasks: [...state.content, ...newTasks],
          currentPage: nextPage,
        }));
      } catch (error) {
        console.error("❌ Error loading more tasks:", error);
      }
    },
  }))
);
