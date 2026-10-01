import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import test from "node:test";
import { canonicalJson, hashCanonical } from "./canonical.ts";
import { parseEconomicModel } from "./model.ts";
import type { EconomicModel, EconomicState, PurchaseAction } from "./model.ts";
import { searchStrategies } from "./search.ts";
import type { SearchConfig } from "./search.ts";
import { replayStrategy, runStrategy, StrategyValidationError } from "./strategy.ts";
import type { ExternalCost, StrategyTrace } from "./strategy.ts";

const model = () => parseEconomicModel(JSON.parse(readFileSync(
  "fixtures/creator-marketplace/economic-model.v1.json", "utf8",
)));
const state = (): EconomicState => ({
  balances: {
    "buyer-1": "40000000", "creator-1": "0", "affiliate-1": "0",
    platform: "0", campaignTreasury: "10000000",
  }, completedPurchases: {}, tick: 0,
});
const cost = (amountMicros: string): ExternalCost => ({
  amountMicros, evidence: {
    kind: "user_supplied", source: { type: "user" },
    notes: "Explicit fixture assumption; zero denotes an existing identity.",
  },
});
const config = (): SearchConfig => ({
  id: "fixture-search",
  identities: ["buyer-1", "creator-1", "affiliate-1"].map((accountId) => ({
    accountId, identityCost: cost(accountId === "buyer-1" ? "150000" : "0"),
  })),
  transactionCost: cost("10000"),
  amounts: { minMicros: "4999999", maxMicros: "5000001", samplesMicros: [] },
  limits: { maxAccounts: 3, maxDepth: 2, maxNodes: 10000, maxPurchaseVolumeMicros: "10000002", maxFindings: 10 },
});

// Independent exhaustive grammar on a tiny integer interval. No production
// candidate generator, state hash or dominance pruning is used by this oracle.
function enumerateUnpruned(
  initialState: EconomicState, m: EconomicModel, c: SearchConfig, explicitAmounts?: string[],
): { best: StrategyTrace | undefined; profitableStates: Map<string, string>; attemptedActions: number } {
  let best: StrategyTrace | undefined;
  const profitableStates = new Map<string, string>();
  let attemptedActions = 0;
  const amounts = explicitAmounts ?? [];
  if (!explicitAmounts) {
    for (let amount = BigInt(c.amounts.minMicros); amount <= BigInt(c.amounts.maxMicros); amount++) amounts.push(amount.toString());
  }
  for (let mask = 1; mask < 2 ** c.identities.length; mask++) {
    const identities = c.identities.filter((_, index) => mask & (1 << index))
      .sort((left, right) => left.accountId < right.accountId ? -1 : left.accountId > right.accountId ? 1 : 0);
    if (identities.length > c.limits.maxAccounts) continue;
    const controlled = new Set(identities.map((identity) => identity.accountId));
    const scenario = { id: c.id, controlledIdentities: identities, transactionCost: c.transactionCost };
    const enumerate = (actions: PurchaseAction[], volume: bigint): void => {
      if (actions.length === c.limits.maxDepth) return;
      for (const buyer of m.actors.filter((actor) => actor.roles.includes("buyer") && controlled.has(actor.id))) {
        for (const creator of m.actors.filter((actor) => actor.roles.includes("creator") && actor.id !== buyer.id)) {
          for (const affiliate of [undefined, ...m.actors.filter((actor) => actor.roles.includes("affiliate"))]) {
            for (const amountMicros of amounts) {
              const amount = BigInt(amountMicros);
              const nextVolume = volume + amount;
              if (nextVolume > BigInt(c.limits.maxPurchaseVolumeMicros)) continue;
              const nextActions: PurchaseAction[] = [...actions, {
                type: "purchase", buyer: buyer.id, creator: creator.id, amountMicros: amount.toString(),
                ...(affiliate === undefined ? {} : { affiliate: affiliate.id }),
              }];
              const trace = runStrategy(initialState, nextActions, m, scenario);
              attemptedActions++;
              if (trace.status !== "completed") continue;
              if (BigInt(trace.score.profitMicros) > 0n) {
                const key = canonicalJson({ scenario: trace.scenario, state: trace.finalState });
                const previous = profitableStates.get(key);
                if (previous === undefined || nextVolume < BigInt(previous)) profitableStates.set(key, nextVolume.toString());
              }
              if (BigInt(trace.score.profitMicros) > 0n &&
                (!best || BigInt(trace.score.profitMicros) > BigInt(best.score.profitMicros))) best = trace;
              enumerate(nextActions, nextVolume);
            }
          }
        }
      }
    };
    enumerate([], 0n);
  }
  return { best, profitableStates, attemptedActions };
}

