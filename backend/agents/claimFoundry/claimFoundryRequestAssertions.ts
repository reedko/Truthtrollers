import { AgentRuntimeError } from "../shared/agentErrors.js";
import type {
  ModelRequestObservation,
  ModelRequestSnapshot,
} from "../shared/agentRuntime.js";

export type StablePrefixMeasurement = {
  instructionTokens: number;
  fixedToolSchemaTokens: number;
  articleTokens: number;
};

export type ClaimFoundryRequestAssertionConfig = {
  conversationId: string;
  stablePrefix: StablePrefixMeasurement;
  cacheCoverageRatio?: number;
  reportingToleranceTokens?: number;
  explicitCacheBreakpointExpected?: boolean;
};

export type ClaimFoundryRequestAssertionEvidence = {
  stablePrefixTokens: number;
  requiredCachedStablePrefixTokens: number;
  reportingToleranceTokens: number;
  requestSnapshots: ModelRequestSnapshot[];
  cacheCoverage: Array<{
    turn: number;
    cachedInputTokens: number;
    coveredStablePrefixRatio: number;
    passed: boolean;
  }>;
  cacheBreakpoint: {
    supported: boolean;
    applied: boolean;
  };
};

export class ClaimFoundryRequestAssertions {
  private readonly snapshots: ModelRequestSnapshot[] = [];
  private readonly cacheCoverage: ClaimFoundryRequestAssertionEvidence["cacheCoverage"] = [];
  private instructionHash: string | null = null;
  private toolSchemaHash: string | null = null;

  constructor(private readonly config: ClaimFoundryRequestAssertionConfig) {
    if (!config.conversationId.trim()) {
      throw new Error("CF6 request assertions require a conversation ID");
    }
    if (this.stablePrefixTokens <= 0) {
      throw new Error("CF6 stable prefix must contain tokens");
    }
  }

  get stablePrefixTokens() {
    return this.config.stablePrefix.instructionTokens +
      this.config.stablePrefix.fixedToolSchemaTokens +
      this.config.stablePrefix.articleTokens;
  }

  get cacheCoverageRatio() {
    return this.config.cacheCoverageRatio ?? 0.9;
  }

  get reportingToleranceTokens() {
    return this.config.reportingToleranceTokens ?? 0;
  }

  get requiredCachedStablePrefixTokens() {
    return Math.ceil(this.stablePrefixTokens * this.cacheCoverageRatio);
  }

  beforeModelRequest(snapshot: ModelRequestSnapshot) {
    if (snapshot.conversationId !== this.config.conversationId) {
      throw new AgentRuntimeError(
        "runtime",
        "CF6 model request did not use the authorized conversation ID",
      );
    }
    if (snapshot.previousResponseId !== null) {
      throw new AgentRuntimeError(
        "runtime",
        "CF6 mixed conversationId with previousResponseId",
      );
    }
    if (snapshot.turn === 1) {
      if (snapshot.articleMarkerOccurrences !== 1) {
        throw new AgentRuntimeError(
          "runtime",
          `CF6 initial request must contain exactly one article (${snapshot.articleMarkerOccurrences})`,
        );
      }
      const breakpointExpected =
        this.config.explicitCacheBreakpointExpected ?? true;
      if (snapshot.explicitCacheBreakpointCount !==
        (breakpointExpected ? 1 : 0)) {
        throw new AgentRuntimeError(
          "runtime",
          breakpointExpected
            ? "CF6 initial request must contain one explicit post-article cache breakpoint"
            : "CF6 older model request must not contain an unsupported explicit cache breakpoint",
        );
      }
      this.instructionHash = snapshot.instructionHash;
      this.toolSchemaHash = snapshot.toolSchemaHash;
    } else {
      if (snapshot.articleMarkerOccurrences !== 0) {
        throw new AgentRuntimeError(
          "runtime",
          `CF6 article was manually replayed on turn ${snapshot.turn}`,
        );
      }
      if (snapshot.instructionHash !== this.instructionHash) {
        throw new AgentRuntimeError("runtime", "CF6 instructions drifted between turns");
      }
      if (snapshot.toolSchemaHash !== this.toolSchemaHash) {
        throw new AgentRuntimeError("runtime", "CF6 tool schemas drifted between turns");
      }
    }
    this.snapshots.push(structuredClone(snapshot));
  }

  afterModelRequest(observation: ModelRequestObservation) {
    if (observation.turn < 2) return;
    const credited = observation.cachedInputTokens + this.reportingToleranceTokens;
    const coveredStablePrefixRatio = credited / this.stablePrefixTokens;
    const passed = credited >= this.requiredCachedStablePrefixTokens;
    this.cacheCoverage.push({
      turn: observation.turn,
      cachedInputTokens: observation.cachedInputTokens,
      coveredStablePrefixRatio,
      passed,
    });
    if (!passed) {
      throw new AgentRuntimeError(
        "budget",
        `CF6 cached input on turn ${observation.turn} covers only ` +
        `${observation.cachedInputTokens}/${this.stablePrefixTokens} stable-prefix tokens ` +
        `(+${this.reportingToleranceTokens} tolerance; required ` +
        `${this.requiredCachedStablePrefixTokens})`,
      );
    }
  }

  evidence(): ClaimFoundryRequestAssertionEvidence {
    return {
      stablePrefixTokens: this.stablePrefixTokens,
      requiredCachedStablePrefixTokens: this.requiredCachedStablePrefixTokens,
      reportingToleranceTokens: this.reportingToleranceTokens,
      requestSnapshots: structuredClone(this.snapshots),
      cacheCoverage: structuredClone(this.cacheCoverage),
      cacheBreakpoint: {
        supported: this.config.explicitCacheBreakpointExpected ?? true,
        applied: this.snapshots[0]?.explicitCacheBreakpointCount === 1,
      },
    };
  }
}
