import { buildPrimaryPrompt } from "./primaryPrompt.js";
import { CF1_CRITIC_SCHEMA, CF1_ORIENTATION_SCHEMA,
  CF1_REVISED_DRAFT_SCHEMA, CF1_TARGETS_SCHEMA } from "./agentStageSchemas.js";

function source(blocks, sourceUnits) {
  const units = new Map(sourceUnits.map((unit) => [unit.unitId, unit]));
  return blocks.map((block) => JSON.stringify({
    blockId: block.blockId,
    heading: block.heading,
    structuralType: block.structuralType,
    sourceUnits: (block.sourceUnitIds ?? []).map((id) => units.get(id)).filter(Boolean)
      .map(({ unitId, text }) => ({ unitId, text })),
  })).join("\n\n");
}

const SYSTEM = `You are a stage in the bounded Claim Foundry CF1 agent.
Use only the supplied article state. Do not browse, search, fetch evidence, or add outside facts.
Preserve attribution, uncertainty, scope, population, time, comparison, and causal strength.
The host owns exact text, offsets, IDs, verification, and persistence.`;

export function buildOrientationPrompt({ article, structuralBlocks, sourceUnits }) {
  return {
    system: SYSTEM,
    user: `Orient to the complete article before extracting claims.
Identify its actual theme, thesis, load-bearing pillars, opponent positions, qualifications, and argument shape.
Do not select evaluation claims yet. Cite supplied block IDs. If there is no defensible thesis, say so.

TITLE: ${article.title}
SOURCE BLOCKS
${source(structuralBlocks, sourceUnits)}`,
    responseSchema: CF1_ORIENTATION_SCHEMA,
  };
}

export function buildInitialWorkPrompt(context) {
  const prompt = buildPrimaryPrompt(context);
  return {
    ...prompt,
    system: `${prompt.system}\nThis is the initial work-product stage. It will be criticized and revised; do not pretend it is final.`,
    user: `${prompt.user}\n\nFirst orient to the article and construct its argument map; then build the initial claim work product.`,
  };
}

export function buildCriticPrompt({ article, structuralBlocks, sourceUnits }, initialWorkProduct) {
  return {
    system: `${SYSTEM}\nYou are the independent semantic critic. Do not rewrite the package in this stage.`,
    user: `Critique the initial CF1 work product against the complete article.
You MUST check: missing central claims; weak thesis/pillar coverage; duplicate or fragmented claims;
claims not grounded in supplied text; trivial over-selection; missing attribution/speaker/source;
missing or weak targets; and whether selected claims represent the article's actual argument.
An 8–12 claim portfolio is preferred when the article supports it. Report concrete, source-grounded revision actions.

TITLE: ${article.title}
SOURCE BLOCKS
${source(structuralBlocks, sourceUnits)}

INITIAL WORK PRODUCT
${JSON.stringify(initialWorkProduct)}`,
    responseSchema: CF1_CRITIC_SCHEMA,
  };
}

export function buildRevisionPrompt(context, { orientation, initialWorkProduct, criticReport, revisionPlan }) {
  const cited = new Set((criticReport.findings ?? []).flatMap((finding) => finding.sourceBlockIds ?? []));
  const revisionContext = cited.size
    ? { ...context, structuralBlocks: context.structuralBlocks.filter((block) => cited.has(block.blockId)) }
    : { ...context, structuralBlocks: [] };
  const primary = buildPrimaryPrompt(revisionContext);
  return {
    system: `${primary.system}\nYou are the revision and portfolio-selection stage. The critic report is mandatory input, not optional advice.`,
    user: `${primary.user}

ORIENTATION
${JSON.stringify(orientation)}

INITIAL WORK PRODUCT
${JSON.stringify(initialWorkProduct)}

SEMANTIC CRITIC REPORT
${JSON.stringify(criticReport)}

REVISION PLAN
${JSON.stringify(revisionPlan)}

Produce the revised work product now. Address every critic finding. Rebuild weak or incomplete raw assertions,
then select approximately 8–12 compelling evaluation claims where the article supports that many.
Selected claims must be distinct from the audit/debug raw inventory and collectively represent the article's argument.`,
    responseSchema: CF1_REVISED_DRAFT_SCHEMA,
  };
}

export function buildTargetsPrompt({ revisedWorkProduct }) {
  return {
    system: `${SYSTEM}\nYou create evidence instructions, but you never gather evidence.`,
    user: `Create Phase 3 targets and one Evidence Need Card per target from the REVISED selectedEvaluationClaims only.
Never target an unselected raw assertion. Preserve selectedClaimId and sourceRawAssertionIds exactly.
Targets must make the proposition, attribution, scope, and bearing test clear. Query seeds are instructions, not found sources.

REVISED RAW ASSERTIONS
${JSON.stringify(revisedWorkProduct.rawAssertions)}

REVISED SELECTED EVALUATION CLAIMS
${JSON.stringify(revisedWorkProduct.selectedEvaluationClaims)}`,
    responseSchema: CF1_TARGETS_SCHEMA,
  };
}