function bruteForce(initialState: EconomicState, m: EconomicModel, c: SearchConfig): StrategyTrace | undefined {
  return enumerateUnpruned(initialState, m, c).best;
}

test("search discovers the threshold strategy, persists its trace, and repeats byte for byte", () => {
  const m = model();
  const s = state();
  const c = config();
  c.amounts = { minMicros: "1", maxMicros: "20000000", samplesMicros: ["20000000"] };
  c.limits.maxDepth = 1;
  c.limits.maxPurchaseVolumeMicros = "20000000";
  const inputs = canonicalJson({ m, s, c });
  const result = searchStrategies(s, m, c);
  const best = result.findings[0];
  assert.ok(best);
  assert.equal(best.trace.score.profitMicros, "340000");
  assert.deepEqual(best.trace.actions, [{
    type: "purchase", buyer: "buyer-1", creator: "creator-1", affiliate: "affiliate-1", amountMicros: "5000000",
  }]);
  assert.equal(best.treasuryDrainMicros, "1000000");
  assert.equal(best.traceHash, hashCanonical(best.trace));
  assert.deepEqual(result.coverage.amountsMicros, ["1", "4999999", "5000000", "5000001", "20000000"]);
  assert.equal(result.coverage.truncated, false);
  assert.ok(replayStrategy(JSON.parse(JSON.stringify(best.trace)), m).ok);
  assert.equal(canonicalJson(searchStrategies(s, m, c)), canonicalJson(result));
  assert.equal(canonicalJson({ m, s, c }), inputs);
});

test("tiny exhaustive oracle agrees across changed rules, costs, balances and control bounds", () => {
  for (const variant of ["baseline", "cheaper-fee", "higher-threshold", "high-cost", "treasury-empty", "reused-buyer", "two-accounts", "multi-role"]) {
    const m = model();
    const s = state();
    const c = config();
    if (variant === "cheaper-fee") {
      const parameter = m.parameters.platformFeeRate;
      assert.ok(parameter?.kind === "rate");
      parameter.value = "0.05";
    }
    if (variant === "higher-threshold") {
      const parameter = m.parameters.minimumEligiblePurchase;
      assert.ok(parameter?.kind === "money");
      parameter.value = "5000001";
    }
    if (variant === "high-cost") c.identities[0]!.identityCost = cost("500000");
    if (variant === "treasury-empty") s.balances.campaignTreasury = "0";
    if (variant === "reused-buyer") s.completedPurchases["buyer-1"] = 1;
    if (variant === "two-accounts") c.limits.maxAccounts = 2;
    if (variant === "multi-role") m.actors.find((actor) => actor.id === "creator-1")!.roles.push("affiliate");
    const expected = bruteForce(s, m, c);
    const actual = searchStrategies(s, m, c);
    assert.equal(actual.coverage.truncated, false, variant);
    assert.equal(actual.findings[0]?.trace.score.profitMicros, expected?.score.profitMicros, variant);
    if (actual.findings[0]) assert.deepEqual(actual.findings[0].trace.actions, expected?.actions, variant);
    for (const finding of actual.findings) assert.ok(replayStrategy(finding.trace, m).ok, variant);
  }
});

