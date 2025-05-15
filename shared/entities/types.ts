// src/types.ts

// Task Interface - Consolidated from all sources
type TaskProgress =
  | "Unassigned"
  | "Assigned"
  | "Started"
  | "Partially Complete"
  | "Awaiting Evaluation"
  | "Completed";

export type ClaimsByTaskMap = {
  [content_id: number]: Claim[];
};

export type ClaimReferenceMap = {
  [claimId: number]: { referenceId: number; supportLevel: number }[];
};

export interface Task {
  content_id: number;
  content_name: string;
  thumbnail: string;
  media_source?: string; // From extension
  url: string;
  assigned: "assigned" | "unassigned";
  progress: TaskProgress;
  users: User[]; // Ensuring this is always an array
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
  description?: string;
}

export interface AuthorRating {
  author_rating_id: number;
  author_id: number;
  source: string;
  url: string;
  bias_score: number;
  veracity_score: number;
  topic_id: number;
  notes?: string;
  topic_name?: string;
}

// Publisher Interface
export interface Publisher {
  publisher_id: number;
  publisher_name: string;
  publisher_owner?: string;
  publisher_icon?: string;
  description: string;
}

//Publisher Rating interface
export interface PublisherRating {
  publisher_rating_id: number;
  publisher_id: number;
  source: string;
  url: string;
  bias_score: number;
  veracity_score: number;
  topic_id: number;
  notes?: string;
  topic_name?: string;
}

//topics
export interface Topic {
  topic_id: number;
  topic_name: string;
}

// References
export interface LitReference {
  reference_content_id: number;
  content_name: string;
  url: string;
  author_id?: number;
  claim_source_id?: number;
}

export interface ReferenceWithClaims {
  reference_content_id: number;
  content_name: string;
  url?: string;
  thumbnail?: string;
  progress?: string;
  details?: string;
  media_source?: string;
  topic?: string;
  subtopic?: string;
  claims: {
    claim_id: number;
    claim_text: string;
  }[];
  is_primary_source?: boolean;
}
export type UnifiedReference = ReferenceWithClaims;
// Claims
export interface Claim {
  claim_id: number;
  claim_text: string;
  veracity_score: number;
  confidence_level: number;
  last_verified: string; // Timestamp as ISO string
  references?: ClaimReference[]; // References that support/refute the claim
  relationship_type?: string; // Type of relationship to the content (if relevant)
  content_id?: number;
}

export interface ClaimReference {
  reference_content_id: number;
  content_name: string;
  url: string;
  support_level: number; // Positive = supports, Negative = refutes
}

export interface ClaimLinks {
  id: number;
  claim_link_id?: number; // for future use
  task_content_id: number;
  left_claim_id: number;
  right_reference_id: number;
  source_claim_id: number;
  relationship: "supports" | "refutes" | "related";
  confidence: number;
  notes?: string;
}
// User Interface
export interface User {
  user_id: number;
  username: string;
  email: string;
  role: string;
  can_post?: boolean;
  jwt?: string;
  isDemo?: boolean;
  user_profile_image?: string;
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
  x: number;
  y: number;
  fx?: number | null;
  fy?: number | null;
  angle?: number;
  radialOffset?: number;
  claim_id?: number;
  content_id?: number;
  trust_score?: number;
  rating_source?: string;
  publisher_id?: number;
  author_id?: number;

  /*
 
  */
  get group(): number {
    return this.type === "author"
      ? 1
      : this.type === "task"
      ? 2
      : this.type === "publisher"
      ? 3
      : 4;
  }

  constructor(
    id: string,
    label: string,
    type: string,
    x: number,
    y: number,
    url?: string,
    content_id?: number,
    claim_id?: number,
    publisher_id?: number,
    author_id?: number
  ) {
    this.id = id;
    this.label = label;
    this.type = type;
    this.url = url;
    this.x = x;
    this.y = y;
    this.content_id = content_id;
    this.claim_id = claim_id;
    this.publisher_id = publisher_id;
    this.author_id = author_id;
  }
}

export interface Link extends d3.SimulationLinkDatum<GraphNode> {
  id: string;
  source: string;
  target: string;
  type: string;
  value?: number;
  angle?: number;
  relation?: "supports" | "refutes" | "related"; // ✅ Add this line
  support_level?: number; //
  counts?: {
    support: number;
    refute: number;
    related: number;
  };
  claim_text?: string;
  content_id?: number;
  notes?: string;
}

export interface Lit_references {
  url: string;
  content_name: string;
}

export interface Publisher {
  name: string;
  description: string;
}

export interface DiscussionEntry {
  id: number;
  content_id: number;
  side: "pro" | "con";
  text: string;
  citation_url?: string;
  linked_claim_id?: number;
  citation_score?: number; // -1 to +1 scaled to [-100, +100] UI
  created_at: string;
  user?: string;
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
  is_retracted: boolean;
}
export function toReferenceWithClaims(
  ref: LitReference | ReferenceWithClaims
): ReferenceWithClaims {
  if ("claims" in ref) return ref;
  return {
    ...(ref as LitReference),
    claims: [],
  };
}
export interface TrollmeterData {
  trollmeter_score: number; // Between 0.0 and 1.0 (support vs. refute)
  pro_weight: number;
  con_weight: number;
  total_weight: number;
}
export interface VerimeterData {
  verimeter_score: number; // Main weighted score (-1 to 1)
  avg_veracity_score: number; // Average veracity from refs
  avg_bias_score: number; // Average bias from refs
  num_references: number; // How many references are included
  num_authors: number; // How many authors are included
  top_publisher: string | null; // Best-rated publisher name
  top_publisher_score: number | null;
  top_author: string | null; // Best-rated author name
  top_author_score: number | null;
  verimeter_mood: string; // e.g. "Truthy", "Sketchy"
}
