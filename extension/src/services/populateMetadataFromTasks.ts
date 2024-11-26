import * as cheerio from "cheerio";
import axios from "axios";
//import { Task } from "../entities/Task";
import query from "../../../backend/src/service/dataBase"; // Assuming you have a promisified `query` method for database calls

interface Task {
  task_id: number;
  url: string;
}

export const populateMetadataFromTasks = async () => {
  try {
    // Step 1: Fetch all tasks
    const tasks: Task[] = await query(
      "SELECT task_id, url FROM tasks WHERE url IS NOT NULL"
    );

    for (const task of tasks) {
      const { task_id, url } = task;

      try {
        // Fetch the webpage
        const { data } = await axios.get(url);
        const $ = cheerio.load(data);

        // Extract publisher and author
        const publisherName =
          $('meta[property="og:site_name"]').attr("content") ||
          $('meta[name="publisher"]').attr("content") ||
          "Unknown Publisher";

        const authorName =
          $('meta[name="author"]').attr("content") ||
          $('meta[property="article:author"]').attr("content") ||
          "Unknown Author";

        // Insert or get publisher
        const [publisher] = await query(
          "CALL InsertOrGetPublisher(?, NULL, NULL, @publisherId)",
          [publisherName]
        );

        // Insert or get author
        const authorNameParts = authorName.split(" ");
        const firstName = authorNameParts[0] || null;
        const lastName = authorNameParts.slice(1).join(" ") || null;

        const [author] = await query(
          "CALL InsertOrGetAuthor(?, ?, NULL, NULL, NULL, @authorId)",
          [firstName, lastName]
        );

        // Insert into task_publishers and task_authors
        if (publisher) {
          await query(
            "INSERT INTO task_publishers (task_id, publisher_id) VALUES (?, ?)",
            [task_id, publisher.publisher_id]
          );
        }

        if (author) {
          await query(
            "INSERT INTO task_authors (task_id, author_id) VALUES (?, ?)",
            [task_id, author.author_id]
          );
        }

        // Extract references
        const references: string[] = [];
        $("a[href]").each((i, el) => {
          const link = $(el).attr("href");
          if (link && link.startsWith("http")) {
            references.push(link);
          }
        });

        for (const referenceLink of references) {
          const [litReference] = await query(
            "INSERT INTO lit_references (lit_reference_link) SELECT ? WHERE NOT EXISTS (SELECT 1 FROM lit_references WHERE lit_reference_link = ?)",
            [referenceLink, referenceLink]
          );

          if (litReference) {
            await query(
              "INSERT INTO task_references (task_id, lit_reference_id) VALUES (?, ?)",
              [task_id, litReference.lit_reference_id]
            );
          }
        }
      } catch (err) {
        console.error(`Error processing task ID ${task_id}:`, err);
      }
    }
  } catch (err) {
    console.error("Error populating metadata:", err);
    throw err;
  }
};
