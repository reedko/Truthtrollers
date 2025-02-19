import axios from "axios";
import { TaskData, Author, Lit_references, Publisher } from "../entities/Task";
const BASE_URL = process.env.REACT_APP_BASE_URL || "http://localhost:5001";

let taskId = "";

const createTask = async (taskData: TaskData) => {
  const articleUrl = taskData.url;
  const authors = taskData.authors;
  const publisher = taskData.publisherName;
  const content = taskData.content;

  console.log("Creating task for:", articleUrl);

  // Step 1: Add Task and get taskId
  const addTask = async (taskData: TaskData): Promise<string> => {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { action: "addTask", taskData },
        (response) => {
          if (response?.taskId) {
            console.log("Task created with ID:", response.taskId);
            resolve(response.taskId);
          } else {
            reject("Failed to create task");
          }
        }
      );
    });
  };

  // Step 2: Add Authors
  const addAuthors = async (
    taskId: string,
    authors: Author[]
  ): Promise<void> => {
    if (authors.length === 0) return;
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { action: "addAuthors", taskId, authors },
        (response) => {
          if (response?.success) {
            console.log("Authors added successfully.");
            resolve();
          } else {
            reject("Failed to add authors");
          }
        }
      );
    });
  };

  // Step 3: Add Publisher
  const addPublisher = async (
    taskId: string,
    publisher: Publisher
  ): Promise<void> => {
    if (!publisher) return;
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { action: "addPublisher", taskId, publisher },
        (response) => {
          if (response?.success) {
            console.log("Publisher added successfully.");
            resolve();
          } else {
            reject("Failed to add publisher");
          }
        }
      );
    });
  };

  // Step 4: Add Sources (References)
  const addSources = async (
    taskId: string,
    content: Lit_references[]
  ): Promise<void> => {
    if (!Array.isArray(content) || content.length === 0) return;
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { action: "addSources", taskId, content },
        (response) => {
          if (response?.success) {
            console.log("References added successfully.");
            resolve();
          } else {
            reject("Failed to add references");
          }
        }
      );
    });
  };

  try {
    const taskId = await addTask(taskData); // Ensure task is created first
    await addAuthors(taskId, authors); // Add authors
    await addPublisher(taskId, publisher); // Add publisher
    await addSources(taskId, content); // Add references

    return { taskId };
  } catch (error) {
    console.error("Error in createTask workflow:", error);
    return { taskId: null };
  }
};

export default createTask;
