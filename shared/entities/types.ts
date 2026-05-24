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
  content_type?: string; // "task" or "reference"
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
  publisher_name?: string;
  author_name?: string;
  topic?: string;
  subtopic?: string;
  claims: {
    claim_id: number;
    claim_text: string;
  }[];

  is_primary_source?: boolean;
  is_system?: boolean; // TRUE = evidence engine ref (cannot be deleted by regular users)
  added_by_user_id?: number | null; // NULL = system ref, otherwise user who added it
}
export type UnifiedReference = ReferenceWithClaims;
// Claims
export interface Claim {
  claim_id: number;
  claim_text: string;
  claim_type?: "task" | "reference" | "snippet" | string; // NEW: Type of claim
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

// AI Evidence Link - from reference_claim_links table
export interface AIEvidenceLink {
  link_id: number;
  task_claim_id: number;
  reference_content_id: number;
  stance: "support" | "refute" | "nuance" | "insufficient";
  score: number; // 0-100 quality score
  confidence: number; // 0.15-0.98 confidence
  support_level: number; // -1.2 to +1.2 (stance * confidence * quality)
  rationale: string | null;
  quote: string | null; // Evidence snippet
  evidence_offsets: string | null;
  created_by_ai: boolean;
  task_claim_text: string;
  task_claim_type?: string;
  reference_title: string;
  reference_url: string;
  reference_topic: string;
}

// Failed Reference - needs manual scraping
export interface FailedReference {
  content_id: number;
  content_name: string;
  url: string;
  failure_reason: string;
  created_at: string;
  linked_claims_count: number;
}

export interface ClaimLinker {
  claim_link_id: number;
  user_id: number;
  username?: string;
  source_claim_id: number;
  target_claim_id: number;
  relationship: string;
  support_level: number | null;
  notes: string;
  source_claim_text: string;
  target_claim_text: string;
  source_url: string;
  author_name: string;
  publisher_name: string;
  created_at: string;
  is_mine?: boolean;
}
export interface ContentLink {
  content_id: number;
  content_name: string;
  thumbnail: string;
  media_source?: string; // From extension
  url: string;
  content_type?: string; // "task" or "reference"
  assigned: "assigned" | "unassigned";
  progress: TaskProgress;
  users: User[]; // Ensuring this is always an array
  details: string;
  topic: string;
  subtopic: string;
  authors?: Author[]; // Making this consistently an array
  publishers?: Publisher[]; // Making this consistently an array
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
  support_level?: number;
  verimeter_score?: number | null; // 👈 Add this if missing
}

export interface LinkedClaim {
  claim_link_id: number;
  claim_id: number;
  referenceId: number;
  sourceClaimId: number;
  relationship: string;
  confidence: number | string;
  notes: string;
  verimeter_score: number | null;
  claim_text: string;

  // Unified link type indicator
  link_type?: "claim" | "reference_claim" | "reference_doc";

  // Normalized relation for consistent display
  relation?: "support" | "refute" | "nuance";

  // AI assessment fields (from reference_claim_task_links)
  score?: number;
  stance?: string;
  support_level?: number; // -1 to 1
  rationale?: string;

  // Document-level assessment fields (from reference_claim_links)
  snippet?: string;
  truncated_snippet?: string;

  // Reference claim text (for AI claim-to-claim links)
  reference_claim_text?: string;

  // Source information
  source_name?: string;
  source_url?: string;

