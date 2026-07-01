import axios from "axios";
import { TaskData, Author, Publisher, Task } from "../entities/Task";
import browser from "webextension-polyfill";
import { IS_EXTENSION } from "./extractMetaData";
type AddContentResponse = {
  contentId: string;
};

type GenericSuccessResponse = {
  success: boolean;
};

type StoreClaimsResponse = {
  success: boolean;
  error?: string;
};

const BASE_URL = process.env.REACT_APP_BASE_URL || "https://localhost:5001";

const EXTENSION_ID = "phacjklngoihnlhcadefaiokbacnagbf";

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
      const response = (await browser.runtime.sendMessage({
        action: "addContent",
        taskData,
      })) as AddContentResponse;

      if (response?.contentId) {
        console.log("✅ Content created with ID:", response.contentId);
        contentId = response.contentId;
      } else {
        throw new Error("Failed to create content");
      }
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
        ? storeClaimsInDB(
            contentId,
            taskData.Claims,
            taskData.content_type,
            null
          )
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
    const response = (await browser.runtime.sendMessage({
      action: "addAuthors",
      contentId,
      authors,
    })) as GenericSuccessResponse;

    if (!response?.success) throw new Error("Failed to add authors");
  } else {
    await fetch(`${BASE_URL}/api/content/${contentId}/authors`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contentId, authors }),
    });
    console.log("✅ Authors added successfully");
  }
};

// ✅ Attach Publisher

const addPublisher = async (contentId: string, publisher: Publisher) => {
  if (IS_EXTENSION) {
    const response = (await browser.runtime.sendMessage({
      action: "addPublisher",
      contentId,
      publisher,
    })) as GenericSuccessResponse;

    if (!response.success) throw new Error("Failed to add publisher");
  } else {
    await fetch(`${BASE_URL}/api/content/${contentId}/publishers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contentId, publisher }),
    });
  }
};

// ✅ Store the claims by sending to background => server OR API
const storeClaimsInDB = async (
  contentId: string,
  claims: string[],
  contentType: string,
  userId: number | null
) => {
  if (IS_EXTENSION) {
    const response = (await browser.runtime.sendMessage({
      action: "storeClaims",
      data: { contentId, claims, contentType, userId },
    })) as StoreClaimsResponse;

    if (!response.success) {
      throw new Error(response.error || "storeClaims failed");
    }
  } else {
    await fetch(`${BASE_URL}/api/claims/add`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content_id: contentId,
        claims,
        content_type: contentType,
        user_id: userId,
      }),
    });
  }
};

export default createTask;
