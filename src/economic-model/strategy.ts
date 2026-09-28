import { z } from "zod";
import { canonicalJson, hashCanonical } from "./canonical.ts";
import {
  EconomicModelValidationError, hashEconomicModel, hashEconomicState,
  parseEconomicModel, parseEconomicState, parsePurchaseAction,
} from "./model.ts";
import type { EconomicModel, EconomicState, ModelDiagnostic, PurchaseAction } from "./model.ts";
import { step, STEP_ENGINE_VERSION } from "./step.ts";
import type { JournalEntry, RuleEvaluation } from "./step.ts";
import { IdSchema, MicroUsdcSchema } from "./value-schema.ts";

const CostEvidenceSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("user_supplied"),
    source: z.strictObject({ type: z.literal("user") }),
    notes: z.string().min(1),
  }),
  z.strictObject({
    kind: z.literal("estimated"),
    source: z.strictObject({ type: z.literal("external"), uri: z.url() }),
    notes: z.string().min(1),
  }),
]);
const ExternalCostSchema = z.strictObject({
  amountMicros: MicroUsdcSchema,
  evidence: CostEvidenceSchema,
});
const ScenarioSchema = z.strictObject({
  id: IdSchema,
  controlledIdentities: z.array(z.strictObject({
    accountId: IdSchema,
    identityCost: ExternalCostSchema,
  })).min(1),
  transactionCost: ExternalCostSchema,
});

export type ExternalCost = z.infer<typeof ExternalCostSchema>;
export type StrategyScenario = z.infer<typeof ScenarioSchema>;
export type CoalitionScore = {
  initialBalanceMicros: string;
  finalBalanceMicros: string;
  ledgerDeltaMicros: string;
  identityCostMicros: string;
  transactionCostMicros: string;
  profitMicros: string;
};
export type StrategyStep = {
  action: PurchaseAction;
  status: "accepted" | "rejected";
  beforeStateHash: string;
  afterStateHash: string;
  externalCostMicros: string;
  journal: JournalEntry[];
  evaluations: RuleEvaluation[];
  diagnostics: ModelDiagnostic[];
};
export type StrategyTrace = {
  schemaVersion: 1;
  engineVersion: typeof STEP_ENGINE_VERSION;
  modelHash: string;
  scenarioHash: string;
  scenario: StrategyScenario;
  initialState: EconomicState;
  initialStateHash: string;
  actions: PurchaseAction[];
  steps: StrategyStep[];
  finalState: EconomicState;
  finalStateHash: string;
  status: "completed" | "rejected";
  score: CoalitionScore;
};

export class StrategyValidationError extends Error {
  readonly diagnostics: ModelDiagnostic[];

  constructor(diagnostics: ModelDiagnostic[]) {
    super(diagnostics.map((item) => `${item.path}: ${item.message}`).join("; "));
    this.name = "StrategyValidationError";
    this.diagnostics = diagnostics;
  }
}

function parseScenario(input: unknown): StrategyScenario {
  const result = ScenarioSchema.safeParse(input);
  if (!result.success) {
    throw new StrategyValidationError(result.error.issues.map((issue) => ({
      path: `scenario.${issue.path.join(".")}`, message: issue.message,
    })));
  }
  return result.data;
}

function parseInput<T>(label: string, parse: (input: unknown) => T, input: unknown): T {
  try {
    return parse(input);
  } catch (error) {
    if (!(error instanceof EconomicModelValidationError)) throw error;
    throw new StrategyValidationError(error.diagnostics.map((item) => ({
      path: `${label}.${item.path}`, message: item.message,
    })));
  }
}

function coalitionBalance(state: EconomicState, scenario: StrategyScenario): bigint {
  return scenario.controlledIdentities.reduce((sum, identity) => {
    const value = state.balances[identity.accountId];
    if (!Object.hasOwn(state.balances, identity.accountId) || value === undefined) {
      throw new Error(`Controlled balance disappeared: ${identity.accountId}`);
    }
    return sum + BigInt(value);
  }, 0n);
}

function parseActions(input: unknown): PurchaseAction[] {
  const result = z.array(z.unknown()).safeParse(input);
  if (!result.success) {
    throw new StrategyValidationError([{ path: "actions", message: "actions must be an array of purchase requests" }]);
  }
  return result.data.map((action, index) =>
    parseInput(`actions.${index}`, parsePurchaseAction, action));
}

/**
 * Execute a requested action sequence through the shared ledger.
 * Identity costs are charged once up front; transaction costs per attempted action.
 * The strategy stops at its first rejected action.
 */