  // Full source claim details
  sourceClaim?: {
    claim_id: number;
    claim_text: string;
    veracity_score: number;
    confidence_level: number | null;
    last_verified: string;
  };
}
export interface GameResult {
  question: string;
  userAnswer: boolean | null;
  correctAnswer: boolean;
  isCorrect: boolean;
  sourceClaim: Claim;
  targetClaim: Claim;
  claimLink: ClaimLink | null;
  references?: {
    sourceClaim: Claim; // ⬅ full claim instead of just ID
    confidence: number;
    notes?: string;
  }[];
  viewerId?: number; // optional if you plan to pass it
}

export interface ClaimLink {
  id?: string;
  claim_link_id?: number; // for future use
  claimId: number; // target/task claim
  referenceId: number; // reference content id
  sourceClaimId: number; // 👈 new
  relation: "support" | "refute";
  confidence: number;
  notes?: string;
  verimeter_score?: number;
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
  verimeter_score?: number | null;
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
  rating?: number;
  claimCount?: number;
  veracity_score?: number;
  confidence_level?: number;
  // Phase 6: Provenance tracking
  added_by_user_id?: number | null;
  is_system?: boolean;
  // Visual state for molecule view
  dimmed?: boolean;

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
    author_id?: number,
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
  user_id?: number | null; // For claim_links filtering
  created_by_ai?: boolean; // For AI vs human filtering
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
  source_urls?: string[]; // optional array of URLs
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
  ref: LitReference | ReferenceWithClaims,
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

// ================================================
// Discussion Units System
// ================================================
// For generating structured social media posts from analyzed content

export type DiscussionUnitType = 'claim' | 'support' | 'counter' | 'summary';
export type DiscussionGenerationStatus = 'pending' | 'processing' | 'completed' | 'failed';
export type PostStatus = 'pending' | 'posted' | 'failed' | 'deleted';
export type SocialPlatform = 'twitter_x' | 'facebook' | 'linkedin' | 'mastodon';
export type PostingTone = 'neutral' | 'assertive' | 'question';

export interface DiscussionUnitSource {
  title: string;
  url: string;
  quality?: number;
}

export interface DiscussionUnit {
  unit_id?: number;
  bundle_id?: number;
  unit_type: DiscussionUnitType;
  unit_text: string;
  original_text?: string | null;
  unit_order: number;
  parent_unit_id?: number | null;

  // Source data linkage
  claim_id?: number | null;
  reference_content_id?: number | null;

  // Metadata
  confidence?: number | null;
  support_level?: number | null;
  stance?: string | null;
  sources?: DiscussionUnitSource[] | null;

  // User modifications
  is_edited?: boolean;
  edited_at?: string | null;
  is_selected_for_posting?: boolean;

