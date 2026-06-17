export interface ReviewArticleModule {
  id: string;
  type: string;
  enabled: boolean;
  order: number;
  title: string;
  description?: string;
  data: Record<string, any>;
  asset?: {
    kind?: string;
    image_url?: string;
    public_image_url?: string;
    alt?: string;
    caption?: string;
  } | null;
  markdown: string;
  hidden?: boolean;
}

export interface ReviewArticle {
  id: number;
  content_id: number;
  author_user_id: number;
  title: string;
  slug: string | null;
  status: "draft" | "published";
  verdict: string | null;
  confidence: string | null;
  summary: string | null;
  body_markdown: string | null;
  modules_json: ReviewArticleModule[];
  canonical_review_url: string | null;
  created_at: string;
  updated_at: string;
  published_at: string | null;
}

export interface ClaimLinkArticleData {
  id?: number;
  claim_link_id?: number;
  case_claim_id?: number;
  case_claim_text?: string;
  source_claim_id?: number;
  source_claim_text?: string;
  source_title?: string | null;
  source_url?: string | null;
  source_publisher?: string | null;
  source_admiralty_code?: string | null;
  source_crest?: {
    kind?: string;
    image_url?: string;
    public_image_url?: string;
    alt?: string;
    caption?: string;
    admiralty_code?: string | null;
  } | null;
  relationship?: "supports" | "refutes" | "qualifies" | "unclear" | string;
  support_level?: number | string | null;
  rationale?: string | null;
  created_by?: number | null;
  created_at?: string | null;
}

export interface PublisherContext {
  id?: number | null;
  name?: string | null;
  wikipedia_summary?: string | null;
  wikipedia_url?: string | null;
  mbfc_bias?: string | null;
  mbfc_factual?: string | number | null;
  mbfc_url?: string | null;
  adfontes_bias?: string | null;
  adfontes_reliability?: string | number | null;
  adfontes_url?: string | null;
  veristrata_score?: number | string | null;
}

export const assembleMarkdownFromModules = (modules: ReviewArticleModule[]) =>
  [...(modules || [])]
    .filter((module) => module.enabled && module.id !== "publisher_admiralty_crests")
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((module) => module.markdown?.trim())
    .filter(Boolean)
    .join("\n\n");

export const moduleLabels: Record<string, string> = {
  verimeter_graphic: "Verimeter Graphic",
  rating_summary: "Rating Summary",
  publisher_context_graphic: "Publisher Context Graphic",
  evidence_map_image: "Evidence Map Image",
  knowledge_graph_image: "Knowledge Graph Image",
  source_landscape_graphic: "Source Landscape Graphic",
  claim_link_mini_graphics: "Claim-Link Mini Graphics",
  claim_link_analysis: "Claim-Link Analysis",
  subject_context: "Author and Publisher Subject Context",
  evidence_map_snapshot: "Evidence Map Snapshot",
  knowledge_graph_snapshot: "Knowledge Graph Snapshot",
  reviewer_reputation: "Reviewer Reputation",
  canonical_link: "Canonical VeriStrata Link",
};
