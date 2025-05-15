import { TaskData } from "../entities/Task";
import { addAuthors, addPublisher, storeClaimsInDB } from "./createTaskUtils";
import browser from "webextension-polyfill";

const createTask = async (taskData: TaskData): Promise<string | null> => {
  console.log("[EXT] Creating content:", taskData.url);

  try {
    const response = (await browser.runtime.sendMessage({
      action: "addContent",
      taskData,
    })) as { contentId: string };

    const contentId = response?.contentId;
    if (!contentId) throw new Error("Content ID was not returned");

    console.log("[EXT] Content ID:", contentId);

    await Promise.all([
      taskData.authors.length > 0
        ? addAuthors(contentId, taskData.authors, true)
        : Promise.resolve(),
      taskData.publisherName
        ? addPublisher(contentId, taskData.publisherName, true)
        : Promise.resolve(),
      taskData.Claims.length > 0
        ? storeClaimsInDB(
            contentId,
            taskData.Claims,
            taskData.content_type,
            null,
            true
          )
        : Promise.resolve(),
    ]);

    return contentId;
  } catch (err) {
    console.error("[EXT] Failed to create task:", err);
    return null;
  }
};

export default createTask;
