// ./src/store/useTaskStore.ts
import { create } from "zustand";
import { devtools } from "zustand/middleware";
import axios from "axios";
import { useTopicsStore } from "./useTopicStore";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:5001";

// Define the Task interface
interface Task {
  task_id: number;
  task_name: string;
  progress:
    | "Unassigned"
    | "Assigned"
    | "Started"
    | "Partially Complete"
    | "Awaiting Evaluation"
    | "Completed";
  thumbnail: string;
  topic_id: number;
  subtopic_id?: number;
  users: string[];
}

// Define the TaskState interface
interface TaskState {
  tasks: Task[];
  selectedTasks: number[];
  currentTask: Task | null;
  assignedUsers: { [taskId: number]: string[] }; // Users assigned to each task
  references: { [taskId: number]: string[] }; // Lit references for each task
  filteredTasks: Task[]; // Computed property for filtered tasks
  loading: boolean;
  setTasks: (tasks: Task[]) => void;
  toggleTaskSelection: (taskId: number) => void;
  setCurrentTask: (task: Task | null) => void;
  fetchAssignedUsers: (taskId: number) => Promise<void>;
  fetchReferences: (taskId: number) => Promise<void>;
  assignUserToTask: (taskId: number, userId: number) => Promise<void>;
}

// Create the store using Zustand
export const useTaskStore = create<TaskState>()(
  devtools((set, get) => ({
    tasks: [],
    selectedTasks: [],
    currentTask: null,
    assignedUsers: {},
    references: {},
    filteredTasks: [], // Initialize as an empty array
    loading: false,

    // Set tasks and calculate filtered tasks
    setTasks: (tasks) => {
      set({ tasks }); // Update tasks
      const { selectedTopic, selectedSubtopic } = useTopicsStore.getState();

      const filtered = tasks.filter((task) => {
        const matchesTopic = selectedTopic
          ? task.topic_id ===
            useTopicsStore
              .getState()
              .topics.find((topic) => topic.topic_name === selectedTopic)
              ?.topic_id
          : true;

        const matchesSubtopic = selectedSubtopic
          ? task.subtopic_id ===
            useTopicsStore
              .getState()
              .subtopics[task.topic_id]?.find(
                (subtopic) => subtopic.topic_name === selectedSubtopic
              )?.topic_id
          : true;

        return matchesTopic && matchesSubtopic;
      });

      set({ filteredTasks: filtered });
    },

    // Toggle task selection
    toggleTaskSelection: (taskId) =>
      set((state) => {
        const isSelected = state.selectedTasks.includes(taskId);
        const newSelection = isSelected
          ? state.selectedTasks.filter((id) => id !== taskId)
          : [...state.selectedTasks, taskId];
        return { selectedTasks: newSelection };
      }),

    // Set the current task
    setCurrentTask: (task) => set({ currentTask: task }),

    // Fetch assigned users for a task
    fetchAssignedUsers: async (taskId) => {
      try {
        const response = await axios.get(
          `${API_BASE_URL}/api/tasks/${taskId}/users`
        );
        const users = response.data; // Array of usernames
        set((state) => ({
          assignedUsers: { ...state.assignedUsers, [taskId]: users },
        }));
      } catch (error) {
        console.error("Error fetching assigned users:", error);
      }
    },

    // Fetch references for a task
    fetchReferences: async (taskId) => {
      try {
        const response = await axios.get(
          `${API_BASE_URL}/api/tasks/${taskId}/references`
        );
        const refs = response.data; // Array of references
        set((state) => ({
          references: { ...state.references, [taskId]: refs },
        }));
      } catch (error) {
        console.error("Error fetching references:", error);
      }
    },

    // Assign a user to a task
    assignUserToTask: async (taskId, userId) => {
      try {
        await axios.post(`${API_BASE_URL}/api/tasks/${taskId}/assign`, {
          userId,
        });
        // Re-fetch users after assigning
        await get().fetchAssignedUsers(taskId);
      } catch (error) {
        console.error("Error assigning user:", error);
      }
    },
  }))
);
