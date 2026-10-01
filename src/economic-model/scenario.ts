import { z } from "zod";
import { hashCanonical } from "./canonical.ts";
import { hashEconomicModel, hashEconomicState, parseEconomicModel, parseEconomicState } from "./model.ts";
import type { EconomicModel, EconomicState, ModelDiagnostic, PurchaseAction } from "./model.ts";
import { step, STEP_ENGINE_VERSION } from "./step.ts";
import type { JournalEntry, RuleEvaluation } from "./step.ts";
import { ExternalCostSchema } from "./strategy.ts";
import { IdSchema, MicroUsdcSchema } from "./value-schema.ts";

export const SCENARIO_ENGINE_VERSION = "population-scenario.v1";
const PositiveMoney = MicroUsdcSchema.refine((value) => BigInt(value) > 0n, "amount must be positive");
const ScenarioSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: IdSchema,
  seed: z.number().int().min(1).max(0xffff_ffff),
  horizonTicks: z.number().int().min(1).max(10_000),
  arrivalBps: z.number().int().min(0).max(10_000),
  attackerArrivalBps: z.number().int().min(0).max(10_000),
  honest: z.strictObject({
    buyers: z.array(IdSchema).min(1).max(100),
    creator: IdSchema,
    affiliate: IdSchema.optional(),
    orderAmountsMicros: z.array(PositiveMoney).min(1).max(100),
  }),
  attacker: z.strictObject({
    buyers: z.array(z.strictObject({ accountId: IdSchema, identityCost: ExternalCostSchema })).min(1).max(100),
    creator: IdSchema,
    affiliate: IdSchema,
    orderAmountMicros: PositiveMoney,
    maxAttempts: z.number().int().min(0).max(10_000),
    transactionCost: ExternalCostSchema,
  }).nullable(),
  assumptions: z.array(z.string().min(1)).min(1).max(20),
});

export type PopulationScenario = z.infer<typeof ScenarioSchema>;
export type ScenarioEvent =
  | { tick: number; kind: "idle"; reason: "noArrival" | "attackerPolicyExhausted" }
  | {
      tick: number; kind: "purchase"; policy: "honest" | "attacker";
      action: PurchaseAction; status: "accepted" | "rejected";
      beforeStateHash: string; afterStateHash: string;
      journal: JournalEntry[]; evaluations: RuleEvaluation[]; diagnostics: ModelDiagnostic[];
    };
export type ScenarioMetrics = {
  attemptedActions: number;
  acceptedActions: number;
  failedActions: number;
  honestAccepted: number;
  attackerAccepted: number;
  attackerAttempts: number;
  platformRevenueMicros: string;
  creatorEarningsMicros: string;
  affiliatePayoutMicros: string;
  initialTreasuryMicros: string;
  finalTreasuryMicros: string;
  treasurySpentMicros: string;
  treasuryBlockedActions: number;
  attackerTreasuryExtractionMicros: string;
  attackerLedgerDeltaMicros: string;
  attackerIdentityCostMicros: string;
  attackerTransactionCostMicros: string;
  attackerProfitMicros: string;
};
type ScenarioCore = {
  schemaVersion: 1;
  engineVersion: typeof SCENARIO_ENGINE_VERSION;
  stepEngineVersion: typeof STEP_ENGINE_VERSION;
  modelHash: string;
  scenarioHash: string;
  initialStateHash: string;
  finalStateHash: string;
  scenario: PopulationScenario;
  initialState: EconomicState;
  finalState: EconomicState;
  events: ScenarioEvent[];
  journalHash: string;
  metrics: ScenarioMetrics;
  limitation: string;
};
export type ScenarioResult = ScenarioCore & { runHash: string };

export class ScenarioValidationError extends Error {
  readonly diagnostics: ModelDiagnostic[];
  constructor(diagnostics: ModelDiagnostic[]) {
    super(diagnostics.map((item) => `${item.path}: ${item.message}`).join("; "));
    this.name = "ScenarioValidationError";
    this.diagnostics = diagnostics;
  }
}

