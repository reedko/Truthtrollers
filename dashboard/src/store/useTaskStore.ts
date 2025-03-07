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
} from "../../../shared/entities/types";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:5001";

interface TaskStoreState {
  content: Task[];
  filteredTasks: Task[];
  selectedTopic: string | undefined;
  searchQuery: string;
  users: User[];
  references: { [taskId: number]: LitReference[] };
  authors: { [taskId: number]: Author[] };
  publishers: { [taskId: number]: Publisher[] };
  assignedUsers: { [taskId: number]: User[] };
  content_authors: TaskAuthor[];
  content_relations: TaskReference[];
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
    content: [],
    filteredTasks: [],
    selectedTopic: undefined,
    searchQuery: "",
    users: [],
    references: {},
    authors: {},
    publishers: {},
    assignedUsers: {},
    content_authors: [],
    content_relations: [],
    auth_references: [],

    fetchTasks: async () => {
      if (get().content.length > 0) return;
      try {
        const response = await axios.get(`${API_BASE_URL}/api/content`);
        const content: Task[] = response.data;

        const authorsMap: Record<number, Author[]> = {};
        const publishersMap: Record<number, Publisher[]> = {};

        content.forEach((task) => {
          authorsMap[task.content_id] =
            typeof task.authors === "string" ? JSON.parse(task.authors) : [];
          publishersMap[task.content_id] =
            typeof task.publishers === "string"
              ? JSON.parse(task.publishers)
              : [];
        });

        set({
          content,
          filteredTasks: content,
          authors: authorsMap,
          publishers: publishersMap,
        });
      } catch (error) {
        console.error("Error fetching content:", error);
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
      const response = await axios.get(`${API_BASE_URL}/api/all-users`);
      set({ users: response.data });
    },

    fetchAssignedUsers: async (taskId) => {
      try {
        const response = await axios.get(
          `${API_BASE_URL}/api/content/${taskId}/get-users`
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
        `${API_BASE_URL}/api/content/${taskId}/source-references`
      );
      set((state) => ({
        references: { ...state.references, [taskId]: response.data },
      }));
    },

    fetchAuthors: async (taskId) => {
      const response = await axios.get(
        `${API_BASE_URL}/api/content/${taskId}/authors`
      );
      set((state) => ({
        authors: { ...state.authors, [taskId]: response.data },
      }));
    },

    fetchPublishers: async (taskId) => {
      const response = await axios.get(
        `${API_BASE_URL}/api/content/${taskId}/publishers`
      );
      set((state) => ({
        publishers: { ...state.publishers, [taskId]: response.data },
      }));
    },
  }))
);
