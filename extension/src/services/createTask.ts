import {
  fetchPageContent,
  extractAuthors,
  extractPublisher,
  extractReferences,
} from "../services/extractMetaData";
import { fetchArticleData } from "../services/diffbotService";

import axios from "axios";

const BASE_URL = process.env.REACT_APP_BASE_URL || "http://localhost:5001";

let taskId = "";

const createTask = async (taskData: any) => {
  const articleUrl = taskData.url;
  console.log(articleUrl);
  try {
    const diffbotResponse = await fetch(`${BASE_URL}/api/pre-scrape`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ articleUrl }),
    });
    const content = await diffbotResponse.json();
    console.log(content, "contet after ru");
  } catch (error) {
    console.log(error, "contet after ru");
  }

  try {
    const response = await fetch(`${BASE_URL}/api/scrape`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(taskData),
    });

    const responseData = await response.json();
    console.log("Task creation response:", responseData);
    // Return the task_id from the response
    taskId = responseData.task_id || null;
  } catch (error) {
    console.error("Error adding task:", error);
  }
  const url = taskData.url;
  const $ = await fetchPageContent(url);
  const authors = await extractAuthors($);
  const publisher = await extractPublisher($, url);
  const lit_references = await extractReferences($);

  // Step 2: Add Authors

  if (authors.length > 0) {
    // Call stored procedure to insert or fetch author
    await axios.post(`${BASE_URL}/api/tasks/${taskId}/authors`, { authors });
  }

  // Step 3: Add Publisher
  if (publisher) {
    await axios.post(`${BASE_URL}/api/tasks/${taskId}/publishers`, {
      publisher,
    });
  }

  // Step 4: Add Sources (References)
  console.log([...lit_references], ":from createtask before");
  console.log(lit_references.length, ":lit ref lengexit"); // Should log: true
  if (Array.isArray(lit_references)) {
    try {
      for (const lit_reference of lit_references) {
        console.log(lit_reference, ":from createtask");
        await axios.post(`${BASE_URL}/api/tasks/${taskId}/add-source`, {
          lit_reference,
        });
      }
    } catch (error) {
      console.error("Error in createTask:", error);
    }
  }
};

export default createTask;
