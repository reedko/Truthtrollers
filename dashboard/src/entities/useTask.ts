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
  author?: string; // Optional
  publisher?: string; // Optional
}
