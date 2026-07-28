import { AgentRuntimeError } from "./agentErrors.js";

export type RunBudget = {
  maxModelTurns: number;
  maxToolCalls: number;
  maxWallTimeMs: number;
};

export const SMOKE_RUN_BUDGET: Readonly<RunBudget> = Object.freeze({
  maxModelTurns: 4,
  maxToolCalls: 1,
  maxWallTimeMs: 60_000,
});

export function assertPositiveBudget(budget: RunBudget): void {
  for (const [name, value] of Object.entries(budget)) {
    if (!Number.isInteger(value) || value <= 0) {
      throw new AgentRuntimeError("configuration", `${name} must be a positive integer`);
    }
  }
}
