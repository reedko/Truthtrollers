// src/store/useTaskStore.ts

import { create } from "zustand";
import { devtools } from "zustand/middleware";
import axios from "axios";
import {
  Task,
  User,
  Author,
  Publisher,
  LitReference,
  TaskAuthor,
  TaskReference,
  AuthReference,
} from "../entities/types";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:5001";

interface TaskStoreState {
  tasks: Task[];
  filteredTasks: Task[];
  selectedTopic: string | undefined;
  searchQuery: string;
  users: User[];
  references: { [taskId: number]: LitReference[] };
  authors: { [taskId: number]: Author[] };
  publishers: { [taskId: number]: Publisher[] };
  assignedUsers: { [taskId: number]: User[] };
  task_authors: TaskAuthor[];
  task_references: TaskReference[];
  auth_references: AuthReference[];
  setSearchQuery: (query: string) => void;
  setSelectedTopic: (topicName: string | undefined) => void;
  fetchTasks: () => Promise<void>;
  fetchUsers: () => Promise<void>;
  fetchAssignedUsers: (taskId: number) => Promise<void>;
  fetchReferences: (taskId: number) => Promise<void>;
  fetchAuthors: (taskId: number) => Promise<void>;
  fetchPublishers: (taskId: number) => Promise<void>;
}

export const useTaskStore = create<TaskStoreState>()(
  devtools((set, get) => ({
    tasks: [],
    filteredTasks: [],
    selectedTopic: undefined,
    searchQuery: "",
    users: [],
    references: {},
    authors: {},
    publishers: {},
    assignedUsers: {},
    task_authors: [],
    task_references: [],
    auth_references: [],

    fetchTasks: async () => {
      if (get().tasks.length > 0) return;
      try {
        const response = await axios.get(`${API_BASE_URL}/api/tasks`);
        const tasks: Task[] = response.data;

        const authorsMap: Record<number, Author[]> = {};
        const publishersMap: Record<number, Publisher[]> = {};

        tasks.forEach((task) => {
          authorsMap[task.task_id] =
            typeof task.authors === "string" ? JSON.parse(task.authors) : [];
          publishersMap[task.task_id] =
            typeof task.publishers === "string"
              ? JSON.parse(task.publishers)
              : [];
        });

        set({
          tasks,
          filteredTasks: tasks,
          authors: authorsMap,
          publishers: publishersMap,
        });
      } catch (error) {
        console.error("Error fetching tasks:", error);
      }
    },

    setSelectedTopic: (topicName) => {
      const { tasks, searchQuery } = get();
      const filteredTasks = tasks.filter((task) => {
        const matchesTopic = topicName ? task.topic === topicName : true;
        const matchesSearch = searchQuery
          ? task.task_name.toLowerCase().includes(searchQuery.toLowerCase())
          : true;
        return matchesTopic && matchesSearch;
      });
      set({ selectedTopic: topicName, filteredTasks });
    },

    setSearchQuery: (query) => {
      const { tasks, selectedTopic } = get();
      const filteredTasks = tasks.filter((task) => {
        const matchesTopic = selectedTopic
          ? task.topic === selectedTopic
          : true;
        const matchesSearch = query
          ? task.task_name.toLowerCase().includes(query.toLowerCase())
          : true;
        return matchesTopic && matchesSearch;
      });
      set({ searchQuery: query, filteredTasks });
    },

    fetchUsers: async () => {
      const response = await axios.get(`${API_BASE_URL}/api/all-users`);
      set({ users: response.data });
    },

    fetchAssignedUsers: async (taskId) => {
      try {
        const response = await axios.get(
          `${API_BASE_URL}/api/tasks/${taskId}/get-users`
        );
        set((state) => ({
          assignedUsers: { ...state.assignedUsers, [taskId]: response.data },
        }));
      } catch (error) {
        console.error("Error fetching assigned users:", error);
      }
    },

    fetchReferences: async (taskId) => {
      const response = await axios.get(
        `${API_BASE_URL}/api/tasks/${taskId}/source-references`
      );
      set((state) => ({
        references: { ...state.references, [taskId]: response.data },
      }));
    },

    fetchAuthors: async (taskId) => {
      const response = await axios.get(
        `${API_BASE_URL}/api/tasks/${taskId}/authors`
      );
      set((state) => ({
        authors: { ...state.authors, [taskId]: response.data },
      }));
    },

    fetchPublishers: async (taskId) => {
      const response = await axios.get(
        `${API_BASE_URL}/api/tasks/${taskId}/publishers`
      );
      set((state) => ({
        publishers: { ...state.publishers, [taskId]: response.data },
      }));
    },
  }))
);
