import axios from "axios";
import { TaskData, Author, Publisher } from "../entities/Task";
const BASE_URL = process.env.REACT_APP_BASE_URL || "https://localhost:5001";

const EXTENSION_ID = "phacjklngoihnlhcadefaiokbacnagbf";
const IS_EXTENSION = typeof chrome !== "undefined" && chrome.runtime?.id;

// ✅ Create Task (De-Extensionized)
const createTask = async (taskData: TaskData): Promise<string | null> => {
  console.log(
    "Creating content:",
    taskData.url,
    "as",
    taskData.content_type,
    "with task contentID of",
    taskData.taskContentId
  );

  try {
    let contentId: string | null = null;

    if (IS_EXTENSION) {
      // ✅ Inside Extension - Use `chrome.runtime.sendMessage`
      contentId = await new Promise<string>((resolve, reject) => {
        chrome.runtime.sendMessage(
          EXTENSION_ID,
          { action: "addContent", taskData },
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
    } else {
      // ✅ Outside Extension - Use API call
      const response = await fetch(`${BASE_URL}/api/addContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(taskData),
      });
      const responseData = await response.json();
      contentId = responseData.content_id;
      if (!contentId) {
        throw new Error("Failed to create content via API");
      }
      console.log("✅ Content created with ID:", contentId);
    }

    if (!contentId) {
      throw new Error("Content ID is null");
    }

    // ✅ Step 2: Attach metadata (Authors, Publisher, References) in Parallel
    await Promise.all([
      taskData.authors.length > 0
        ? addAuthors(contentId, taskData.authors)
        : Promise.resolve(),
      taskData.publisherName
        ? addPublisher(contentId, taskData.publisherName)
        : Promise.resolve(),
      taskData.Claims.length > 0
        ? storeClaimsInDB(contentId, taskData.Claims, taskData.content_type)
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
  if (IS_EXTENSION) {
    return new Promise<void>((resolve, reject) => {
      chrome.runtime.sendMessage(
        EXTENSION_ID,
        { action: "addAuthors", contentId, authors },
        (response) => {
          response?.success ? resolve() : reject("Failed to add authors");
        }
      );
    });
  } else {
    // ✅ API Call Version
    try {
      await fetch(`${BASE_URL}/api/content/${contentId}/authors`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contentId, authors }),
      });
      console.log("✅ Authors added successfully");
    } catch (error) {
      console.error("❌ Error adding authors:", error);
      throw new Error("Failed to add authors via API");
    }
  }
};

// ✅ Attach Publisher
const addPublisher = async (contentId: string, publisher: Publisher) => {
  if (IS_EXTENSION) {
    return new Promise<void>((resolve, reject) => {
      chrome.runtime.sendMessage(
        EXTENSION_ID,
        { action: "addPublisher", contentId, publisher },
        (response) => {
          response?.success ? resolve() : reject("Failed to add publisher");
        }
      );
    });
  } else {
    // ✅ API Call Version
    try {
      await fetch(`${BASE_URL}/api/content/${contentId}/publishers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contentId, publisher }),
      });
      console.log("✅ Publisher added successfully");
    } catch (error) {
      console.error("❌ Error adding publisher:", error);
      throw new Error("Failed to add publisher via API");
    }
  }
};

// ✅ Store the claims by sending to background => server OR API
const storeClaimsInDB = async (
  contentId: string,
  claims: string[],
  contentType: string
) => {
  console.log("📌 storeClaimsInDB called with:", {
    contentId,
    claims,
    contentType,
  });

  if (IS_EXTENSION) {
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
  } else {
    // ✅ API Call Version
    try {
      const response = await fetch(`${BASE_URL}/api/claims/add`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content_id: contentId,
          claims,
          content_type: contentType,
        }), // ✅ Ensure content_id is correct
      });
      console.log("✅ Claims stored successfully");
    } catch (error) {
      console.error("❌ Error storing claims:", error);
      throw new Error("Failed to store claims via API");
    }
  }
};

export default createTask;
