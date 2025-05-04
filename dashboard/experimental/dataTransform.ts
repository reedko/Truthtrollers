// src/services/dataTransform.ts

import {
  Author,
  Publisher,
  Task,
  LitReference,
  TaskAuthor,
  TaskReference,
  AuthReference,
  GraphNode,
  Link,
} from "../../../shared/entities/types.ts";

interface Data {
  authors: Author[];
  publishers: Publisher[];
  content: Task[];
  reference: LitReference[];
  content_authors: TaskAuthor[];
  content_relations: TaskReference[];
  auth_references: AuthReference[];
}

export const transformData = (
  data: Data,
  currentTaskId: number
): { nodes: GraphNode[]; links: Link[] } => {
  const nodes: GraphNode[] = [];
  const links: Link[] = [];

  // Helper function to add unique nodes
  const addNode = (node: GraphNode) => {
    if (!nodes.find((n) => n.id === node.id)) {
      nodes.push(node);
    }
  };

  const authors = Array.isArray(data.authors) ? data.authors : [];
  const publishers = Array.isArray(data.publishers) ? data.publishers : [];
  // 1. Add Authors
  authors.forEach((author) => {
    addNode({
      id: String(author.author_id), // Store only the raw ID
      label: `${author.author_first_name} ${author.author_last_name}`,
      group: 1,
      type: "author",
    });
  });

  // 2. Add Publishers
  publishers.forEach((publisher) => {
    addNode({
      id: String(publisher.publisher_id),
      label: publisher.publisher_name,
      group: 3,
      type: "publisher",
    });
  });

  // 3. Add Current Task
  const currentTask = data.content.find((t) => t.content_id === currentTaskId);
  if (currentTask) {
    addNode({
      id: String(currentTask.content_id),
      label: currentTask.content_name,
      group: 2,
      type: "task",
      url: currentTask.url,
    });

    // Link Task to Publisher(s)
    publishers.forEach((publisher) => {
      links.push({
        source: String(currentTask.content_id),
        target: String(publisher.publisher_id),
        type: "published_by",
        value: 1,
      });
    });
  } else {
    console.error(`Task with ID ${currentTaskId} not found.`);
    return { nodes, links };
  }

  // 4. Add Lit_References and Link to Task
  data.content.forEach((ref) => {
    addNode({
      id: String(ref.content_id),
      label: ref.content_name,
      group: 4,
      type: "reference",
      url: ref.url,
    });

    // Link Lit_Reference to Task
    links.push({
      source: String(currentTaskId),
      target: String(ref.content_id),
      type: "references",
      value: 1,
    });

    // Link Lit_Reference to Author (if exists)
    if (ref.authors) {
      links.push({
        source: String(ref.content_id),
        target: String(ref.authors),
        type: "authored",
        value: 1,
      });
    }
  });

  // 5. Link Task to Authors
  data.content_authors.forEach((ta) => {
    links.push({
      source: String(ta.content_id),
      target: String(ta.author_id),
      type: "authored",
      value: 1,
    });
  });

  // 6. Link Task to Lit_References via content_relations
  data.content_relations.forEach((tr) => {
    links.push({
      source: String(tr.content_id),
      target: String(tr.reference_content_id),
      type: "references",
      value: 1,
    });
  });

  console.log("Final Transformed Nodes:", nodes);
  console.log("Final Transformed Links:", links);

  return { nodes, links };
};
