import { processTaskClaims } from "../../core/processTaskClaims.js";
import { finishOpenAiUsageCapture, withOpenAiUsageCapture } from "../../core/openAiUsageTelemetry.js";

function createMemoryQuery() {
  let nextId = 1;
  return async (sql) => {
    const statement = String(sql).replace(/\s+/g, " ").trim().toLowerCase();
    if (statement.startsWith("select")) return [];
    if (statement.startsWith("insert into claims")) return { insertId: nextId++ };
    if (statement.startsWith("insert") || statement.startsWith("update")
      || statement.startsWith("delete")) return { affectedRows: 1 };
    throw new Error(`Unsupported baseline dry-run query: ${statement.slice(0, 80)}`);
  };
}

function presentBaselineClaims(claims) {
  return claims.map((claim, index) => ({
    id: `baseline-claim-${index + 1}`,
    text: claim.text,
    role: claim.role,
    sourceExcerpt: claim.sourceExcerpt,
    namedEntities: claim.namedEntities,
    namedStudiesOrDocuments: claim.namedStudiesOrDocuments,
    targets: [],
  }));
}

export async function runBaselineForComparison({ article, fixtureId, repeat }) {
  const started = performance.now();
  return withOpenAiUsageCapture({ producer: "baseline", fixtureId, repeat }, async () => {
    try {
      const claims = await processTaskClaims({
        query: createMemoryQuery(),
        taskContentId: repeat + 1,
        text: article.text,
        title: article.title,
        byline: article.authors?.join(", ") || null,
        date: article.publishedAt,
      });
      const usage = finishOpenAiUsageCapture({ status: "completed" });
      return { status: "completed", output: { claims: presentBaselineClaims(claims) }, usage,
        durationMs: Math.round(performance.now() - started), error: null };
    } catch (error) {
      const usage = finishOpenAiUsageCapture({ status: "failed" });
      return { status: "failed", output: null, usage,
        durationMs: Math.round(performance.now() - started),
        error: { code: error.code ?? "BASELINE_FAILED", message: error.message } };
    }
  });
}