  created_at?: string;
}

export interface DiscussionBundle {
  bundle_id?: number;
  content_id: number;
  created_by: number;
  original_post_url?: string | null;
  tweet_id?: string | null;
  generation_status?: DiscussionGenerationStatus;
  generation_error?: string | null;
  created_at?: string;
  updated_at?: string;
  units?: DiscussionUnit[];
}

export interface DiscussionUnitPost {
  post_id?: number;
  unit_id: number;
  bundle_id: number;
  user_id: number;
  platform: SocialPlatform;
  external_post_id?: string | null;
  external_url?: string | null;
  parent_post_id?: number | null;
  thread_position: number;
  posted_text: string;
  character_count: number;
  post_status: PostStatus;
  post_error?: string | null;
  posted_at?: string | null;
  retry_count?: number;
  likes_count?: number;
  retweets_count?: number;
  replies_count?: number;
  last_metrics_update?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface XAuthToken {
  token_id?: number;
  user_id: number;
  access_token: string;
  refresh_token?: string | null;
  token_type: string;
  expires_at?: string | null;
  scope?: string | null;
  x_user_id?: string | null;
  x_username?: string | null;
  x_display_name?: string | null;
  is_valid: boolean;
  revoked_at?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface SocialPostRateLimit {
  limit_id?: number;
  user_id: number;
  platform: SocialPlatform;
  posts_in_last_hour: number;
  posts_in_last_day: number;
  last_post_at?: string | null;
  last_bundle_posted_at?: string | null;
  bundles_posted_today: number;
  violations_count: number;
  last_violation_at?: string | null;
  is_temporarily_blocked: boolean;
  blocked_until?: string | null;
  hour_reset_at?: string | null;
  day_reset_at?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface RateLimitCheckResult {
  can_post: boolean;
  reason: string;
}

export interface PostingRequest {
  bundleId: number;
  selectedUnitIds: number[];
  originalPostUrl: string;
  platform: SocialPlatform;
  tone?: PostingTone;
  delayBetweenPosts?: number; // seconds
}

export interface PostingResponse {
  success: boolean;
  posted_count: number;
  failed_count: number;
  posts: DiscussionUnitPost[];
  errors?: string[];
}

// =====================================================
// TruthTrollers Live Feed System Types
// =====================================================

export type TTLiveThreadType = 'imported_x' | 'native_tt' | 'hybrid';
export type TTLiveSourcePlatform = 'x' | 'twitter' | 'instagram' | 'facebook' | 'reddit' | 'native';
export type TTLiveStance = 'support' | 'refute' | 'nuance' | 'question' | 'neutral';
export type TTLiveTone = 'neutral' | 'assertive' | 'questioning' | 'educational';
export type TTLiveEvidenceType = 'reference' | 'claim' | 'content' | 'external_url';
export type TTLiveNotificationLevel = 'all' | 'mentions' | 'replies' | 'none';
export type TTLiveExportStatus = 'pending' | 'success' | 'failed' | 'revoked';
export type TTLiveVeracityAssessment = 'true' | 'false' | 'mixed' | 'unverified' | 'pending';

// Main thread container
export interface TTLiveThread {
  thread_id?: string;
  thread_title?: string | null;
  thread_type: TTLiveThreadType;

  // Source tracking
  source_platform: TTLiveSourcePlatform;
  source_thread_id?: string | null;
  source_url?: string | null;

  // Content association
  content_id?: number | null;
  task_id?: number | null;

  // Thread properties
  root_post_id?: string | null;
  is_pinned: boolean;
  is_archived: boolean;
  is_locked: boolean;

  // Moderation
  curated_by?: number | null;
  curated_at?: string | null;
  curation_notes?: string | null;

  // Thread content (from backend - not in DB)
  full_content?: string;
  post_count?: number;
  author?: {
    username?: string;
    display_name?: string;
    avatar_url?: string;
    verified?: boolean;
  };
  verimeter_score?: number | null;
  ai_verimeter_score?: number | null;
  user_verimeter_score?: number | null;
  is_ai_rating?: boolean;
  top_claims?: Array<{
    claim_id: number;
    claim_text: string;
    link_count: number;
  }>;
  claim_pairs?: {
    overall_verimeter: number;
    is_ai_rating?: boolean;
    claim_pairs: Array<{
      caseClaim: {
        claim_id: number;
        claim_text: string;
        publisher: string;
        url: string;
      };
      sourceClaim: {
        claim_id: number;
        claim_text: string;
        publisher: string;
        url: string;
        relationship: string;
      };
      verimeter_score: number;
      support_level?: number;
      confidence?: number;
      rationale?: string;
    }>;
  };

  // Engagement stats
  total_posts: number;
  total_tt_posts: number;
  total_imported_posts: number;
  total_exported_posts: number;
  total_participants: number;

  // Quality metrics
  avg_verimeter_score?: number | null;
  controversy_score: number;

  // Timestamps
  created_at?: string;
  last_activity_at?: string;
  imported_at?: string | null;
}

// Imported posts from external platforms (read-only)
export interface TTLiveImportedPost {
  imported_post_id?: string;
  thread_id: string;

  // Source tracking
  source_platform: 'x' | 'twitter' | 'instagram' | 'facebook' | 'reddit';
  source_post_id: string;
  source_url: string;

  // Author info (from external platform)
  source_author_username?: string | null;
  source_author_display_name?: string | null;
  source_author_avatar_url?: string | null;
  source_author_verified: boolean;

  // Post content
  post_text: string;
  post_media_urls?: string[] | null; // JSON array
  post_language: string;

  // Threading
  reply_to_imported_post_id?: string | null;
  is_thread_root: boolean;

  // External engagement
  source_likes_count: number;
  source_retweets_count: number;
  source_replies_count: number;

  // TT analysis
  has_extracted_claims: boolean;
  has_linked_evidence: boolean;
  veracity_assessment: TTLiveVeracityAssessment;
  verimeter_score?: number | null;

  // Timestamps
  created_at?: string;
  source_created_at?: string | null;
  last_synced_at?: string | null;
}

// Native TruthTrollers discussion posts
export interface TTLivePost {
  post_id?: string;
  thread_id: string;

  // Author info (TT user)
  author_user_id: number;
  author_role: 'contributor' | 'expert' | 'moderator' | 'admin';

  // Post content
  post_text: string;
  post_media_urls?: string[] | null; // JSON array
  post_language: string;

  // Stance & analysis
  stance: TTLiveStance;
  confidence_level?: number | null;
  tone: TTLiveTone;

  // Threading & context
  reply_to_post_id?: string | null;
  reply_to_imported_post_id?: string | null;
  context_claim_id?: number | null;

  // Export tracking
  is_exported: boolean;
  exported_to_platform?: TTLiveSourcePlatform | null;
  exported_post_id?: string | null;
  exported_at?: string | null;
  export_status?: TTLiveExportStatus | null;

  // Moderation
  is_approved: boolean;
  is_flagged: boolean;
  is_hidden: boolean;
  moderated_by?: number | null;
  moderation_reason?: string | null;

  // Evidence & quality
  has_linked_evidence: boolean;
  evidence_count: number;
  verimeter_score?: number | null;

  // Engagement (TT-internal)
  upvotes_count: number;
  downvotes_count: number;
  replies_count: number;
  bookmarks_count: number;

  // External engagement (if exported)
  external_likes_count: number;
  external_retweets_count: number;
  external_replies_count: number;

  // Timestamps
  created_at?: string;
  updated_at?: string;
  edited_at?: string | null;
}

// Evidence links for TT posts
export interface TTLivePostEvidence {
  evidence_link_id?: string;
  post_id: string;

  // Evidence source
  evidence_type: TTLiveEvidenceType;
  reference_id?: number | null;
  claim_id?: number | null;
  content_id?: number | null;
  external_url?: string | null;

  // Evidence properties
  support_level?: number | null; // -100 to +100
  relevance_score?: number | null;
  quote_text?: string | null;

  // Metadata
  added_by: number;
  added_at?: string;
}

// User subscriptions/monitoring
export interface TTLiveThreadSubscription {
  subscription_id?: string;
  thread_id: string;
  user_id: number;

  // Subscription settings
  notification_level: TTLiveNotificationLevel;
  mute_until?: string | null;

  // Monitoring (for moderators/curators)
  is_monitoring: boolean;
  monitoring_notes?: string | null;

  // Timestamps
  subscribed_at?: string;
  last_read_at?: string | null;
}

// Export audit log
export interface TTLiveExportLog {
  export_log_id?: string;
  post_id: string;

  // Export details
  exported_by: number;
  export_platform: 'x' | 'twitter' | 'instagram' | 'facebook' | 'reddit';
  export_status: TTLiveExportStatus;

  // Platform response
  platform_post_id?: string | null;
  platform_post_url?: string | null;
  error_message?: string | null;

  // Engagement tracking
  last_synced_at?: string | null;
  external_likes_count: number;
  external_retweets_count: number;
  external_replies_count: number;

  // Timestamps
  attempted_at?: string;
  completed_at?: string | null;
  revoked_at?: string | null;
}

// Combined timeline post (union of imported + TT posts)
export interface TTLiveTimelinePost {
  post_source: 'imported' | 'ttpost';
  post_id: string;
  thread_id: string;

  // Author (varies by source)
  author_user_id?: number | null;
  author_username?: string | null;
  author_display_name?: string | null;
  author_avatar_url?: string | null;

  // Post content
  post_text: string;
  post_media_urls?: string[] | null;
  stance?: TTLiveStance | null;
  verimeter_score?: number | null;

  // Engagement
  likes_count: number;
  retweets_count: number;
  replies_count: number;

  // Threading
  is_thread_root: boolean;
  reply_to_post_id?: string | null;

  // Source
  source_platform?: TTLiveSourcePlatform | null;
  source_url?: string | null;

  // Timestamps
  created_at: string;
}

// API Request/Response types for TT Live

export interface CreateThreadRequest {
  thread_title?: string;
  thread_type: TTLiveThreadType;
  source_platform: TTLiveSourcePlatform;
  source_url?: string;
  content_id?: number;
  task_id?: number;
}

export interface ImportXThreadRequest {
  x_thread_url: string;
  task_id?: number;
  content_id?: number;
}

export interface CreateTTPostRequest {
  thread_id: string;
  post_text: string;
  stance: TTLiveStance;
  tone?: TTLiveTone;
  reply_to_post_id?: string;
  reply_to_imported_post_id?: string;
  context_claim_id?: number;
  evidence_links?: {
    evidence_type: TTLiveEvidenceType;
    reference_id?: number;
    claim_id?: number;
    content_id?: number;
    external_url?: string;
    support_level?: number;
    quote_text?: string;
  }[];
}

export interface ExportPostRequest {
  post_id: string;
  export_platform: 'x' | 'twitter' | 'instagram' | 'facebook' | 'reddit';
}

export interface ThreadTimelineResponse {
  thread: TTLiveThread;
  posts: TTLiveTimelinePost[];
  has_more: boolean;
  next_cursor?: string;
}

export interface UserThreadsResponse {
  threads: TTLiveThread[];
  total_count: number;
  has_more: boolean;
  next_cursor?: string;
}

// =====================================================
// Staged Argument System Types
// =====================================================

export type ArgumentStance = 'support' | 'refute' | 'nuance' | 'question';
export type ArgumentStatus = 'draft' | 'needs_revision' | 'approved' | 'signed_off';
export type FallacyType =
  | 'ad_hominem'
  | 'strawman'
  | 'false_dichotomy'
  | 'appeal_to_emotion'
  | 'appeal_to_authority'
  | 'hasty_generalization'
  | 'slippery_slope'
  | 'circular_reasoning'
  | 'red_herring'
  | 'unsupported_claim'
  | 'other';
export type SignoffType = 'approve' | 'endorse' | 'challenge';

// Core staged argument entity
export interface StagedArgument {
  argument_id?: string;
  thread_id: string;
  author_user_id: number;

  // Core structure
  claim: string;
  stance: ArgumentStance;
  reasoning: string;

  // Validation status
  status: ArgumentStatus;

  // Civility check
  civility_passed: boolean;
  flagged_terms?: string[] | null;

  // Fallacy detection
  fallacy_check_passed: boolean;
  detected_fallacies?: ArgumentFallacy[] | null;

  // AI quality scores (0-100)
  clarity_score?: number | null;
  logical_strength_score?: number | null;
  evidence_support_score?: number | null;
  overall_quality_score?: number | null;

  // Citation requirements
  min_citations_met: boolean;
  citation_count: number;

  // Debate context
  reply_to_argument_id?: string | null;
  reply_to_post_id?: string | null;
  reply_to_imported_post_id?: string | null;

  // Signoff tracking
  signoff_count: number;
  signoff_threshold: number;

  // Export tracking
  is_exported: boolean;
  exported_to_platform?: TTLiveSourcePlatform | null;
  exported_post_id?: string | null;
  exported_at?: string | null;
  export_format?: string | null;

  // Moderation
  is_flagged: boolean;
  moderation_notes?: string | null;
  moderated_by?: number | null;

  // Version control
  original_argument_id?: string | null;
  revision_number: number;

  // Timestamps
  created_at?: string;
  updated_at?: string;
  approved_at?: string | null;
  signed_off_at?: string | null;

  // Related data (populated by joins)
  citations?: ArgumentCitation[];
  signoffs?: ArgumentSignoff[];
  author_username?: string;
  author_avatar?: string;
}

// Citation/evidence for argument
export interface ArgumentCitation {
  citation_id?: string;
  argument_id: string;

  // Citation details
  url: string;
  title?: string | null;

  // Relevance assessment
  relevance_score: number; // 0-100
  auto_scored: boolean;

  // Content analysis
  quote_text?: string | null;
  context_summary?: string | null;

  // Quality signals
  source_credibility_score?: number | null;
  is_primary_source: boolean;
  is_peer_reviewed: boolean;

  // Metadata
  added_by: number;
  created_at?: string;
}

// Detected logical fallacy
export interface ArgumentFallacy {
  fallacy_id?: string;
  argument_id: string;

  // Fallacy details
  fallacy_type: FallacyType;
  fallacy_name: string;
  description: string;

  // Location in argument
  text_excerpt?: string | null;
  excerpt_offset_start?: number | null;
  excerpt_offset_end?: number | null;

  // Detection details
  confidence_score: number; // 0-100
  detected_by_ai: boolean;
  detected_by_user_id?: number | null;

  // Resolution
  is_dismissed: boolean;
  dismissed_by?: number | null;
  dismissal_reason?: string | null;

  // Timestamps
  detected_at?: string;
  dismissed_at?: string | null;
}

// User signoff/approval
export interface ArgumentSignoff {
  signoff_id?: string;
  argument_id: string;
  user_id: number;

  // Signoff type
  signoff_type: SignoffType;

  // Optional feedback
  feedback_text?: string | null;
  suggested_improvements?: string | null;

  // Quality assessment
  personal_quality_rating?: number | null; // 0-100

  // Timestamps
  signed_at?: string;

  // User info (populated by join)
  username?: string;
  user_avatar?: string;
}

// API Request/Response types for staged arguments

export interface CreateArgumentRequest {
  thread_id: string;
  claim: string;
  stance: ArgumentStance;
  reasoning: string;
  reply_to_argument_id?: string;
  reply_to_post_id?: string;
  reply_to_imported_post_id?: string;
  citations?: {
    url: string;
    title?: string;
    quote_text?: string;
    context_summary?: string;
  }[];
}

export interface UpdateArgumentRequest {
  claim?: string;
  stance?: ArgumentStance;
  reasoning?: string;
}

export interface AddCitationRequest {
  url: string;
  title?: string;
  quote_text?: string;
  context_summary?: string;
}

export interface ArgumentSignoffRequest {
  signoff_type: SignoffType;
  feedback_text?: string;
  suggested_improvements?: string;
  personal_quality_rating?: number;
}

export interface ArgumentExportRequest {
  export_platform: 'x' | 'twitter' | 'instagram' | 'facebook' | 'reddit';
}

export interface ArgumentValidationResult {
  civility_passed: boolean;
  flagged_terms: string[];
  fallacy_check_passed: boolean;
  detected_fallacies: {
    type: FallacyType;
    name: string;
    description: string;
    excerpt: string;
  }[];
  min_citations_met: boolean;
  citation_count: number;
  clarity_score: number;
  logical_strength_score: number;
  evidence_support_score: number;
  overall_quality_score: number;
  can_approve: boolean;
  issues: string[];
}

export interface ArgumentExportResponse {
  success: boolean;
  exported_post_id?: string;
  platform_url?: string;
  error?: string;
}

// =====================================================
// Conversation Index System Types
// =====================================================

export interface Conversation {
  conversation_id: string;
  thread_id: string;
  conversation_title?: string;
  conversation_status: 'active' | 'archived' | 'locked';
  total_participants: number;
  active_participants: number;
  total_arguments: number;
  support_count: number;
  refute_count: number;
  nuance_count: number;
  question_count: number;
  arguments_staged: number;
  arguments_approved: number;
  arguments_exported: number;
  created_at: string;
  last_activity_at: string;
  archived_at?: string;
}

export interface ConversationParticipant {
  participant_id: string;
  conversation_id: string;
  user_id: number;
  role: 'participant' | 'moderator' | 'observer';
  join_reason?: string;
  arguments_contributed: number;
  last_active_at: string;
  is_active: boolean;
  joined_at: string;
  left_at?: string;

  // Populated by joins
  username?: string;
  user_avatar?: string;
}

export interface ConversationArgument {
  conv_argument_id: string;
  conversation_id: string;
  author_user_id: number;
  claim: string;
  stance: ArgumentStance;
  reasoning: string;
  reply_to_conv_argument_id?: string;
  reply_to_imported_post_id?: string;
  depth_level: number;
  upvotes: number;
  downvotes: number;
  reply_count: number;
  is_staged: boolean;
  staged_argument_id?: string;
  staged_at?: string;
  created_at: string;
  updated_at: string;

  // Populated by joins
  author_username?: string;
  author_avatar?: string;
  citations?: ConversationArgumentCitation[];
  replies?: ConversationArgument[];
}

export interface ConversationArgumentCitation {
  citation_id: string;
  conv_argument_id: string;
  url: string;
  title?: string;
  quote_text?: string;
  context_summary?: string;
  added_at: string;
}

// Request/Response types

export interface JoinConversationRequest {
  join_reason?: string;
}

export interface CreateConversationArgumentRequest {
  claim: string;
  stance: ArgumentStance;
  reasoning: string;
  reply_to_conv_argument_id?: string;
  reply_to_imported_post_id?: string;
  citations?: {
    url: string;
    title?: string;
    quote_text?: string;
    context_summary?: string;
  }[];
}

export interface StageConversationArgumentRequest {
  // Move conversation argument to staged arguments system
  task_id?: string;
  content_id?: string;
}
