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

// extension/src/entities/Task.ts (or wherever Lit_references is defined)
export interface Lit_references {
  url: string;
  content_name: string;
  origin?: "dom" | "claim";
  claimIds?: number[]; // Task claim IDs this reference supports
  stance?: string; // support|refute|nuance|insufficient
  quote?: string; // Extracted evidence quote
  summary?: string; // Evidence summary/rationale
  quality?: number; // Evidence quality score (0-1)
  location?: { page?: number; section?: string }; // Location in source
  publishedAt?: string; // Publication date
  raw_text?: string; // Pre-fetched text from evidence engine (AI refs only)
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
  Claims: string[];
  taskContentId?: string | null;
  is_retracted: boolean;
  testimonials: Testimonial[]; // <--- new!
  // Evidence metadata (for references)
  claimIds?: number[]; // Task claim IDs this reference supports
  stance?: string; // support|refute|nuance|insufficient
  quote?: string; // Extracted evidence quote
  summary?: string; // Evidence summary/rationale
  quality?: number; // Evidence quality score (0-1)
  location?: { page?: number; section?: string }; // Location in source
  publishedAt?: string; // Publication date
}

// 🧩 Shared across orchestrateScraping, analyzeContent, etc.
export interface Testimonial {
  text: string;
  name?: string;
  imageUrl?: string | null;
}

export interface ClaimSourcePick {
  claim: string;
  sources: {
    url: string;
    title?: string;
    stance?: string;
    why?: string;
  }[];
}

export interface AnalyzeContentOptions {
  includeEvidence?: boolean;
}

export interface AnalyzeContentResponse {
  success: boolean;
  data?: {
    generalTopic: string;
    specificTopics: string[];
    claims: string[];
    testimonials: Testimonial[];
    claimSourcePicks?: ClaimSourcePick[];
    evidenceRefs?: Lit_references[];
  };
  error?: string;
}
