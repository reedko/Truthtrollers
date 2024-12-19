import { create } from "zustand";
import { devtools } from "zustand/middleware";
import axios from "axios";
import { useRef } from "react";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:5001";

export interface Task {
  task_id: number;
  task_name: string;
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
  task_author_id: number;
  task_id: number;
  author_id: number;
}

interface TaskReference {
  task_reference_id: number;
  task_id: number;
  lit_reference_id: number;
}

interface AuthReference {
  auth_reference_id: number;
  auth_id: number;
  lit_reference_id: number;
}
export interface Reference {
  lit_reference_id: number;
  lit_reference_link: string;
  lit_reference_title: string;
}

interface TaskStoreState {
  tasks: Task[];
  filteredTasks: Task[];
  selectedTopic: string | undefined;
  searchQuery: string;
  users: User[];
  references: { [taskId: number]: Reference[] };
  authors: { [taskId: number]: Author[] };
  publishers: { [taskId: number]: Publisher[] };
  assignedUsers: { [taskId: number]: User[] };
  task_authors: TaskAuthor[];
  task_references: TaskReference[];
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
    tasks: [],
    filteredTasks: [],
    selectedTopic: undefined,
    searchQuery: "",
    users: [],
    references: {},
    authors: [],
    publishers: [],
    assignedUsers: {},
    task_authors: [],
    task_references: [],
    auth_references: [],
    fetchTasks: async () => {
      if (get().tasks.length > 0) return; // Prevent redundant fetch
      try {
        const response = await axios.get(`${API_BASE_URL}/api/tasks`);
        const tasks = response.data;
        set({ tasks, filteredTasks: tasks });
      } catch (error) {
        console.error("Error fetching tasks:", error);
      }
    },
    fetchAllData: async (taskId) => {
      if (get().tasks.length > 0) return; // Prevent redundant fetch
      try {
        const response = await axios.get(`${API_BASE_URL}/api/tasks`);
        const tasks = response.data;
        set({ tasks, filteredTasks: tasks });
      } catch (error) {
        console.error("Error fetching tasks:", error);
      }
    },

    /*    setSelectedTopic: (topicName) => {
      if (get().selectedTopic === topicName) return; // No update if the topic hasn't changed

      const tasks = get().tasks;
      const filteredTasks = topicName
        ? tasks.filter((task) => task.topic === topicName)
        : tasks;

      set({ selectedTopic: topicName, filteredTasks });
    }, */

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

    setSearchQuery: (query: any) => {
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

    // Fetch all tasks
    fetchAllTasks: async () => {
      const response = await axios.get(`${API_BASE_URL}/api/tasks`);
      console.log("AAASSS");
      set({ tasks: response.data });
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
          `${API_BASE_URL}/api/tasks/${taskId}/get-users`
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
        `${API_BASE_URL}/api/tasks/${taskId}/source-references`
      );
      set((state) => ({
        references: { ...state.references, [taskId]: response.data },
      }));
    },

    // Fetch authors for a task
    fetchAuthors: async (taskId) => {
      const response = await axios.get(
        `${API_BASE_URL}/api/tasks/${taskId}/authors`
      );
      set((state) => ({
        authors: { ...state.authors, [taskId]: response.data },
      }));
    },

    // Fetch publishers for a task
    fetchPublishers: async (taskId) => {
      const response = await axios.get(
        `${API_BASE_URL}/api/tasks/${taskId}/publishers`
      );
      set((state) => ({
        publishers: { ...state.publishers, [taskId]: response.data },
      }));
    },
    // Fetch Task Authors (relationship between task and authors)
    fetchTaskAuthors: async (taskId: number) => {
      try {
        const response = await axios.get<TaskAuthor[]>(
          `${API_BASE_URL}/api/tasks/${taskId}/task_authors`
        );
        console.log(`Fetched Task Authors for Task ${taskId}:`, response.data);
        set((state) => ({
          task_authors: [...state.task_authors, ...response.data],
        }));
      } catch (error) {
        console.error(`Error fetching task_authors for Task ${taskId}:`, error);
      }
    },

    // Fetch Task References (relationship between task and references)
    fetchTaskReferences: async (taskId: number) => {
      try {
        const response = await axios.get<TaskReference[]>(
          `${API_BASE_URL}/api/tasks/${taskId}/task_references`
        );
        console.log(
          `Fetched Task References for Task ${taskId}:`,
          response.data
        );
        set((state) => ({
          task_references: [...state.task_references, ...response.data],
        }));
      } catch (error) {
        console.error(
          `Error fetching task_references for Task ${taskId}:`,
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
      await axios.post(`${API_BASE_URL}/api/tasks/${taskId}/assign-user`, {
        userId,
      });
      await get().fetchUsers(); // Refresh users
    },

    // Unassign a user from a task
    unassignUserFromTask: async (taskId, userId) => {
      await axios.post(`${API_BASE_URL}/api/tasks/${taskId}/unassign-user`, {
        userId,
      });
      await get().fetchUsers(); // Refresh users
    },

    // Add an author to a task
    addAuthorToTask: async (taskId, authorId) => {
      await axios.post(`${API_BASE_URL}/api/tasks/${taskId}/add-author`, {
        authorId,
      });
      await get().fetchAuthors(taskId); // Refresh authors for this task
    },

    // Remove an author from a task
    removeAuthorFromTask: async (taskId, authorId) => {
      await axios.post(`${API_BASE_URL}/api/tasks/${taskId}/remove-author`, {
        authorId,
      });
      await get().fetchAuthors(taskId); // Refresh authors for this task
    },

    // Add a publisher to a task
    addPublisherToTask: async (taskId, publisherId) => {
      await axios.post(`${API_BASE_URL}/api/tasks/${taskId}/add-publisher`, {
        publisherId,
      });
      await get().fetchPublishers(taskId); // Refresh publishers for this task
    },

    // Remove a publisher from a task
    removePublisherFromTask: async (taskId, publisherId) => {
      await axios.post(`${API_BASE_URL}/api/tasks/${taskId}/remove-publisher`, {
        publisherId,
      });
      await get().fetchPublishers(taskId); // Refresh publishers for this task
    },

    // Add a reference to a task
    addReferenceToTask: async (taskId, referenceId) => {
      await axios.post(`${API_BASE_URL}/api/tasks/${taskId}/add-source`, {
        referenceId,
      });
      await get().fetchReferences(taskId);
    },

    // Remove a reference from a task
    removeReferenceFromTask: async (taskId, referenceId) => {
      await axios.post(`${API_BASE_URL}/api/tasks/${taskId}/remove-sources`, {
        referenceId,
      });
      await get().fetchReferences(taskId);
    },
  }))
);
