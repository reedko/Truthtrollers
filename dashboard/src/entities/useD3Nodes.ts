// src/entities/useD3Nodes.ts

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

  // Hard-set group based on type
  get group(): number {
    return this.type === "author"
      ? 1
      : this.type === "task"
      ? 2
      : this.type === "publisher"
      ? 3
      : 4; // Default to 4 for lit_reference or unknown types
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
  type: string; // e.g., "authored", "published_by", "references"
  value?: number;
}

export interface Author {
  author_id: number;
  author_first_name: string;
  author_last_name: string;
  author_other_name?: string;
  author_title?: string;
  author_profile_pic?: string;
}

export interface Publisher {
  publisher_id: number;
  publisher_name: string;
  publisher_owner?: string;
  publisher_icon?: string;
}

export interface Task {
  url: string;
  content_id: number;
  publisher_id: number;
  content_name: string;
  // Add other relevant fields related to the scraped content
}

export interface LitReference {
  reference_content_id: number;
  url: string;
  author_id?: number;
  content_name: string;
}

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
export interface User {
  user_id: number;
  username: string;
}
export interface Reference {
  reference_content_id: number;
  url: string;
  content_name: string;
}
export interface AuthReference {
  auth_reference_id: number;
  auth_id: number;
  reference_content_id: number;
}