export function runStrategy(
  inputState: EconomicState, inputActions: PurchaseAction[],
  inputModel: EconomicModel, inputScenario: StrategyScenario,
): StrategyTrace {
  const model = parseInput("model", parseEconomicModel, inputModel);
  const initialState = parseInput("initialState", parseEconomicState, inputState);
  const actions = parseActions(inputActions);
  const scenario = parseScenario(inputScenario);
  const actors = new Set(model.actors.map((actor) => actor.id));
  const controlled = new Set<string>();
  const diagnostics: ModelDiagnostic[] = [];
  for (const [index, identity] of scenario.controlledIdentities.entries()) {
    const path = `scenario.controlledIdentities.${index}.accountId`;
    if (controlled.has(identity.accountId)) {
      diagnostics.push({ path, message: `duplicate controlled identity ${identity.accountId}` });
    }
    if (!actors.has(identity.accountId) || !Object.hasOwn(initialState.balances, identity.accountId)) {
      diagnostics.push({ path, message: `controlled identity ${identity.accountId} requires an actor and initial balance` });
    }
    controlled.add(identity.accountId);
  }
  if (diagnostics.length) throw new StrategyValidationError(diagnostics);

  let currentState = initialState;
  let status: StrategyTrace["status"] = "completed";
  const steps: StrategyStep[] = [];
  for (const action of actions) {
    const beforeStateHash = hashEconomicState(currentState);
    const result = step(currentState, action, model);
    if (result.ok) currentState = result.state;
    steps.push({
      action, status: result.ok ? "accepted" : "rejected",
      beforeStateHash, afterStateHash: hashEconomicState(currentState),
      externalCostMicros: scenario.transactionCost.amountMicros,
      journal: result.journal, evaluations: result.evaluations,
      diagnostics: result.ok ? [] : result.diagnostics,
    });
    if (!result.ok) {
      status = "rejected";
      break;
    }
  }

  const initialBalance = coalitionBalance(initialState, scenario);
  const finalBalance = coalitionBalance(currentState, scenario);
  const identityCost = scenario.controlledIdentities.reduce((sum, identity) =>
    sum + BigInt(identity.identityCost.amountMicros), 0n);
  const transactionCost = BigInt(scenario.transactionCost.amountMicros) * BigInt(steps.length);
  return {
    schemaVersion: 1, engineVersion: STEP_ENGINE_VERSION,
    modelHash: hashEconomicModel(model), scenarioHash: hashCanonical(scenario),
    scenario, initialState, initialStateHash: hashEconomicState(initialState),
    actions, steps, finalState: currentState, finalStateHash: hashEconomicState(currentState),
    status,
    score: {
      initialBalanceMicros: initialBalance.toString(),
      finalBalanceMicros: finalBalance.toString(),
      ledgerDeltaMicros: (finalBalance - initialBalance).toString(),
      identityCostMicros: identityCost.toString(),
      transactionCostMicros: transactionCost.toString(),
      profitMicros: (finalBalance - initialBalance - identityCost - transactionCost).toString(),
    },
  };
}

// Only replay inputs are read from this envelope. Every supplied output field is
// untrusted and must match a fresh deterministic execution, including extra fields.
const ReplayEnvelopeSchema = z.strictObject({
  schemaVersion: z.literal(1),
  engineVersion: z.literal(STEP_ENGINE_VERSION),
  modelHash: z.string(),
  scenarioHash: z.unknown(),
  scenario: ScenarioSchema,
  initialState: z.unknown(),
  initialStateHash: z.unknown(),
  actions: z.array(z.unknown()),
  steps: z.unknown(),
  finalState: z.unknown(),
  finalStateHash: z.unknown(),
  status: z.unknown(),
  score: z.unknown(),
});
export type ReplayResult =
  | { ok: true; trace: StrategyTrace }
  | { ok: false; diagnostics: ModelDiagnostic[] };

export function replayStrategy(input: unknown, model: EconomicModel): ReplayResult {
  const envelope = ReplayEnvelopeSchema.safeParse(input);
  if (!envelope.success) return {
    ok: false,
    diagnostics: envelope.error.issues.map((issue) => ({
      path: `trace.${issue.path.join(".")}`, message: issue.message,
    })),
  };
  try {
    if (envelope.data.modelHash !== hashEconomicModel(model)) {
      return { ok: false, diagnostics: [{ path: "trace.modelHash", message: "model does not match the recorded model hash" }] };
    }
    const initialState = parseInput("initialState", parseEconomicState, envelope.data.initialState);
    const actions = parseActions(envelope.data.actions);
    const trace = runStrategy(initialState, actions, model, envelope.data.scenario);
    if (canonicalJson(input) !== canonicalJson(trace)) {
      return { ok: false, diagnostics: [{ path: "trace", message: "trace differs from deterministic replay of its actions and scenario" }] };
    }
    return { ok: true, trace };
  } catch (error) {
    if (error instanceof StrategyValidationError || error instanceof EconomicModelValidationError) {
      return { ok: false, diagnostics: error.diagnostics };
    }
    if (error instanceof TypeError || error instanceof RangeError) {
      return { ok: false, diagnostics: [{ path: "trace", message: "trace must be serializable JSON" }] };
    }
    throw error;
  }
}
