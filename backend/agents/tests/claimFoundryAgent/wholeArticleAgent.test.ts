import assert from "node:assert/strict";
import test from "node:test";
import {
  Usage,
  type Model,
  type ModelProvider,
  type ModelRequest,
  type ModelResponse,
} from "@openai/agents";
import {
  CF6_ARTICLE_CONTEXT_OPEN,
} from "../../claimFoundry/claimFoundryArticleContext.js";
import {
  createWholeArticleClaimFoundryAgentDefinition,
  WHOLE_ARTICLE_CLAIM_FOUNDRY_TOOL_NAMES,
} from "../../claimFoundry/claimFoundryWholeArticleAgent.js";
import {
  recordWholeArticleTurnBudgetExhaustion,
  runWholeArticleClaimFoundry,
} from "../../claimFoundry/claimFoundryWholeArticleRunner.js";
import {
  createWholeArticleClaimFoundryTools,
} from "../../claimFoundry/claimFoundryWholeArticleTools.js";
import {
  MemoryClaimFoundryPersistence,
} from "../../claimFoundry/claimFoundryPersistence.js";
import { createRunState } from "../../claimFoundry/claimFoundryState.js";
import { deriveContentRegions } from "../../claimFoundry/claimFoundryCoverage.js";
import { claim, document, manifestHash } from "../claimFoundry/fixtures.js";

function usage(turn: number) {
  const inputTokens = turn === 1 ? 1_000 : 100_000;
  const cachedTokens = turn === 1 ? 0 : 100_000;
  return new Usage({
    requests: 1,
    input_tokens: inputTokens,
    output_tokens: 100,
    total_tokens: inputTokens + 100,
    input_tokens_details: { cached_tokens: cachedTokens },
    request_usage_entries: [{
      input_tokens: inputTokens,
      output_tokens: 100,
      total_tokens: inputTokens + 100,
      input_tokens_details: { cached_tokens: cachedTokens },
    }],
  });
}

function budgetUsage(inputTokens: number, cachedTokens: number) {
  return new Usage({
    requests: 1,
    input_tokens: inputTokens,
    output_tokens: 100,
    total_tokens: inputTokens + 100,
    input_tokens_details: { cached_tokens: cachedTokens },
    request_usage_entries: [{
      input_tokens: inputTokens,
      output_tokens: 100,
      total_tokens: inputTokens + 100,
      input_tokens_details: { cached_tokens: cachedTokens },
    }],
  });
}

function functionCall(
  turn: number,
  name: string,
  args: unknown,
  requestUsage = usage(turn),
): ModelResponse {
  return {
    usage: requestUsage,
    responseId: `resp-whole-${turn}`,
    requestId: `req-whole-${turn}`,
    output: [{
      type: "function_call",
      callId: `call-whole-${turn}`,
      name,
      status: "completed",
      arguments: JSON.stringify(args),
    }],
  };
}

class WholeArticleScriptModel implements Model {
  readonly requests: ModelRequest[] = [];

  constructor(
    private readonly persistence: MemoryClaimFoundryPersistence,
    private readonly runId: string,
  ) {}

  async getResponse(request: ModelRequest): Promise<ModelResponse> {
    this.requests.push(structuredClone(request));
    const turn = this.requests.length;
    if (turn === 1) {
      return functionCall(turn, "update_working_package", {
        idempotencyKey: "script-update-1",
        expectedPackageRevision: 0,
        setTheses: [{
          thesisId: "T1",
          statement: "The article reports a quantified rainfall increase.",
          groundingUnitIds: [document.sourceUnits[1]!.unitId],
        }],
        upsertClaims: [{
          ...claim("C1", document.sourceUnits[1]!.unitId),
          thesisIds: ["T1"],
          thesisEffect: "Provides the central quantified representation.",
        }],
      });
    }
    if (turn === 2) {
      return functionCall(turn, "inspect_working_package", {
        idempotencyKey: "script-inspect-1",
        expectedPackageRevision: 1,
      });
    }
    const state = await this.persistence.load(this.runId);
    const pkg = state?.wholeArticleWorkingPackage;
    assert.ok(pkg?.latestInspection);
    return functionCall(turn, "finalize_working_package", {
      idempotencyKey: "script-finalize-1",
      expectedPackageRevision: pkg.packageRevision,
      expectedPackageHash: pkg.packageHash,
      inspectionId: pkg.latestInspection.inspectionId,
    });
  }

