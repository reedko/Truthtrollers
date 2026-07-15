export const ARTICLE_DOCUMENT_SCHEMA = "cf1.articleDocument.v3";

export const ARTICLE_DOCUMENT_LIMITS = Object.freeze({
  canonicalTextChars: 500_000,
  atoms: 5_000,
  sourceUnits: 20_000,
  links: 5_000,
  citationMarkers: 5_000,
  references: 2_000,
  atomTextChars: 50_000,
  metadataWarnings: 100,
});

export const ARTICLE_SOURCE_KINDS = Object.freeze(["html", "pdf", "text"]);
export const STANDARD_SOURCE_FAMILIES = Object.freeze([
  "article", "document", "plain_text", "transcript", "social_post", "social_thread",
]);
export const ARTICLE_ATOM_TYPES = Object.freeze([
  "heading", "paragraph", "quotation", "list_item", "table", "table_row",
  "caption", "code_or_preformatted", "speaker_turn", "timestamp", "social_post",
  "social_reply", "thread_separator", "separator", "unknown",
]);
export const ARTICLE_UNIT_TYPES = Object.freeze([
  "sentence", "heading", "quotation", "list_item", "table_row", "caption",
  "paragraph", "speaker_turn", "social_post", "social_reply", "other",
]);
export const ARTICLE_STRUCTURE_SIGNALS = Object.freeze([
  "htmlTag", "headingLevel", "boldProportion", "separatorBefore", "pdfPage",
  "fontSizeRatio", "verticalGapBefore", "verticalGapAfter", "transcriptSpeaker",
  "transcriptTimestampMs", "socialPostId", "socialAuthor", "socialReplyTo",
  "threadPosition", "threadDepth",
]);

export const articleAtomId = (index) => `A${String(index + 1).padStart(4, "0")}`;
export const articleUnitId = (index) => `U${String(index + 1).padStart(4, "0")}`;
export const articleLinkId = (index) => `L${String(index + 1).padStart(4, "0")}`;
export const citationMarkerId = (index) => `CM${String(index + 1).padStart(3, "0")}`;
export const articleReferenceId = (index) => `REF${String(index + 1).padStart(3, "0")}`;
