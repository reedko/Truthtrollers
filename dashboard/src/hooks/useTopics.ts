import { useState, useEffect } from "react";

import axios from "axios";
const API_URL = process.env.VITE_API_BASE_URL || "http://localhost:5001";

interface Topic {
  topic_id: number;
  name: string;
  thumbnail: string;
}

interface TaskTopic {
  content_id: number;
  topic_id: number;
  topic_order: number;
}

const useTopics = () => {
  const [topics, setTopics] = useState<Topic[]>([]);
  const [subtopics, setSubtopics] = useState<{ [taskId: number]: Topic[] }>({});

  useEffect(() => {
    const fetchTopics = async () => {
      try {
        // Fetch all topics and content_topics
        const [topicsResponse, taskTopicsResponse] = await Promise.all([
          axios.get<Topic[]>(`${API_URL}/api/topics`), // Fetch topics from the `topics` table
          axios.get<TaskTopic[]>(`${API_URL}/api/content_topics`), // Fetch content_topics table
        ]);

        const allTopics = topicsResponse.data;
        const allTaskTopics = taskTopicsResponse.data;

        const mainTopics: Topic[] = [];
        const subtopicsByTask: { [taskId: number]: Topic[] } = {};

        // Process content_topics to split main topics and subtopics
        allTaskTopics.forEach((taskTopic) => {
          const topic = allTopics.find(
            (t) => t.topic_id === taskTopic.topic_id
          );
          if (topic) {
            if (taskTopic.topic_order === 1) {
              mainTopics.push(topic);
            } else {
              if (!subtopicsByTask[taskTopic.content_id]) {
                subtopicsByTask[taskTopic.content_id] = [];
              }
              subtopicsByTask[taskTopic.content_id].push(topic);
            }
          }
        });

        // Remove duplicates from mainTopics
        const uniqueMainTopics = Array.from(
          new Set(mainTopics.map((t) => t.topic_id))
        ).map((id) => mainTopics.find((t) => t.topic_id === id)!);

        setTopics(uniqueMainTopics);
        setSubtopics(subtopicsByTask);
      } catch (error) {
        console.error("Error fetching topics:", error);
      }
    };

    fetchTopics();
  }, []);

  return { topics, subtopics };
};

export default useTopics;
