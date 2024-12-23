// src/services/dataTransform.ts

import {
  Author,
  Publisher,
  Task,
  LitReference,
  TaskAuthor,
  TaskReference,
  AuthReference,
  Node,
  Link,
} from "../entities/useD3Nodes";

interface Data {
  authors: Author[];
  publishers: Publisher[];
  tasks: Task[];
  lit_references: LitReference[];
  task_authors: TaskAuthor[];
  task_references: TaskReference[];
  auth_references: AuthReference[];
}

export const transformData = (
  data: Data,
  currentTaskId: number
): { nodes: Node[]; links: Link[] } => {
  const nodes: Node[] = [];
  const links: Link[] = [];

  // Helper function to add unique nodes
  const addNode = (node: Node) => {
    if (!nodes.find((n) => n.id === node.id)) {
      nodes.push(node);
    }
  };

  // 1. Add Authors
  data.authors.forEach((author) => {
    addNode({
      id: `author-${author.author_id}`,
      label: `${author.author_first_name} ${author.author_last_name}`,
      group: 1,
    });
  });

  // 2. Add Publishers
  data.publishers.forEach((publisher) => {
    addNode({
      id: `publisher-${publisher.publisher_id}`,
      label: publisher.publisher_name,
      group: 3,
    });
  });

  // 3. Add Current Task with task_name
  const currentTask = data.tasks.find((t) => t.task_id === currentTaskId);
  if (currentTask) {
    addNode({
      id: `task-${currentTask.task_id}`,
      label: currentTask.task_name, // Use task_name instead of 'Task 5'
      group: 2,
    });

    // Link Task to Publisher
    links.push({
      source: `task-${currentTask.task_id}`,
      target: `publisher-${data.publishers[0].publisher_id}`,
      type: "published_by",
      value: 1,
    });
  } else {
    console.error(`Task with ID ${currentTaskId} not found.`);
    return { nodes, links };
  }

  // 4. Add Lit_References and Link to Task
  data.lit_references.forEach((ref) => {
    addNode({
      id: `lit_reference-${ref.lit_reference_id}`,
      label: ref.lit_reference_title,
      group: 4,
    });

    // Link Lit_Reference to Task
    links.push({
      source: `task-${currentTaskId}`,
      target: `lit_reference-${ref.lit_reference_id}`,
      type: "references",
      value: 1,
    });

    // Link Lit_Reference to Author (if exists)
    if (ref.lit_reference_author_id) {
      const authorExists = data.authors.some(
        (author) => author.author_id === ref.lit_reference_author_id
      );
      if (authorExists) {
        links.push({
          source: `lit_reference-${ref.lit_reference_id}`,
          target: `author-${ref.lit_reference_author_id}`,
          type: "authored",
          value: 1,
        });
      } else {
        console.warn(
          `Lit_Reference ID ${ref.lit_reference_id} has an invalid lit_reference_author_id: ${ref.lit_reference_author_id}`
        );
        // Optionally, handle differently or skip
      }
    }
  });

  // 5. Link Task to Authors via Task_Authors
  console.log("any authors", data.task_authors);
  data.task_authors.forEach((ta) => {
    console.log("any authors", { ta });
    if (ta.task_id === currentTaskId) {
      const authorExists = data.authors.some(
        (author) => author.author_id === ta.author_id
      );
      if (authorExists) {
        links.push({
          source: `task-${ta.task_id}`,
          target: `author-${ta.author_id}`,
          type: "authored",
          value: 1,
        });
      } else {
        console.warn(
          `Task_Author ID ${ta.task_author_id} references invalid author_id (${ta.author_id})`
        );
      }
    }
  });

  // 6. Link Task to Lit_References via Task_References
  data.task_references.forEach((tr) => {
    if (tr.task_id === currentTaskId) {
      const litRefExists = data.lit_references.some(
        (ref) => ref.lit_reference_id === tr.lit_reference_id
      );
      if (litRefExists) {
        links.push({
          source: `task-${tr.task_id}`,
          target: `lit_reference-${tr.lit_reference_id}`,
          type: "references",
          value: 1,
        });
      } else {
        console.warn(
          `Task_Reference ID ${tr.task_reference_id} references invalid lit_reference_id (${tr.lit_reference_id})`
        );
      }
    }
  });

  // 7. Link Lit_References to Authors via Auth_References
  data.auth_references.forEach((ar) => {
    const litRefExists = data.lit_references.some(
      (ref) => ref.lit_reference_id === ar.lit_reference_id
    );
    const authorExists = data.authors.some(
      (author) => author.author_id === ar.auth_id
    );
    if (litRefExists && authorExists) {
      links.push({
        source: `lit_reference-${ar.lit_reference_id}`,
        target: `author-${ar.auth_id}`,
        type: "authored",
        value: 1,
      });
    } else {
      console.warn(
        `Auth_Reference ID ${ar.auth_reference_id} references invalid lit_reference_id (${ar.lit_reference_id}) or auth_id (${ar.auth_id})`
      );
    }
  });

  // 8. Link Authors to Publishers based on Task Associations
  // Assuming that the task's authors are associated with the task's publishers
  data.task_authors.forEach((ta) => {
    if (ta.task_id === currentTaskId) {
      // Find all publishers associated with the task
      data.publishers.forEach((publisher) => {
        // Avoid duplicate links
        const existingLink = links.find(
          (link) =>
            (link.source === `author-${ta.author_id}` &&
              link.target === `publisher-${publisher.publisher_id}`) ||
            (link.target === `author-${ta.author_id}` &&
              link.source === `publisher-${publisher.publisher_id}`)
        );
        if (!existingLink) {
          links.push({
            source: `author-${ta.author_id}`,
            target: `publisher-${publisher.publisher_id}`,
            type: "affiliated_with",
            value: 1,
          });
        }
      });
    }
  });

  console.log("Final Transformed Nodes:", nodes);
  console.log("Final Transformed Links:", links);

  return { nodes, links };
};