function parseScenario(input: unknown): PopulationScenario {
  const parsed = ScenarioSchema.safeParse(input);
  if (!parsed.success) throw new ScenarioValidationError(parsed.error.issues.map((issue) => ({
    path: `scenario.${issue.path.join(".")}`, message: issue.message,
  })));
  return parsed.data;
}

function validatePopulation(model: EconomicModel, state: EconomicState, scenario: PopulationScenario): void {
  const diagnostics: ModelDiagnostic[] = [];
  const actors = new Map(model.actors.map((actor) => [actor.id, actor]));
  const requireRole = (id: string, role: "buyer" | "creator" | "affiliate", path: string) => {
    if (!actors.get(id)?.roles.includes(role)) diagnostics.push({ path, message: `${id} must be a model ${role}` });
    if (!Object.hasOwn(state.balances, id)) diagnostics.push({ path, message: `${id} must have an initial balance` });
  };
  const honest = scenario.honest;
  honest.buyers.forEach((id, index) => requireRole(id, "buyer", `scenario.honest.buyers.${index}`));
  requireRole(honest.creator, "creator", "scenario.honest.creator");
  if (honest.affiliate) requireRole(honest.affiliate, "affiliate", "scenario.honest.affiliate");
  const honestIds = [honest.creator, ...honest.buyers, ...(honest.affiliate ? [honest.affiliate] : [])];
  if (new Set(honestIds).size !== honestIds.length) {
    diagnostics.push({ path: "scenario.honest", message: "honest buyer, creator, and affiliate accounts must be distinct" });
  }
  if (scenario.attacker) {
    scenario.attacker.buyers.forEach((item, index) =>
      requireRole(item.accountId, "buyer", `scenario.attacker.buyers.${index}.accountId`));
    requireRole(scenario.attacker.creator, "creator", "scenario.attacker.creator");
    requireRole(scenario.attacker.affiliate, "affiliate", "scenario.attacker.affiliate");
    const attackerIds = scenario.attacker.buyers.map((item) => item.accountId);
    if (new Set(attackerIds).size !== attackerIds.length) {
      diagnostics.push({ path: "scenario.attacker.buyers", message: "attacker buyer identities must be unique" });
    }
    if (attackerIds.includes(scenario.attacker.creator) ||
      attackerIds.includes(scenario.attacker.affiliate) ||
      scenario.attacker.creator === scenario.attacker.affiliate) {
      diagnostics.push({ path: "scenario.attacker", message: "attacker buyer, creator, and affiliate accounts must be distinct" });
    }
    if ([...attackerIds, scenario.attacker.creator, scenario.attacker.affiliate]
      .some((id) => honestIds.includes(id))) {
      diagnostics.push({ path: "scenario", message: "honest and attacker populations must use disjoint accounts" });
    }
  } else if (scenario.attackerArrivalBps !== 0) {
    diagnostics.push({ path: "scenario.attackerArrivalBps", message: "must be zero without an attacker population" });
  }
  if (diagnostics.length) throw new ScenarioValidationError(diagnostics);
}

function generator(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    return value >>> 0;
  };
}

function sumControlled(state: EconomicState, ids: Set<string>): bigint {
  return [...ids].reduce((sum, id) => sum + BigInt(state.balances[id] ?? "0"), 0n);
}

