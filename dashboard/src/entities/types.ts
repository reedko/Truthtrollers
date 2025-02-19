// src/types.ts

// Task Interface - Consolidated from all sources
type TaskProgress =
  | "Unassigned"
  | "Assigned"
  | "Started"
  | "Partially Complete"
  | "Awaiting Evaluation"
  | "Completed";

export interface Task {
  content_id: number;
  content_name: string;
  thumbnail: string;
  media_source?: string; // From extension
  url: string;
  assigned: "assigned" | "unassigned";
  progress: TaskProgress;
  users: string[]; // Ensuring this is always an array
  details: string;
  topic: string;
  subtopic: string;
  authors?: Author[]; // Making this consistently an array
  publishers?: Publisher[]; // Making this consistently an array
}

// Author Interface
export interface Author {
  author_id: number;
  author_first_name: string;
  author_last_name: string;
  author_other_name?: string;
  author_title?: string;
  author_profile_pic?: string;
}

// Publisher Interface
export interface Publisher {
  publisher_id: number;
  publisher_name: string;
  publisher_owner?: string;
  publisher_icon?: string;
}

// References
export interface LitReference {
  reference_content_id: number;
  url: string;
  author_id?: number;
  content_name: string;
}

// User Interface
export interface User {
  user_id: number;
  username: string;
}

// Relationships
export interface TaskAuthor {
  content_author_id: number;
  content_id: number;
  author_id: number;
}

export interface TaskReference {
  content_relation_id: number;
  content_id: number;
  reference_content_id: number;
}

export interface AuthReference {
  auth_reference_id: number;
  auth_id: number;
  reference_content_id: number;
}

// D3 Graph Node Interface (Extending Task for Visualization Needs)
import * as d3 from "d3";

export class GraphNode implements d3.SimulationNodeDatum {
  id: string;
  label: string;
  type: string;
  url?: string;
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;

  get group(): number {
    return this.type === "author"
      ? 1
      : this.type === "task"
      ? 2
      : this.type === "publisher"
      ? 3
      : 4;
  }

  constructor(id: string, label: string, type: string, url?: string) {
    this.id = id;
    this.label = label;
    this.type = type;
    this.url = url;
  }
}

export interface Link extends d3.SimulationLinkDatum<GraphNode> {
  source: string | GraphNode;
  target: string | GraphNode;
  type: string;
  value?: number;
}