test("fresh and reused identities produce different sequences; equivalent states are pruned", () => {
  const m = model();
  m.actors.push({ id: "buyer-2", roles: ["buyer"] });
  const s = state();
  s.balances["buyer-2"] = "40000000";
  const c = config();
  c.identities.push({ accountId: "buyer-2", identityCost: cost("150000") });
  c.limits.maxAccounts = 4;
  c.amounts.minMicros = c.amounts.maxMicros = "5000000";
  const result = searchStrategies(s, m, c);
  assert.equal(result.findings[0]?.trace.score.profitMicros, "680000");
  assert.equal(result.findings[0]?.trace.actions.length, 2);
  assert.equal(new Set(result.findings[0]?.trace.actions.map((action) => action.buyer)).size, 2);
  assert.ok(result.coverage.dominatedStates > 0);
  assert.equal(result.findings[0]?.trace.score.profitMicros, bruteForce(s, m, c)?.score.profitMicros);
  s.completedPurchases["buyer-2"] = 1;
  assert.equal(searchStrategies(s, m, c).findings[0]?.trace.score.profitMicros, "340000");
});

test("node truncation is explicit, deterministic and includes coalition roots", () => {
  const m = model();
  const s = state();
  const c = config();
  const full = searchStrategies(s, m, c);
  assert.equal(full.coverage.visitedNodes, full.coverage.coalitionsEvaluated + full.coverage.attemptedActions);
  for (const maxNodes of [1, 5, full.coverage.visitedNodes - 1]) {
    c.limits.maxNodes = maxNodes;
    const result = searchStrategies(s, m, c);
    assert.equal(result.coverage.visitedNodes, maxNodes);
    assert.equal(result.coverage.truncated, true);
    assert.equal(result.coverage.stopReason, "maxNodes");
    assert.deepEqual(searchStrategies(s, m, c), result);
  }
  c.limits.maxNodes = full.coverage.visitedNodes;
  assert.equal(searchStrategies(s, m, c).coverage.truncated, false);
});

test("purchase volume, depth, account and retained-result limits are honored", () => {
  const m = model();
  const s = state();
  const c = config();
  c.limits.maxPurchaseVolumeMicros = "4999999";
  const low = searchStrategies(s, m, c);
  assert.equal(low.findings.length, 0);
  assert.ok(low.coverage.volumePrunedActions > 0);
  c.limits.maxPurchaseVolumeMicros = "5000001";
  c.limits.maxDepth = 1;
  c.limits.maxFindings = 1;
  const limited = searchStrategies(s, m, c);
  assert.equal(limited.findings.length, 1);
  assert.ok(limited.coverage.omittedFindings > 0);
  assert.equal(limited.findings[0]?.trace.actions.length, 1);
  c.limits.maxAccounts = 1;
  assert.equal(searchStrategies(s, m, c).findings.length, 0);
});

test("malformed budgets, missing cost evidence, invalid candidates and ranges fail closed", () => {
  for (const change of [
    (c: SearchConfig) => { c.limits.maxNodes = 0; },
    (c: SearchConfig) => { c.limits.maxDepth = 33; },
    (c: SearchConfig) => { c.amounts.maxMicros = "1"; },
    (c: SearchConfig) => { c.amounts.samplesMicros = ["1"]; },
    (c: SearchConfig) => { c.identities.push(c.identities[0]!); },
    (c: SearchConfig) => { c.identities[0]!.accountId = "unknown"; },
    (c: SearchConfig) => { c.identities[0]!.accountId = "campaignTreasury"; },
  ]) {
    const c = config();
    change(c);
    assert.throws(() => searchStrategies(state(), model(), c), StrategyValidationError);
  }
  const missing = JSON.parse(JSON.stringify(config()));
  delete missing.transactionCost.evidence;
  assert.throws(() => searchStrategies(state(), model(), missing), StrategyValidationError);
});

test("the checked-in search command emits a reproducible, replayable JSON artifact", () => {
  const args = ["src/economic-model/search-cli.ts", "fixtures/creator-marketplace/economic-model.v1.json",
    "fixtures/creator-marketplace/search-input.v1.json", "--raw"];
  const first = execFileSync(process.execPath, args, { encoding: "utf8" });
  assert.equal(execFileSync(process.execPath, args, { encoding: "utf8" }), first);
  const result = JSON.parse(first);
  assert.equal(result.findings[0].trace.score.profitMicros, "340000");
  assert.equal(result.findings[0].trace.actions[0].amountMicros, "5000000");
  assert.equal(result.coverage.truncated, false);
  assert.ok(replayStrategy(result.findings[0].trace, model()).ok);
  const missingArgs = spawnSync(process.execPath, [args[0]!], { encoding: "utf8" });
  assert.equal(missingArgs.status, 1);
  assert.match(missingArgs.stderr, /Usage:/);
  assert.equal(missingArgs.stdout, "");
});

