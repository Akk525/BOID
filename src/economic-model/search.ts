import { z } from "zod";
import { hashCanonical } from "./canonical.ts";
import { hashEconomicModel, hashEconomicState, parseEconomicModel, parseEconomicState } from "./model.ts";
import type { EconomicModel, EconomicState, PurchaseAction } from "./model.ts";
import { ExternalCostSchema, runStrategy, StrategyValidationError } from "./strategy.ts";
import type { StrategyScenario, StrategyTrace } from "./strategy.ts";
import { IdSchema, MicroUsdcSchema } from "./value-schema.ts";

export const SEARCH_ENGINE_VERSION = "purchase-search.v1";
const SearchConfigSchema = z.strictObject({
  id: IdSchema,
  identities: z.array(z.strictObject({ accountId: IdSchema, identityCost: ExternalCostSchema })).min(1).max(16),
  transactionCost: ExternalCostSchema,
  amounts: z.strictObject({
    minMicros: MicroUsdcSchema.refine((value) => BigInt(value) > 0n, "minimum must be positive"),
    maxMicros: MicroUsdcSchema,
    samplesMicros: z.array(MicroUsdcSchema).max(100),
  }),
  limits: z.strictObject({
    maxAccounts: z.number().int().min(1).max(16),
    maxDepth: z.number().int().min(1).max(32),
    maxNodes: z.number().int().min(1).max(1_000_000),
    maxPurchaseVolumeMicros: MicroUsdcSchema,
    maxFindings: z.number().int().min(1).max(1000),
  }),
});
export type SearchConfig = z.infer<typeof SearchConfigSchema>;
export type SearchFinding = {
  trace: StrategyTrace;
  traceHash: string;
  treasuryDrainMicros: string;
  purchaseVolumeMicros: string;
};
export type SearchResult = {
  schemaVersion: 1;
  engineVersion: typeof SEARCH_ENGINE_VERSION;
  modelHash: string;
  initialStateHash: string;
  searchHash: string;
  config: SearchConfig;
  findings: SearchFinding[];
  coverage: {
    amountsMicros: string[];
    visitedNodes: number;
    coalitionsEvaluated: number;
    attemptedActions: number;
    rejectedActions: number;
    dominatedStates: number;
    volumePrunedActions: number;
    positiveTraces: number;
    omittedFindings: number;
    truncated: boolean;
    stopReason: "exhausted" | "maxNodes";
    limitations: string[];
  };
};

function compareMoney(left: string, right: string): number {
  return BigInt(left) < BigInt(right) ? -1 : BigInt(left) > BigInt(right) ? 1 : 0;
}
function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

// Boundaries come from the typed predicates, never from a named attack pattern.
function candidateAmounts(model: EconomicModel, config: SearchConfig): string[] {
  const min = BigInt(config.amounts.minMicros);
  const max = BigInt(config.amounts.maxMicros);
  const amounts = new Set([min.toString(), max.toString(), ...config.amounts.samplesMicros]);
  type Predicate = NonNullable<EconomicModel["actions"]["purchase"]["transfers"][number]["when"]>;
  const visit = (predicate: Predicate): void => {
    if (predicate.op === "and") predicate.all.forEach(visit);
    else if (predicate.op === "gte") {
      const parameter = model.parameters[predicate.right.parameter];
      if (parameter?.kind === "money") {
        const boundary = BigInt(parameter.value);
        for (const value of [boundary - 1n, boundary, boundary + 1n]) amounts.add(value.toString());
      }
    }
  };
  for (const rule of model.actions.purchase.transfers) if (rule.when) visit(rule.when);
  return [...amounts].filter((value) => BigInt(value) >= min && BigInt(value) <= max).sort(compareMoney);
}

// Generate combinations lazily; coalition roots themselves consume node budget.
function* coalitions<T>(items: T[], maxSize: number, start = 0, prefix: T[] = []): Generator<T[]> {
  if (prefix.length) yield prefix;
  if (prefix.length === maxSize) return;
  for (let index = start; index < items.length; index++) {
    const item = items[index];
    if (item !== undefined) yield* coalitions(items, maxSize, index + 1, [...prefix, item]);
  }
}

