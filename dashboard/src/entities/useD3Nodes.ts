// src/entities/useD3Nodes.ts

import * as d3 from "d3";

// Extend SimulationNodeDatum to include custom properties
export interface Node extends d3.SimulationNodeDatum {
  id: string;
  label: string;
  group: number; // 1: Author, 2: Task, 3: Publisher, 4: Lit_Reference
}

// Extend SimulationLinkDatum to include custom properties
export interface Link extends d3.SimulationLinkDatum<Node> {
  type: string; // "authored", "published_by", "references", "auth_referenced"
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
  task_id: number;
  publisher_id: number;
  task_name: string;
  // Add other relevant fields related to the scraped content
}

export interface LitReference {
  lit_reference_id: number;
  lit_reference_link: string;
  lit_reference_author_id?: number;
  lit_reference_title: string;
}

export interface TaskAuthor {
  task_author_id: number;
  task_id: number;
  author_id: number;
}

export interface TaskReference {
  task_reference_id: number;
  task_id: number;
  lit_reference_id: number;
}
export interface User {
  user_id: number;
  username: string;
}
export interface Reference {
  lit_reference_id: number;
  lit_reference_link: string;
  lit_reference_title: string;
}
export interface AuthReference {
  auth_reference_id: number;
  auth_id: number;
  lit_reference_id: number;
}

// D3.js Node and Link Interfaces
export interface Node {
  id: string;
  label: string;
  group: number; // Authors:1, Tasks:2, Publishers:3, Lit_References:4
  x?: number; // Position - optional as D3 assigns
  y?: number; // Position - optional as D3 assigns
}

export interface Link {
  source: string | Node;
  target: string | Node;
  type: string; // e.g., "authored", "published_by", "references"
  value?: number;
}
