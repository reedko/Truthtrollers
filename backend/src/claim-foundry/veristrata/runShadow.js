import { submitCf1Package } from "../../routes/claim-foundry/submitService.js";
import { assertVeriStrataContentAccess } from "./contentAccess.js";
import { loadVeriStrataArticle } from "./loadVeriStrataArticle.js";

export async function runVeriStrataShadow(input, dependencies) {
  const contentId = Number(input.contentId);
  if (!Number.isInteger(contentId) || contentId <= 0) {
    const error = new TypeError("contentId must be a positive integer");
    error.code = "CF1_INVALID_CONTENT_ID";
    error.status = 400;
    throw error;
  }
  await (dependencies.assertContentAccess ?? assertVeriStrataContentAccess)(dependencies.query, {
    contentId, userId: input.userId, role: input.role,
  });
  const article = await (dependencies.loadArticle ?? loadVeriStrataArticle)(dependencies.query, contentId);
  return (dependencies.submit ?? submitCf1Package)({ article,
    consumerKey: dependencies.consumerKey ?? "veristrata",
    bindingContentId: contentId, headerIdempotencyKey: input.idempotencyKey,
    options: { persist: true, allowRepair: input.allowRepair ?? true,
      includePackageInResponse: input.includePackageInResponse === true } }, dependencies);
}
