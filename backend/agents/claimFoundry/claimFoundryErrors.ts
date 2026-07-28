export type ClaimFoundryErrorCode =
  | "CF6_NOT_FOUND"
  | "CF6_UNAUTHORIZED_CONTENT"
  | "CF6_INVALID_STATE_TRANSITION"
  | "CF6_BUDGET_EXCEEDED"
  | "CF6_IDEMPOTENCY_CONFLICT"
  | "CF6_INVALID_PACKAGE"
  | "CF6_INVALID_PATCH"
  | "CF6_REVIEW_REQUIRED"
  | "CF6_FINALIZATION_BLOCKED";

export class ClaimFoundryError extends Error {
  constructor(
    public readonly code: ClaimFoundryErrorCode,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ClaimFoundryError";
  }
}