/** Seeded policies select actions; every ledger change comes from the shared step. */
export function runPopulationScenario(
  inputState: EconomicState, inputModel: EconomicModel, inputScenario: PopulationScenario,
): ScenarioResult {
  const model = parseEconomicModel(inputModel);
  const initialState = parseEconomicState(inputState);
  const scenario = parseScenario(inputScenario);
  validatePopulation(model, initialState, scenario);
  const nextRandom = generator(scenario.seed);
  const attacker = scenario.attacker;
  const controlled = new Set(attacker ? [attacker.creator, attacker.affiliate,
    ...attacker.buyers.map((item) => item.accountId)] : []);
  const activated = new Set<string>();
  const events: ScenarioEvent[] = [];
  let state = initialState;
  let attackerAttempts = 0;
  for (let tick = 1; tick <= scenario.horizonTicks; tick++) {
    // Draw four values on every tick, even when a policy skips, so paired runs
    // consume the same exogenous stream when attacker share or costs change.
    const arrivalRoll = nextRandom() % 10_000;
    const policyRoll = nextRandom() % 10_000;
    const buyerRoll = nextRandom();
    const amountRoll = nextRandom();
    if (arrivalRoll >= scenario.arrivalBps) {
      events.push({ tick, kind: "idle", reason: "noArrival" });
      continue;
    }
    const chooseAttacker = attacker !== null && policyRoll < scenario.attackerArrivalBps;
    let action: PurchaseAction;
    let policy: "honest" | "attacker";
    if (chooseAttacker) {
      if (attackerAttempts === attacker.maxAttempts) {
        events.push({ tick, kind: "idle", reason: "attackerPolicyExhausted" });
        continue;
      }
      const fresh = attacker.buyers.find((item) => (state.completedPurchases[item.accountId] ?? 0) === 0);
      if (!fresh) {
        events.push({ tick, kind: "idle", reason: "attackerPolicyExhausted" });
        continue;
      }
      activated.add(fresh.accountId);
      attackerAttempts++;
      policy = "attacker";
      action = { type: "purchase", buyer: fresh.accountId, creator: attacker.creator,
        affiliate: attacker.affiliate, amountMicros: attacker.orderAmountMicros };
    } else {
      policy = "honest";
      action = {
        type: "purchase",
        buyer: scenario.honest.buyers[buyerRoll % scenario.honest.buyers.length]!,
        creator: scenario.honest.creator,
        ...(scenario.honest.affiliate ? { affiliate: scenario.honest.affiliate } : {}),
        amountMicros: scenario.honest.orderAmountsMicros[amountRoll % scenario.honest.orderAmountsMicros.length]!,
      };
    }
    const beforeStateHash = hashEconomicState(state);
    const result = step(state, action, model);
    if (result.ok) state = result.state;
    events.push({
      tick, kind: "purchase", policy, action,
      status: result.ok ? "accepted" : "rejected", beforeStateHash,
      afterStateHash: hashEconomicState(state), journal: result.journal,
      evaluations: result.evaluations, diagnostics: result.ok ? [] : result.diagnostics,
    });
  }

  const journals = events.flatMap((event) => event.kind === "purchase" ? event.journal : []);
  const roleIds = (role: "buyer" | "platform" | "creator" | "affiliate" | "campaignTreasury") =>
    new Set(model.actors.filter((actor) => actor.roles.includes(role)).map((actor) => actor.id));
  const buyers = roleIds("buyer");
  const platforms = roleIds("platform");
  const creators = roleIds("creator");
  const affiliates = roleIds("affiliate");
  const treasuries = roleIds("campaignTreasury");
  const treasury = [...treasuries][0]!;
  const sumJournal = (predicate: (entry: JournalEntry) => boolean) =>
    journals.reduce((sum, entry) => sum + (predicate(entry) ? BigInt(entry.amountMicros) : 0n), 0n);
  const purchases = events.filter((event): event is Extract<ScenarioEvent, { kind: "purchase" }> => event.kind === "purchase");
  const initialTreasury = BigInt(initialState.balances[treasury] ?? "0");
  const finalTreasury = BigInt(state.balances[treasury] ?? "0");
  const identityCost = attacker?.buyers.reduce((sum, item) =>
    sum + (activated.has(item.accountId) ? BigInt(item.identityCost.amountMicros) : 0n), 0n) ?? 0n;
  const transactionCost = attacker ? BigInt(attacker.transactionCost.amountMicros) * BigInt(attackerAttempts) : 0n;
  const attackerLedgerDelta = sumControlled(state, controlled) - sumControlled(initialState, controlled);
  const attackerExtraction = purchases.reduce((sum, event) => sum +
    (event.policy === "attacker" ? event.journal.reduce((inner, entry) => inner +
      (treasuries.has(entry.from) && controlled.has(entry.to) ? BigInt(entry.amountMicros) : 0n), 0n) : 0n), 0n);
  const metrics: ScenarioMetrics = {
    attemptedActions: purchases.length,
    acceptedActions: purchases.filter((event) => event.status === "accepted").length,
    failedActions: purchases.filter((event) => event.status === "rejected").length,
    honestAccepted: purchases.filter((event) => event.policy === "honest" && event.status === "accepted").length,
    attackerAccepted: purchases.filter((event) => event.policy === "attacker" && event.status === "accepted").length,
    attackerAttempts,
    platformRevenueMicros: sumJournal((entry) => buyers.has(entry.from) && platforms.has(entry.to)).toString(),
    creatorEarningsMicros: sumJournal((entry) => buyers.has(entry.from) && creators.has(entry.to)).toString(),
    affiliatePayoutMicros: sumJournal((entry) => affiliates.has(entry.to) && treasuries.has(entry.from)).toString(),
    initialTreasuryMicros: initialTreasury.toString(),
    finalTreasuryMicros: finalTreasury.toString(),
    treasurySpentMicros: (initialTreasury - finalTreasury).toString(),
    treasuryBlockedActions: purchases.filter((event) => event.status === "rejected" &&
      event.diagnostics.some((item) => item.message.includes(`insufficient funds in ${treasury}`))).length,
    attackerTreasuryExtractionMicros: attackerExtraction.toString(),
    attackerLedgerDeltaMicros: attackerLedgerDelta.toString(),
    attackerIdentityCostMicros: identityCost.toString(),
    attackerTransactionCostMicros: transactionCost.toString(),
    attackerProfitMicros: (attackerLedgerDelta - identityCost - transactionCost).toString(),
  };

  // Reconcile every account against the journal before reporting aggregates.
  const deltas = new Map<string, bigint>();
  for (const entry of journals) {
    const amount = BigInt(entry.amountMicros);
    deltas.set(entry.from, (deltas.get(entry.from) ?? 0n) - amount);
    deltas.set(entry.to, (deltas.get(entry.to) ?? 0n) + amount);
  }
  for (const id of Object.keys(initialState.balances)) {
    if (BigInt(state.balances[id] ?? "0") - BigInt(initialState.balances[id] ?? "0") !== (deltas.get(id) ?? 0n)) {
      throw new Error(`Scenario journal does not reconcile account ${id}`);
    }
  }
  if (BigInt(metrics.treasurySpentMicros) !== sumJournal((entry) => treasuries.has(entry.from)) -
    sumJournal((entry) => treasuries.has(entry.to))) {
    throw new Error("Scenario treasury metric does not reconcile with journal");
  }
  const core: ScenarioCore = {
    schemaVersion: 1, engineVersion: SCENARIO_ENGINE_VERSION,
    stepEngineVersion: STEP_ENGINE_VERSION,
    modelHash: hashEconomicModel(model), scenarioHash: hashCanonical({ initialState, scenario }),
    initialStateHash: hashEconomicState(initialState), finalStateHash: hashEconomicState(state),
    scenario, initialState, finalState: state, events,
    journalHash: hashCanonical(purchases.map((event) => ({ tick: event.tick, journal: event.journal }))),
    metrics,
    limitation: "This seeded run is conditional on declared population, arrival and order distributions, identity costs, and mechanism. It is not a forecast.",
  };
  return { ...core, runHash: hashCanonical(core) };
}
