import { useState } from "react";
import { orchestrateScraping } from "../services/orchestrateScraping";
import createTask from "../services/createTask";

export const useTaskScraper = () => {
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const scrapeTask = async (url: string) => {
    setLoading(true);
    setError(null);

    try {
      const taskData = await orchestrateScraping(url);

      const taskId = await createTask(taskData);
      console.log("Task created with ID:", taskId);

      chrome.runtime.sendMessage({
        action: "checkContent",
        forceVisible: true,
      });
    } catch (err) {
      console.error("Error during task scraping:", err);
      setError("An error occurred while scraping.");
    } finally {
      setLoading(false);
    }
  };

  return { loading, error, scrapeTask };
};
