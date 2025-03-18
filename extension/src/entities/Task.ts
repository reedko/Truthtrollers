export interface Task {
  content_id: number;
  thumbnail: string;
  content_name: string;
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
  url: string;
  content_name: string;
}

export interface Publisher {
  name: string;
}

export interface TaskData {
  content_name: string;
  media_source: string;
  url: string;
  assigned: string;
  progress: string;
  users: string;
  details: string;
  topic: string;
  subtopics: string[];
  thumbnail: string;
  iconThumbnailUrl: string | null;
  authors: Author[];
  content: Lit_references[];
  publisherName: Publisher | null;
  content_type: string; // Added this to support both types
  // new:
  raw_text?: string; // the text from /api/extractText
  Claims?: string[];
  taskContentId?: string | null;
}
