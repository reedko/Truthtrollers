// ./src/store/useTopicsStore.ts
import { create } from "zustand";
import { devtools } from "zustand/middleware";
import axios from "axios";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:5001";

interface Topic {
  topic_id: number;
  topic_name: string;
  thumbnail: string;
}

interface Subtopic {
  task_id: number;
  topic_id: number;
  topic_order: number;
}

interface TopicsState {
  topics: Topic[];
  subtopics: { [taskId: number]: Topic[] };
  selectedTopic: string | undefined;
  selectedSubtopic: string | undefined;
  setSelectedTopic: (topic: string | undefined) => void;
  setSelectedSubtopic: (subtopic: string | undefined) => void;
  fetchTopics: () => Promise<void>;
}

export const useTopicsStore = create<TopicsState>()(
  devtools((set) => ({
    topics: [],
    subtopics: {},
    selectedTopic: undefined,
    selectedSubtopic: undefined,
    setSelectedTopic: (topic) => set({ selectedTopic: topic }),
    setSelectedSubtopic: (subtopic) => set({ selectedSubtopic: subtopic }),
    fetchTopics: async () => {
      try {
        const [topicsResponse, taskTopicsResponse] = await Promise.all([
          axios.get<Topic[]>(`${API_BASE_URL}/api/topics`),
          axios.get<Subtopic[]>(`${API_BASE_URL}/api/task_topics`),
        ]);

        const allTopics = topicsResponse.data;
        const allTaskTopics = taskTopicsResponse.data;

        const mainTopics: Topic[] = [];
        const subtopicsByTask: { [taskId: number]: Topic[] } = {};

        // Process task_topics to categorize main topics and subtopics
        allTaskTopics.forEach((taskTopic) => {
          const topic = allTopics.find(
            (t) => t.topic_id === taskTopic.topic_id
          );
          if (topic) {
            if (taskTopic.topic_order === 1) {
              mainTopics.push(topic);
            } else {
              if (!subtopicsByTask[taskTopic.task_id]) {
                subtopicsByTask[taskTopic.task_id] = [];
              }
              subtopicsByTask[taskTopic.task_id].push(topic);
            }
          }
        });

        const uniqueMainTopics = Array.from(
          new Set(mainTopics.map((t) => t.topic_id))
        ).map((id) => mainTopics.find((t) => t.topic_id === id)!);

        set({ topics: uniqueMainTopics, subtopics: subtopicsByTask });
      } catch (error) {
        console.error("Error fetching topics:", error);
      }
    },
  }))
);