  async *getStreamedResponse(): AsyncIterable<any> {
    throw new Error("Streaming is not used");
  }
}

class Provider implements ModelProvider {
  constructor(readonly model: Model) {}
  async getModel() {
    return this.model;
  }
}

async function setup(runId: string) {
  const persistence = new MemoryClaimFoundryPersistence();
  const conversationId = `conv-${runId}`;
  await persistence.create(createRunState({
    runId,
    contentId: "content-1",
    contentHash: document.contentHash,
    sourceUnitManifestHash: manifestHash,
    contentRegions: deriveContentRegions(document),
    budgets: {
      maxToolCalls: 30,
      maxUnitsRead: 1,
      maxRepairRounds: 0,
      maxInputTokens: 100_000,
    },
    continuation: { strategy: "conversationId", id: conversationId },
    traceId: null,
    versions: {
      instruction: "cf6.whole-article.instructions.v2.1",
      toolSchema: "cf6.wholeArticle.tools.v2.1",
      model: "script",
      code: "cf6.whole-article.v2.1",
    },
  }));
  return {
    persistence,
    conversationId,
    context: {
      runId,
      contentId: "content-1",
      articleDocument: document,
      persistence,
    },
  };
}

test("whole-article agent completes in one Runner.run without a post-terminal model call", async () => {
  const run = await setup("whole-agent-terminal");
  const model = new WholeArticleScriptModel(run.persistence, run.context.runId);
  const result = await runWholeArticleClaimFoundry({
    context: run.context,
    model: "script-model",
    modelProvider: new Provider(model),
    conversationId: run.conversationId,
    cacheReportingToleranceTokens: 0,
    operationalBudget: {
      maxUncachedInputTokens: 2_000_000,
      maxCostEquivalentInputTokens: 2_000_000,
      cachedInputCostCoefficient: 0,
    },
  });

  assert.equal(result.state.status, "completed");
  assert.equal(result.sdkResult.finalOutput.status, "completed");
  assert.equal(result.sdkResult.runtimeEvidence.runnerInvocations, 1);
  assert.equal(result.sdkResult.runtimeEvidence.providerRequests, 3);
  assert.equal(model.requests.length, 3);
  assert.deepEqual(
    model.requests[0]!.tools.map(tool => tool.name),
    [...WHOLE_ARTICLE_CLAIM_FOUNDRY_TOOL_NAMES],
  );
  assert.equal(model.requests.every(request =>
    request.modelSettings.toolChoice === "required"), true);
  assert.equal(model.requests.every(request =>
    request.modelSettings.parallelToolCalls === false), true);
  assert.equal(
    JSON.stringify(model.requests[0]!.input)
      .split(CF6_ARTICLE_CONTEXT_OPEN).length - 1,
    1,
  );
  assert.equal(
    JSON.stringify(model.requests[1]!.input).includes(CF6_ARTICLE_CONTEXT_OPEN),
    false,
  );
  assert.equal(result.requestEvidence.cacheCoverage.every(item => item.passed), true);
  assert.ok(result.finalPackage);
  assert.equal(result.finalPackage?.packageHash,
    result.sdkResult.finalOutput.finalPackageHash);
});

class UpdateThenFinalizeModel implements Model {
  readonly requests: ModelRequest[] = [];

  constructor(
    private readonly persistence: MemoryClaimFoundryPersistence,
    private readonly runId: string,
  ) {}

