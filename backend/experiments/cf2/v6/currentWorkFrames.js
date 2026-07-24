const normalized = (value) => String(value ?? "").trim().replace(/\s+/g, " ");
const normalizedKey = (value) => normalized(value).toLocaleLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, " ").trim();

const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "been", "before", "between",
  "by", "for", "from", "had", "has", "have", "in", "is", "it", "of", "on",
  "or", "that", "the", "their", "than", "to", "was", "were", "with",
]);

const CURRENT_WORK_FRAME = /^(?<frame>(?<subject>(?:(?:the|this|our|the present) study|we))\s+(?:found|report(?:ed)?|showed|demonstrated|concluded)(?:\s+that)?\s+)(?<content>.+)$/iu;

function contentTokens(value) {
  return [...new Set(normalizedKey(value).split(" ")
    .filter((token) => token.length > 1 && !STOPWORDS.has(token)))];
}

function groundingOverlap(content, groundingText) {
  const tokens = contentTokens(content);
  if (tokens.length === 0) return 0;
  const groundingTokens = new Set(contentTokens(groundingText));
  return tokens.filter((token) => groundingTokens.has(token)).length
    / tokens.length;
}

function frameIsGrounded(frame, groundingText) {
  const frameKey = normalizedKey(frame);
  const groundingKey = normalizedKey(groundingText);
  const operator = frameKey.match(
    /\b(found|report|reported|showed|demonstrated|concluded)\b/u,
  )?.[1];
  return groundingKey.includes(frameKey)
    || (groundingKey.includes("the study") && operator
      && groundingKey.includes(operator));
}

export function resolveCurrentWorkFrames(
  candidates,
  article,
  { minimumGroundingOverlap = 0.6 } = {},
) {
  const byline = (article.authors ?? []).map(normalized).filter(Boolean);
  return candidates.map((candidate) => {
    const surfaceAssertion = candidate.surfaceAssertion ?? candidate.rawAssertion;
    const match = normalized(candidate.rawAssertion).match(CURRENT_WORK_FRAME);
    if (!match?.groups || byline.length === 0) {
      return {
        ...candidate,
        surfaceAssertion,
        currentWorkFrameAudit: null,
      };
    }
    const frame = normalized(match.groups.frame);
    const subject = normalizedKey(match.groups.subject);
    const content = normalized(match.groups.content);
    const groundingIds = new Set(candidate.groundingUnitIds);
    const groundingText = candidate.contextUnits
      .filter((unit) => groundingIds.has(unit.unitId))
      .map((unit) => unit.text)
      .join("\n");
    const groundedFrame = frameIsGrounded(frame, groundingText);
    const overlap = groundingOverlap(content, groundingText);
    const explicitlyCurrentWork = subject !== "the study";
    if (groundedFrame && !explicitlyCurrentWork) {
      return {
        ...candidate,
        surfaceAssertion,
        currentWorkFrameAudit: {
          status: "grounded_study_frame_preserved",
          frame,
          groundingOverlap: overlap,
        },
      };
    }
    if (overlap < minimumGroundingOverlap) {
      return {
        ...candidate,
        surfaceAssertion,
        currentWorkFrameAudit: {
          status: "ungrounded_study_frame_not_repaired",
          frame,
          groundingOverlap: overlap,
        },
      };
    }
    return {
      ...candidate,
      rawAssertion: content,
      surfaceAssertion,
      currentWorkFrameAudit: {
        status: groundedFrame
          ? "host_removed_grounded_current_work_frame"
          : "host_removed_ungrounded_current_work_frame",
        removedFrame: frame,
        groundingOverlap: overlap,
        sourceName: byline.join(", "),
        sourceKind: "article_voice",
      },
    };
  });
}
