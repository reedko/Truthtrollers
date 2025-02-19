import { create } from "zustand";
import { devtools } from "zustand/middleware";
import axios from "axios";
import { useRef } from "react";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:5001";

export interface Task {
  content_id: number;
  content_name: string;
  progress: string;
  thumbnail: string;
  url: string;
  topic: string;
}

export interface User {
  user_id: number;
  username: string;
}

interface Author {
  author_id: number;
  author_first_name: string;
  author_last_name: string;
  author_title?: string;
  author_profile_pic?: string;
}

interface Publisher {
  publisher_id: number;
  publisher_name: string;
  publisher_owner?: string;
  publisher_icon?: string;
}

interface TaskAuthor {
  content_author_id: number;
  content_id: number;
  author_id: number;
}

interface TaskReference {
  content_relation_id: number;
  content_id: number;
  reference_content_id: number;
}

interface AuthReference {
  auth_reference_id: number;
  auth_id: number;
  reference_content_id: number;
}
export interface Reference {
  reference_content_id: number;
  url: string;
  content_name: string;
}

interface TaskStoreState {
  content: Task[];
  filteredTasks: Task[];
  selectedTopic: string | undefined;
  searchQuery: string;
  users: User[];
  references: { [taskId: number]: Reference[] };
  authors: { [taskId: number]: Author[] };
  publishers: { [taskId: number]: Publisher[] };
  assignedUsers: { [taskId: number]: User[] };
  content_authors: TaskAuthor[];
  content_relations: TaskReference[];
  auth_references: AuthReference[];
  setSearchQuery: (query: string) => void;
  setSelectedTopic: (topicName: string | undefined) => void;
  fetchTasks: () => Promise<void>;
  fetchAllData: (taskId: number) => Promise<void>;
  fetchUsers: () => Promise<void>;
  fetchAssignedUsers: (taskId: number) => Promise<void>;
  fetchReferences: (taskId: number) => Promise<void>;
  fetchAuthors: (taskId: number) => Promise<void>;
  fetchPublishers: (taskId: number) => Promise<void>;
  fetchTaskAuthors: (taskId: number) => Promise<void>;
  fetchTaskReferences: (taskId: number) => Promise<void>;
  fetchAuthReferences: () => Promise<void>;
  assignUserToTask: (taskId: number, userId: number) => Promise<void>;
  unassignUserFromTask: (taskId: number, userId: number) => Promise<void>;
  addAuthorToTask: (taskId: number, authorId: number) => Promise<void>;
  removeAuthorFromTask: (taskId: number, authorId: number) => Promise<void>;
  addPublisherToTask: (taskId: number, publisherId: number) => Promise<void>;
  removePublisherFromTask: (
    taskId: number,
    publisherId: number
  ) => Promise<void>;
  addReferenceToTask: (taskId: number, referenceId: number) => Promise<void>;
  removeReferenceFromTask: (
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
    authors: [],
    publishers: [],
    assignedUsers: {},
    content_authors: [],
    content_relations: [],
    auth_references: [],
    fetchTasks: async () => {
      if (get().content.length > 0) return; // Prevent redundant fetch
      try {
        const response = await axios.get(`${API_BASE_URL}/api/content`);
        const content = response.data;
        set({ content, filteredTasks: content });
      } catch (error) {
        console.error("Error fetching content:", error);
      }
    },

    fetchAllData: async (taskId) => {
      if (get().content.length > 0) return; // Prevent redundant fetch
      try {
        const response = await axios.get(`${API_BASE_URL}/api/content`);
        const content = response.data;
        set({ content, filteredTasks: content });
      } catch (error) {
        console.error("Error fetching content:", error);
      }
    },

    setSelectedTopic: (topicName) => {
      const { content, searchQuery } = get();
      const filteredTasks = content.filter((task) => {
        const matchesTopic = topicName ? task.topic === topicName : true;
        const matchesSearch = searchQuery
          ? task.content_name.toLowerCase().includes(searchQuery.toLowerCase())
          : true;
        return matchesTopic && matchesSearch;
      });
      set({ selectedTopic: topicName, filteredTasks });
    },

    setSearchQuery: (query: any) => {
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

    // Fetch all content
    fetchAllTasks: async () => {
      const response = await axios.get(`${API_BASE_URL}/api/content`);
      console.log("AAASSS");
      set({ content: response.data });
    },

    // Fetch all users
    fetchUsers: async () => {
      const response = await axios.get(`${API_BASE_URL}/api/all-users`);
      console.log("users updated:", response.data);
      set({ users: response.data });
    },

    // Fetch all users assigned to a task
    fetchAssignedUsers: async (taskId) => {
      console.log(`fetchAssignedUsers called for taskId: ${taskId}`);
      try {
        const response = await axios.get(
          `${API_BASE_URL}/api/content/${taskId}/get-users`
        );
        /*      console.log("assusers updated:", response.data);
        set({ assignedUsers: response.data }); */
        set((state) => {
          const updatedAssignedUsers = {
            ...state.assignedUsers,
            [taskId]: response.data,
          };
          console.log("assignedUsers updated:", updatedAssignedUsers);
          return { assignedUsers: updatedAssignedUsers };
        });
      } catch (error) {
        console.error("Error fetching assigned users:", error);
      }
    },

    // Fetch references for a task
    fetchReferences: async (taskId) => {
      const response = await axios.get(
        `${API_BASE_URL}/api/content/${taskId}/source-references`
      );
      set((state) => ({
        references: { ...state.references, [taskId]: response.data },
      }));
    },

    // Fetch authors for a task
    fetchAuthors: async (taskId) => {
      const response = await axios.get(
        `${API_BASE_URL}/api/content/${taskId}/authors`
      );
      set((state) => ({
        authors: { ...state.authors, [taskId]: response.data },
      }));
    },

    // Fetch publishers for a task
    fetchPublishers: async (taskId) => {
      const response = await axios.get(
        `${API_BASE_URL}/api/content/${taskId}/publishers`
      );
      set((state) => ({
        publishers: { ...state.publishers, [taskId]: response.data },
      }));
    },
    // Fetch Task Authors (relationship between task and authors)
    fetchTaskAuthors: async (taskId: number) => {
      try {
        const response = await axios.get<TaskAuthor[]>(
          `${API_BASE_URL}/api/content/${taskId}/content_authors`
        );
        console.log(`Fetched Task Authors for Task ${taskId}:`, response.data);
        set((state) => ({
          content_authors: [...state.content_authors, ...response.data],
        }));
      } catch (error) {
        console.error(
          `Error fetching content_authors for Task ${taskId}:`,
          error
        );
      }
    },

    // Fetch Task References (relationship between task and references)
    fetchTaskReferences: async (taskId: number) => {
      try {
        const response = await axios.get<TaskReference[]>(
          `${API_BASE_URL}/api/content/${taskId}/content_relations`
        );
        console.log(
          `Fetched Task References for Task ${taskId}:`,
          response.data
        );
        set((state) => ({
          content_relations: [...state.content_relations, ...response.data],
        }));
      } catch (error) {
        console.error(
          `Error fetching content_relations for Task ${taskId}:`,
          error
        );
      }
    },

    // Fetch Auth References (relationship between authors and references)
    fetchAuthReferences: async () => {
      try {
        const response = await axios.get<AuthReference[]>(
          `${API_BASE_URL}/api/auth_references`
        );
        console.log(`Fetched Auth References:`, response.data);
        set({ auth_references: response.data });
      } catch (error) {
        console.error(`Error fetching auth_references:`, error);
      }
    },
    // Assign a user to a task
    assignUserToTask: async (taskId, userId) => {
      await axios.post(`${API_BASE_URL}/api/content/${taskId}/assign-user`, {
        userId,
      });
      await get().fetchUsers(); // Refresh users
    },

    // Unassign a user from a task
    unassignUserFromTask: async (taskId, userId) => {
      await axios.post(`${API_BASE_URL}/api/content/${taskId}/unassign-user`, {
        userId,
      });
      await get().fetchUsers(); // Refresh users
    },

    // Add an author to a task
    addAuthorToTask: async (taskId, authorId) => {
      await axios.post(`${API_BASE_URL}/api/content/${taskId}/add-author`, {
        authorId,
      });
      await get().fetchAuthors(taskId); // Refresh authors for this task
    },

    // Remove an author from a task
    removeAuthorFromTask: async (taskId, authorId) => {
      await axios.post(`${API_BASE_URL}/api/content/${taskId}/remove-author`, {
        authorId,
      });
      await get().fetchAuthors(taskId); // Refresh authors for this task
    },

    // Add a publisher to a task
    addPublisherToTask: async (taskId, publisherId) => {
      await axios.post(`${API_BASE_URL}/api/content/${taskId}/add-publisher`, {
        publisherId,
      });
      await get().fetchPublishers(taskId); // Refresh publishers for this task
    },

    // Remove a publisher from a task
    removePublisherFromTask: async (taskId, publisherId) => {
      await axios.post(
        `${API_BASE_URL}/api/content/${taskId}/remove-publisher`,
        {
          publisherId,
        }
      );
      await get().fetchPublishers(taskId); // Refresh publishers for this task
    },

    // Add a reference to a task
    addReferenceToTask: async (taskId, referenceId) => {
      await axios.post(`${API_BASE_URL}/api/content/${taskId}/add-source`, {
        referenceId,
      });
      await get().fetchReferences(taskId);
    },

    // Remove a reference from a task
    removeReferenceFromTask: async (taskId, referenceId) => {
      await axios.post(`${API_BASE_URL}/api/content/${taskId}/remove-sources`, {
        referenceId,
      });
      await get().fetchReferences(taskId);
    },
  }))
);