  async getResponse(request: ModelRequest): Promise<ModelResponse> {
    this.requests.push(structuredClone(request));
    const turn = this.requests.length;
    if (turn === 1) {
      return functionCall(turn, "update_working_package", {
        idempotencyKey: "direct-finalize-update",
        expectedPackageRevision: 0,
        setTheses: [{
          thesisId: "T1",
          statement: "The article reports a quantified rainfall increase.",
          groundingUnitIds: [document.sourceUnits[1]!.unitId],
        }],
        upsertClaims: [{
          ...claim("C1", document.sourceUnits[1]!.unitId),
          thesisIds: ["T1"],
          thesisEffect: "Provides the central quantified representation.",
        }],
        dispositionRemainingRegions: {
          reasonCode: "NO_MATERIAL_ASSERTION",
        },
      });
    }
    const state = await this.persistence.load(this.runId);
    const pkg = state?.wholeArticleWorkingPackage;
    assert.ok(pkg);
    return functionCall(turn, "finalize_working_package", {
      idempotencyKey: "direct-finalize-terminal",
      expectedPackageRevision: pkg.packageRevision,
      expectedPackageHash: pkg.packageHash,
      inspectionId: "I-PRIOR-INSPECTION-NOT-REQUIRED",
    });
  }

  async *getStreamedResponse(): AsyncIterable<any> {
    throw new Error("Streaming is not used");
  }
}

test("current-state finalization needs no extra inspection model request", async () => {
  const run = await setup("whole-agent-direct-finalize");
  const model = new UpdateThenFinalizeModel(
    run.persistence,
    run.context.runId,
  );
  const result = await runWholeArticleClaimFoundry({
    context: run.context,
    model: "script-model",
    modelProvider: new Provider(model),
    conversationId: run.conversationId,
  });

  assert.equal(result.state.status, "completed");
  assert.equal(result.sdkResult.finalOutput.status, "completed");
  assert.equal(model.requests.length, 2);
  assert.equal(result.sdkResult.runtimeEvidence.providerRequests, 2);
  const events = await run.persistence.events(run.context.runId);
  assert.deepEqual(
    events.map(event => event.toolName),
    ["update_working_package", "finalize_working_package"],
  );
  assert.equal(
    result.state.wholeArticleWorkingPackage?.latestInspection
      ?.deterministicClean,
    true,
  );
});

class OrdinaryExitModel implements Model {
  readonly requests: ModelRequest[] = [];

  async getResponse(request: ModelRequest): Promise<ModelResponse> {
    this.requests.push(structuredClone(request));
    return {
      usage: usage(1),
      responseId: "resp-ordinary",
      output: [{
        type: "message",
        role: "assistant",
        status: "completed",
        content: [{
          type: "output_text",
          text: JSON.stringify({
            status: "abstained",
            finalPackageId: null,
            finalPackageHash: null,
            packageRevision: null,
            reasonCode: "MODEL_TEXT_ONLY",
          }),
        }],
      }],
    };
  }
  async *getStreamedResponse(): AsyncIterable<any> {
    throw new Error("Streaming is not used");
  }
}

test("ordinary model output cannot complete a non-terminal persisted run", async () => {
  const run = await setup("whole-agent-nonterminal");
  const model = new OrdinaryExitModel();
  await assert.rejects(
    runWholeArticleClaimFoundry({
      context: run.context,
      model: "script-model",
      modelProvider: new Provider(model),
      conversationId: run.conversationId,
    }),
    /TOOL_REQUIRED_PROTOCOL_VIOLATION.*NON_TERMINAL_AGENT_EXIT/,
  );
  assert.equal(model.requests.length, 1);
  assert.equal(model.requests[0]?.modelSettings.toolChoice, "required");
  const state = await run.persistence.load(run.context.runId);
  assert.equal(state?.status, "failed");
  assert.equal(state?.terminalReasonCode, "TOOL_REQUIRED_PROTOCOL_VIOLATION");
  assert.equal(
    state?.pendingReviewReasons.includes("NON_TERMINAL_AGENT_EXIT"),
    true,
  );
  assert.equal(
    (await run.persistence.events(run.context.runId)).at(-1)?.toolName,
    "record_non_terminal_agent_exit",
  );
});

