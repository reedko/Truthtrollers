import axios from "axios";
import { TaskData, Author, Publisher } from "../entities/Task";

const BASE_URL = process.env.REACT_APP_BASE_URL || "http://localhost:5001";

const createTask = async (taskData: TaskData): Promise<string | null> => {
  console.log("Creating content:", taskData.url, "as", taskData.content_type);

  try {
    // Step 1: Create the content entry (Task or Reference)
    const contentId = await new Promise<string>((resolve, reject) => {
      chrome.runtime.sendMessage(
        { action: "addContent", taskData }, // Renamed to 'addContent' for clarity
        (response) => {
          if (response?.contentId) {
            console.log("✅ Content created with ID:", response.contentId);
            resolve(response.contentId);
          } else {
            console.error(
              "❌ No contentId returned from addContent:",
              response
            );
            reject("Failed to create content");
          }
        }
      );
    });

    // Step 2: Attach metadata (Authors, Publisher, References) in Parallel
    await Promise.all([
      taskData.authors.length > 0
        ? addAuthors(contentId, taskData.authors)
        : Promise.resolve(),
      taskData.publisherName
        ? addPublisher(contentId, taskData.publisherName)
        : Promise.resolve(),
    ]);

    return contentId;
  } catch (error) {
    console.error("❌ Error in createTask workflow:", error);
    return null;
  }
};

// ✅ Attach Authors
const addAuthors = async (contentId: string, authors: Author[]) => {
  return new Promise<void>((resolve, reject) => {
    chrome.runtime.sendMessage(
      { action: "addAuthors", contentId, authors },
      (response) => {
        response?.success ? resolve() : reject("Failed to add authors");
      }
    );
  });
};

// ✅ Attach Publisher
const addPublisher = async (contentId: string, publisher: Publisher) => {
  return new Promise<void>((resolve, reject) => {
    chrome.runtime.sendMessage(
      { action: "addPublisher", contentId, publisher },
      (response) => {
        response?.success ? resolve() : reject("Failed to add publisher");
      }
    );
  });
};

export default createTask;
