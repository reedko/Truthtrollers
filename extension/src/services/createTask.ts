import axios from "axios";
import { TaskData, Author, Publisher } from "../entities/Task";
const EXTENSION_ID = "hfihldigngpdcbmedijohjdcjppdfepj";
const createTask = async (taskData: TaskData): Promise<string | null> => {
  console.log("Creating content:", taskData.url, "as", taskData.content_type);

  try {
    // Step 1: Create the content entry (Task or Reference)
    const contentId = await new Promise<string>((resolve, reject) => {
      chrome.runtime.sendMessage(
        EXTENSION_ID,
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
      taskData.Claims
        ? storeClaimsInDB(contentId, taskData.Claims, taskData.content_type)
        : Promise.resolve,
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
      EXTENSION_ID,
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
      EXTENSION_ID,
      { action: "addPublisher", contentId, publisher },
      (response) => {
        response?.success ? resolve() : reject("Failed to add publisher");
      }
    );
  });
};

// C) Store the claims by sending a message to background => server

async function storeClaimsInDB(
  contentId: string,
  claims: string[],
  contentType: string
) {
  console.log("📌 storeClaimsInDB called with:", {
    contentId,
    claims,
    contentType,
  });
  return new Promise<void>((resolve, reject) => {
    chrome.runtime.sendMessage(
      EXTENSION_ID,
      {
        action: "storeClaims",
        data: {
          contentId,
          claims,
          contentType, // ✅ Pass content type
        },
      },
      (response) => {
        if (response?.success) {
          console.log("✅ Claims stored successfully");
          resolve();
        } else {
          console.error("❌ Error storing claims:", response);
          reject(response?.error || "storeClaims failed");
        }
      }
    );
  });
}

export default createTask;