test("whole-article definition exposes exactly four fixed tools with terminal behavior", async () => {
  const run = await setup("whole-agent-definition");
  const definition = createWholeArticleClaimFoundryAgentDefinition({
    context: run.context,
  });
  assert.deepEqual(
    definition.tools.map(tool => tool.name),
    [...WHOLE_ARTICLE_CLAIM_FOUNDRY_TOOL_NAMES],
  );
  assert.equal(definition.tools.some(tool => tool.isEnabled), false);
  assert.equal(definition.modelSettings?.toolChoice, "required");
  assert.equal(definition.modelSettings?.parallelToolCalls, false);
  assert.equal(definition.resetToolChoice, false);
  assert.equal(typeof definition.toolUseBehavior, "function");
});

class AbstainModel implements Model {
  readonly requests: ModelRequest[] = [];

  async getResponse(request: ModelRequest): Promise<ModelResponse> {
    this.requests.push(structuredClone(request));
    return functionCall(1, "abstain_or_request_review", {
      idempotencyKey: "terminal-abstain-once",
      mode: "abstain",
      reasonCode: "SOURCE_INADEQUATE",
      reason: "The source cannot support a grounded working package.",
    });
  }

  async *getStreamedResponse(): AsyncIterable<any> {
    throw new Error("Streaming is not used");
  }
}

test("successful abstention is terminal without a post-terminal model request", async () => {
  const run = await setup("whole-agent-terminal-abstain");
  const model = new AbstainModel();
  const result = await runWholeArticleClaimFoundry({
    context: run.context,
    model: "script-model",
    modelProvider: new Provider(model),
    conversationId: run.conversationId,
  });

  assert.equal(result.state.status, "abstained");
  assert.equal(result.sdkResult.finalOutput.status, "abstained");
  assert.equal(result.sdkResult.runtimeEvidence.runnerInvocations, 1);
  assert.equal(result.sdkResult.runtimeEvidence.providerRequests, 1);
  assert.equal(model.requests.length, 1);
});

class FailedTerminalThenAbstainModel implements Model {
  readonly requests: ModelRequest[] = [];

  async getResponse(request: ModelRequest): Promise<ModelResponse> {
    this.requests.push(structuredClone(request));
    const turn = this.requests.length;
    if (turn === 1) {
      return functionCall(turn, "finalize_working_package", {
        idempotencyKey: "failed-terminal-first",
        expectedPackageRevision: 0,
        expectedPackageHash: "0".repeat(64),
        inspectionId: "I-MISSING",
      });
    }
    return functionCall(turn, "abstain_or_request_review", {
      idempotencyKey: "terminal-after-failure",
      mode: "request_review",
      reasonCode: "FINALIZE_REJECTED",
      reason: "Finalization was rejected and requires review.",
    });
  }

  async *getStreamedResponse(): AsyncIterable<any> {
    throw new Error("Streaming is not used");
  }
}

test("a failed terminal action does not terminate and a later successful terminal action does", async () => {
  const run = await setup("whole-agent-failed-terminal-continues");
  const model = new FailedTerminalThenAbstainModel();
  const result = await runWholeArticleClaimFoundry({
    context: run.context,
    model: "script-model",
    modelProvider: new Provider(model),
    conversationId: run.conversationId,
  });

  assert.equal(result.state.status, "awaiting_review");
  assert.equal(result.sdkResult.finalOutput.status, "awaiting_review");
  assert.equal(model.requests.length, 2);
  assert.equal(result.sdkResult.runtimeEvidence.providerRequests, 2);
  const events = await run.persistence.events(run.context.runId);
  assert.equal(events[0]?.toolName, "finalize_working_package");
  assert.equal(events[0]?.status, "failed");
  assert.equal(events[1]?.toolName, "abstain_or_request_review");
  assert.equal(events[1]?.status, "completed");
});

class NonTerminalUpdateModel implements Model {
  readonly requests: ModelRequest[] = [];

  constructor(
    private readonly persistence: MemoryClaimFoundryPersistence,
    private readonly runId: string,
  ) {}

  async getResponse(request: ModelRequest): Promise<ModelResponse> {
    this.requests.push(structuredClone(request));
    const turn = this.requests.length;
    const state = await this.persistence.load(this.runId);
    const expectedPackageRevision =
      state?.wholeArticleWorkingPackage?.packageRevision ?? 0;
    return functionCall(turn, "update_working_package", {
      idempotencyKey: `budget-update-turn-${turn}`,
      expectedPackageRevision,
      setTheses: [{
        thesisId: "T1",
        statement: `The selected thesis remains under revision ${turn}.`,
        groundingUnitIds: [document.sourceUnits[1]!.unitId],
      }],
    });
  }