function compareFindings(left: SearchFinding, right: SearchFinding): number {
  return compareMoney(right.trace.score.profitMicros, left.trace.score.profitMicros) ||
    compareMoney(right.treasuryDrainMicros, left.treasuryDrainMicros) ||
    compareMoney(left.purchaseVolumeMicros, right.purchaseVolumeMicros) ||
    left.trace.scenario.controlledIdentities.length - right.trace.scenario.controlledIdentities.length ||
    compareText(left.traceHash, right.traceHash);
}

/** Search finite control assignments and purchase sequences through the shared scorer. */
export function searchStrategies(
  inputState: EconomicState, inputModel: EconomicModel, inputConfig: SearchConfig,
): SearchResult {
  const model = parseEconomicModel(inputModel);
  const initialState = parseEconomicState(inputState);
  const parsed = SearchConfigSchema.safeParse(inputConfig);
  if (!parsed.success) throw new StrategyValidationError(parsed.error.issues.map((issue) => ({
    path: `search.${issue.path.join(".")}`, message: issue.message,
  })));
  const config = parsed.data;
  config.identities.sort((left, right) => compareText(left.accountId, right.accountId));
  config.amounts.samplesMicros = [...new Set(config.amounts.samplesMicros)].sort(compareMoney);
  const diagnostics = [];
  if (BigInt(config.amounts.minMicros) > BigInt(config.amounts.maxMicros)) {
    diagnostics.push({ path: "search.amounts", message: "minimum must not exceed maximum" });
  }
  for (const sample of config.amounts.samplesMicros) {
    if (BigInt(sample) < BigInt(config.amounts.minMicros) || BigInt(sample) > BigInt(config.amounts.maxMicros)) {
      diagnostics.push({ path: "search.amounts.samplesMicros", message: "samples must lie inside the amount range" });
    }
  }
  const seen = new Set<string>();
  for (const identity of config.identities) {
    const actor = model.actors.find((actor) => actor.id === identity.accountId);
    if (seen.has(identity.accountId) || !actor || !Object.hasOwn(initialState.balances, identity.accountId)) {
      diagnostics.push({ path: "search.identities", message: `identity ${identity.accountId} must be unique and have an actor and balance` });
    }
    // Product authorities cannot be acquired by the boid in this grammar.
    if (actor && (actor.roles.includes("platform") || actor.roles.includes("campaignTreasury"))) {
      diagnostics.push({ path: "search.identities", message: "platform and treasury identities cannot be control candidates" });
    }
    seen.add(identity.accountId);
  }
  if (!config.identities.some((identity) => model.actors.some((actor) =>
    actor.id === identity.accountId && actor.roles.includes("buyer")))) {
    diagnostics.push({ path: "search.identities", message: "at least one buyer control candidate is required" });
  }
  if (diagnostics.length) throw new StrategyValidationError(diagnostics);

  const amounts = candidateAmounts(model, config);
  const result: SearchResult = {
    schemaVersion: 1, engineVersion: SEARCH_ENGINE_VERSION,
    modelHash: hashEconomicModel(model), initialStateHash: hashEconomicState(initialState),
    searchHash: hashCanonical({ engineVersion: SEARCH_ENGINE_VERSION, model, initialState, config }),
    config, findings: [],
    coverage: {
      amountsMicros: amounts, visitedNodes: 0, coalitionsEvaluated: 0,
      attemptedActions: 0, rejectedActions: 0, dominatedStates: 0,
      volumePrunedActions: 0, positiveTraces: 0, omittedFindings: 0,
      truncated: false, stopReason: "exhausted",
      limitations: [
        "Coverage is limited to declared identities, their model roles, depth, account count and cumulative purchase volume.",
        "Fresh buyers are predeclared funded actors with zero completed purchases; identities are never minted or funded by search.",
        "Amounts include range endpoints, declared samples and predicate thresholds plus adjacent micro-units; unsampled amounts are not covered.",
        "Only coalition buyers initiate actions; creator and optional affiliate bindings include external and controlled actors.",
        "Acquisition costs apply to every controlled identity up front; transaction costs apply per attempt.",
        "No listing creation, arbitrary actions, authority takeover, or claims about real identity ownership are included.",
      ],
    },
  };
  const coverage = result.coverage;
  const consumeNode = (): boolean => {
    if (coverage.visitedNodes === config.limits.maxNodes) {
      coverage.truncated = true;
      coverage.stopReason = "maxNodes";
      return false;
    }
    coverage.visitedNodes++;
    return true;
  };
  const actorsFor = (role: "buyer" | "creator" | "affiliate") => model.actors
    .filter((actor) => actor.roles.includes(role)).map((actor) => actor.id).sort(compareText);
  const creators = actorsFor("creator");
  const affiliates: (string | undefined)[] = [undefined, ...actorsFor("affiliate")];
  const treasuries = actorsForTreasury(model);

  for (const identities of coalitions(config.identities, config.limits.maxAccounts)) {
    if (!consumeNode()) break;
    coverage.coalitionsEvaluated++;
    const scenario: StrategyScenario = {
      id: config.id, controlledIdentities: identities, transactionCost: config.transactionCost,
    };
    const controlled = new Set(identities.map((identity) => identity.accountId));
    const buyers = actorsFor("buyer").filter((id) => controlled.has(id));
    const root = runStrategy(initialState, [], model, scenario);
    // Same coalition and exact ledger/counters imply the same ledger gain and
    // acquisition cost. At a fixed tick, attempt costs are also equal. Keep the
    // lowest purchase volume, leaving at least as much remaining budget.
    const bestVolume = new Map<string, bigint>([[root.finalStateHash, 0n]]);
    const visit = (trace: StrategyTrace, volume: bigint): void => {
      if (trace.actions.length === config.limits.maxDepth || coverage.truncated) return;
      for (const buyer of buyers) for (const creator of creators) {
        if (buyer === creator) continue;
        for (const affiliate of affiliates) for (const amountMicros of amounts) {
          const nextVolume = volume + BigInt(amountMicros);
          if (nextVolume > BigInt(config.limits.maxPurchaseVolumeMicros)) {
            coverage.volumePrunedActions++;
            continue;
          }
          if (!consumeNode()) return;
          coverage.attemptedActions++;
          const action: PurchaseAction = {
            type: "purchase", buyer, creator, amountMicros,
            ...(affiliate === undefined ? {} : { affiliate }),
          };
          const next = runStrategy(initialState, [...trace.actions, action], model, scenario);
          if (next.status === "rejected") {
            coverage.rejectedActions++;
            continue;
          }
          const previousVolume = bestVolume.get(next.finalStateHash);
          if (previousVolume !== undefined && previousVolume <= nextVolume) {
            coverage.dominatedStates++;
            continue;
          }
          bestVolume.set(next.finalStateHash, nextVolume);
          if (BigInt(next.score.profitMicros) > 0n) {
            coverage.positiveTraces++;
            const drain = treasuries.reduce((sum, id) => sum +
              BigInt(initialState.balances[id] ?? "0") - BigInt(next.finalState.balances[id] ?? "0"), 0n);
            result.findings.push({
              trace: next, traceHash: hashCanonical(next),
              treasuryDrainMicros: drain.toString(), purchaseVolumeMicros: nextVolume.toString(),
            });
            result.findings.sort(compareFindings);
            if (result.findings.length > config.limits.maxFindings) result.findings.pop();
          }
          visit(next, nextVolume);
          if (coverage.truncated) return;
        }
      }
    };
    visit(root, 0n);
    if (coverage.truncated) break;
  }
  coverage.omittedFindings = coverage.positiveTraces - result.findings.length;
  return result;
}

function actorsForTreasury(model: EconomicModel): string[] {
  return model.actors.filter((actor) => actor.roles.includes("campaignTreasury")).map((actor) => actor.id);
}
