export interface Task {
  task_id: number;
  thumbnail: string;
  task_name: string;
  media_source: string;
  url: string;
  assigned: "assigned" | "unassigned";
  progress:
    | "Unassigned"
    | "Assigned"
    | "Started"
    | "Partially Complete"
    | "Awaiting Evaluation"
    | "Completed";
  users: string; // This could be an array of user IDs/names
  details: string; // Link to the task details
  topic: string;
  subtopic: string;
}

export interface Author {
  name: string;
  title?: string | null;
  postNominal?: string | null;
  description?: string | null;
  image?: string | null;
}

export interface Lit_references {
  lit_reference_link: string;
  lit_reference_title: string;
}

export interface Publisher {
  name: string;
}

export interface TaskData {
  task_name: string | null;
  media_source: string;
  url: string;
  assigned: string;
  progress: string;
  users: string;
  details: string;
  topic: string;
  subtopics: string[];
  thumbnail_url: string;
  iconThumbnailUrl: string | null;
  authors: Author[];
  lit_references: Lit_references[];
  publisherName: Publisher;
}