  async *getStreamedResponse(): AsyncIterable<any> {
    throw new Error("Streaming is not used");
  }
}

test("model-turn exhaustion persists budget_exhausted without abstention or another request", async () => {
  const run = await setup("whole-agent-turn-budget");
  const model = new NonTerminalUpdateModel(
    run.persistence,
    run.context.runId,
  );
  const result = await runWholeArticleClaimFoundry({
    context: run.context,
    model: "script-model",
    modelProvider: new Provider(model),
    conversationId: run.conversationId,
    runtimeBudget: {
      maxModelTurns: 2,
      maxToolCalls: 24,
      maxWallTimeMs: 30_000,
    },
  });

  assert.equal(model.requests.length, 2);
  assert.equal(result.sdkResult.runtimeEvidence.runnerInvocations, 1);
  assert.equal(result.sdkResult.runtimeEvidence.providerRequests, 2);
  assert.equal(result.sdkResult.finalOutput.status, "budget_exhausted");
  assert.equal(result.state.status, "budget_exhausted");
  assert.equal(result.state.terminalReasonCode, "TURN_BUDGET_EXHAUSTED");
  assert.equal(result.state.wholeArticleWorkingPackage?.packageRevision, 2);
  assert.notEqual(result.state.status, "abstained");
  const budgetEvents = (await run.persistence.events(run.context.runId))
    .filter(event => event.toolName === "record_turn_budget_exhaustion");
  assert.equal(budgetEvents.length, 1);
  assert.equal(budgetEvents[0]?.status, "completed");
  const replay = await recordWholeArticleTurnBudgetExhaustion(run.context);
  assert.equal(replay.replayed, true);
  assert.equal(replay.state.status, "budget_exhausted");
  assert.equal(
    (await run.persistence.events(run.context.runId))
      .filter(event => event.toolName === "record_turn_budget_exhaustion")
      .length,
    1,
  );

  const tools = createWholeArticleClaimFoundryTools(run.context);
  await assert.rejects(
    tools.abstain_or_request_review({
      idempotencyKey: "after-budget-terminal",
      mode: "abstain",
      reasonCode: "SHOULD_NOT_MUTATE",
      reason: "The terminal budget state must be immutable.",
    }),
    /TERMINAL_RUN/,
  );
  const unchanged = await run.persistence.load(run.context.runId);
  assert.equal(unchanged?.status, "budget_exhausted");
  assert.equal(
    unchanged?.wholeArticleWorkingPackage?.packageRevision,
    2,
  );
});

class SixTurnBudgetFinalizeModel implements Model {
  readonly requests: ModelRequest[] = [];

  constructor(
    private readonly persistence: MemoryClaimFoundryPersistence,
    private readonly runId: string,
  ) {}

  async getResponse(request: ModelRequest): Promise<ModelResponse> {
    this.requests.push(structuredClone(request));
    const turn = this.requests.length;
    const state = await this.persistence.load(this.runId);
    const pkg = state?.wholeArticleWorkingPackage;
    assert.ok(pkg);
    if (turn <= 5) {
      return functionCall(
        turn,
        "inspect_working_package",
        {
          idempotencyKey: `budget-inspect-turn-${turn}`,
          expectedPackageRevision: pkg.packageRevision,
        },
        turn === 1
          ? budgetUsage(1_000, 0)
          : budgetUsage(10_000, 10_000),
      );
    }
    return functionCall(
      turn,
      "finalize_working_package",
      {
        idempotencyKey: "budget-finalize-turn-6",
        expectedPackageRevision: pkg.packageRevision,
        expectedPackageHash: pkg.packageHash,
        inspectionId: pkg.latestInspection?.inspectionId ?? "I-NOT-REQUIRED",
      },
      budgetUsage(560_000, 560_000),
    );
  }

  async *getStreamedResponse(): AsyncIterable<any> {
    throw new Error("Streaming is not used");
  }
}

