// src/services/createTaskDashboard.ts

import { TaskData, Author, Publisher } from "../entities/Task";
import { addAuthors, addPublisher, storeClaimsInDB } from "./createTaskUtils";

const BASE_URL = process.env.REACT_APP_BASE_URL || "https://localhost:5001";

type AddContentResponse = {
  content_id: string;
};

const createTask = async (taskData: TaskData): Promise<string | null> => {
  console.log(
    "Creating content (DASHBOARD):",
    taskData.url,
    "as",
    taskData.content_type,
    "with task contentID of",
    taskData.taskContentId
  );

  try {
    const response = await fetch(`${BASE_URL}/api/addContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(taskData),
    });

    const responseData = (await response.json()) as AddContentResponse;
    const contentId = responseData.content_id;

    if (!contentId) {
      throw new Error("Failed to create content via API");
    }

    console.log("✅ Content created with ID:", contentId);

    await Promise.all([
      taskData.authors.length > 0
        ? addAuthors(contentId, taskData.authors, false)
        : Promise.resolve(),
      taskData.publisherName
        ? addPublisher(contentId, taskData.publisherName, false)
        : Promise.resolve(),
      taskData.Claims.length > 0
        ? storeClaimsInDB(
            contentId,
            taskData.Claims,
            taskData.content_type,
            false
          )
        : Promise.resolve(),
    ]);

    return contentId;
  } catch (error) {
    console.error("❌ Error in createTask (DASHBOARD):", error);
    return null;
  }
};

export default createTask;