test("mechanism mutation changes the optimum while replay and unpruned outcome coverage agree", () => {
  const baseline = model();
  const mutated = parseEconomicModel(JSON.parse(readFileSync(
    "fixtures/creator-marketplace/economic-model.recurring-reward.v1.json", "utf8",
  )));
  const input = JSON.parse(readFileSync("fixtures/creator-marketplace/search-input.v1.json", "utf8"));
  const s: EconomicState = input.initialState;
  const c: SearchConfig = input.config;
  // Keep every profitable representative so retention cannot mask a pruning gap.
  // Both mechanisms use the same config, including this reporting-only limit.
  c.limits.maxFindings = 1000;
  const independentlyDeclaredGrammar = ["1", "4999999", "5000000", "5000001", "20000000"];
  const baselineResult = searchStrategies(s, baseline, c);
  const mutatedResult = searchStrategies(s, mutated, c);
  const before = baselineResult.findings[0]?.trace;
  const after = mutatedResult.findings[0]?.trace;
  assert.ok(before && after);
  assert.equal(before.score.profitMicros, "340000");
  assert.deepEqual(before.actions.map((action) => action.amountMicros), ["5000000"]);
  assert.equal(after.score.profitMicros, "3830000");
  assert.deepEqual(after.actions.map((action) => action.amountMicros), ["20000000", "20000000"]);
  assert.equal(new Set(after.actions.map((action) => action.buyer)).size, 1);
  // Independent integer arithmetic checks both objectives, outside the runner.
  assert.equal(BigInt(before.score.profitMicros), 1_000_000n - 500_000n - 150_000n - 10_000n);
  assert.equal(BigInt(after.score.profitMicros), 2n * (4_000_000n - 2_000_000n) - 150_000n - 2n * 10_000n);
  assert.notEqual(before.modelHash, after.modelHash);
  assert.equal(before.initialStateHash, after.initialStateHash);
  assert.equal(before.scenarioHash, after.scenarioHash);
  assert.deepEqual(baselineResult.config, mutatedResult.config);
  assert.ok(replayStrategy(JSON.parse(JSON.stringify(before)), baseline).ok);
  assert.ok(replayStrategy(JSON.parse(JSON.stringify(after)), mutated).ok);
  assert.equal(replayStrategy(before, mutated).ok, false);
  assert.equal(replayStrategy(after, baseline).ok, false);

  for (const [m, result] of [[baseline, baselineResult], [mutated, mutatedResult]] as const) {
    const oracle = enumerateUnpruned(s, m, c, independentlyDeclaredGrammar);
    assert.deepEqual(result.coverage.amountsMicros, independentlyDeclaredGrammar);
    assert.equal(result.coverage.truncated, false);
    assert.equal(result.coverage.stopReason, "exhausted");
    assert.equal(result.coverage.omittedFindings, 0);
    assert.ok(result.coverage.dominatedStates > 0);
    assert.ok(result.coverage.attemptedActions < oracle.attemptedActions);
    assert.equal(result.findings[0]?.trace.score.profitMicros, oracle.best?.score.profitMicros);
    assert.deepEqual(result.findings[0]?.trace.actions, oracle.best?.actions);
    const actualStates = new Map<string, string>();
    for (const finding of result.findings) {
      const key = canonicalJson({ scenario: finding.trace.scenario, state: finding.trace.finalState });
      const previous = actualStates.get(key);
      if (previous === undefined || BigInt(finding.purchaseVolumeMicros) < BigInt(previous)) {
        actualStates.set(key, finding.purchaseVolumeMicros);
      }
    }
    // Compare every profitable final state and its minimum volume, not just the
    // winner. The oracle expands all permutations without dominance pruning.
    assert.deepEqual(actualStates, oracle.profitableStates);
    assert.equal(canonicalJson(searchStrategies(s, m, c)), canonicalJson(result));
  }
});