test("a terminal tool selected by the budget-crossing sixth response executes before termination", async () => {
  const run = await setup("whole-agent-budget-finalize");
  const tools = createWholeArticleClaimFoundryTools(run.context);
  await tools.update_working_package({
    idempotencyKey: "budget-finalize-seed",
    expectedPackageRevision: 0,
    setTheses: [{
      thesisId: "T1",
      statement: "The article reports a quantified rainfall increase.",
      groundingUnitIds: [document.sourceUnits[1]!.unitId],
    }],
    upsertClaims: [{
      ...claim("C1", document.sourceUnits[1]!.unitId),
      thesisIds: ["T1"],
      thesisEffect: "Provides the central quantified representation.",
    }],
    dispositionRemainingRegions: {
      reasonCode: "NO_MATERIAL_ASSERTION",
    },
  });
  const model = new SixTurnBudgetFinalizeModel(
    run.persistence,
    run.context.runId,
  );

  const result = await runWholeArticleClaimFoundry({
    context: run.context,
    model: "script-model",
    modelProvider: new Provider(model),
    conversationId: run.conversationId,
  });

  assert.equal(model.requests.length, 6);
  assert.equal(result.sdkResult.runtimeEvidence.providerRequests, 6);
  assert.equal(result.sdkResult.finalOutput.status, "completed");
  assert.equal(result.state.status, "completed");
  assert.equal(result.state.terminalReasonCode, null);
  assert.ok(result.usageEvidence.costEquivalentInputTokens > 60_000);
  const events = await run.persistence.events(run.context.runId);
  assert.equal(events.at(-1)?.toolName, "finalize_working_package");
  assert.equal(events.at(-1)?.status, "completed");
  assert.equal(
    events.some(event =>
      event.toolName === "record_operational_budget_exhaustion"),
    false,
  );
  assert.ok(result.finalPackage);
});

class CostCrossingNonTerminalModel implements Model {
  readonly requests: ModelRequest[] = [];

  async getResponse(request: ModelRequest): Promise<ModelResponse> {
    this.requests.push(structuredClone(request));
    assert.equal(this.requests.length, 1, "a later provider request is forbidden");
    return functionCall(
      1,
      "update_working_package",
      {
        idempotencyKey: "budget-nonterminal-update",
        expectedPackageRevision: 0,
        setTheses: [{
          thesisId: "T1",
          statement: "The selected thesis remains nonterminal.",
          groundingUnitIds: [document.sourceUnits[1]!.unitId],
        }],
      },
      budgetUsage(61_000, 0),
    );
  }

  async *getStreamedResponse(): AsyncIterable<any> {
    throw new Error("Streaming is not used");
  }
}

test("a budget-crossing nonterminal tool executes then persists operational exhaustion without another request", async () => {
  const run = await setup("whole-agent-budget-nonterminal");
  const model = new CostCrossingNonTerminalModel();
  const result = await runWholeArticleClaimFoundry({
    context: run.context,
    model: "script-model",
    modelProvider: new Provider(model),
    conversationId: run.conversationId,
  });

  assert.equal(model.requests.length, 1);
  assert.equal(result.sdkResult.runtimeEvidence.providerRequests, 1);
  assert.equal(result.sdkResult.metadata.modelTurns, 1);
  assert.equal(result.sdkResult.toolEvents.length, 1);
  assert.equal(result.sdkResult.toolEvents[0]?.name, "update_working_package");
  assert.equal(result.state.status, "budget_exhausted");
  assert.equal(
    result.state.terminalReasonCode,
    "OPERATIONAL_COST_EQUIVALENT_BUDGET_EXHAUSTED",
  );
  assert.equal(
    result.sdkResult.finalOutput.reasonCode,
    "OPERATIONAL_COST_EQUIVALENT_BUDGET_EXHAUSTED",
  );
  assert.equal(
    result.state.wholeArticleWorkingPackage?.packageRevision,
    1,
  );
  const events = await run.persistence.events(run.context.runId);
  assert.deepEqual(
    events.map(event => [event.toolName, event.status]),
    [
      ["update_working_package", "completed"],
      ["record_operational_budget_exhaustion", "completed"],
    ],
  );
});
