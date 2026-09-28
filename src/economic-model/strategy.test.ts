import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { hashEconomicState, parseEconomicModel } from "./model.ts";
import type { EconomicState, PurchaseAction } from "./model.ts";
import { replayStrategy, runStrategy, StrategyValidationError } from "./strategy.ts";
import type { ExternalCost, StrategyScenario } from "./strategy.ts";

const model = () => parseEconomicModel(JSON.parse(readFileSync(
  "fixtures/creator-marketplace/economic-model.v1.json", "utf8",
)));
const state = (): EconomicState => ({
  balances: {
    "buyer-1": "40000000", "creator-1": "0", "affiliate-1": "0",
    platform: "0", campaignTreasury: "10000000",
  },
  completedPurchases: {},
  tick: 0,
});
const action = (amountMicros = "5000000"): PurchaseAction => ({
  type: "purchase", buyer: "buyer-1", creator: "creator-1",
  affiliate: "affiliate-1", amountMicros,
});
const cost = (amountMicros: string, notes: string): ExternalCost => ({
  amountMicros,
  evidence: { kind: "user_supplied", source: { type: "user" }, notes },
});
const scenario = (
  accountIds = ["buyer-1", "creator-1", "affiliate-1"], identityCost = "150000",
): StrategyScenario => ({
  id: "fixture-coalition",
  controlledIdentities: accountIds.map((accountId) => ({
    accountId,
    identityCost: cost(accountId === "buyer-1" ? identityCost : "0",
      accountId === "buyer-1" ? "Assumed cost of acquiring a fresh buyer identity." : "Existing identity; no acquisition cost in this strategy."),
  })),
  transactionCost: cost("10000", "Assumed external cost per attempted purchase."),
});

test("the 5 and 20 USDC strategies match the independent coalition profit oracle", () => {
  for (const [amount, delta, finalBalance, profit] of [
    ["5000000", "500000", "40500000", "340000"],
    ["20000000", "-1000000", "39000000", "-1160000"],
  ]) {
    assert.ok(amount && delta && finalBalance && profit);
    const before = state();
    const trace = runStrategy(before, [action(amount)], model(), scenario());
    assert.equal(trace.status, "completed");
    assert.deepEqual(trace.score, {
      initialBalanceMicros: "40000000",
      finalBalanceMicros: finalBalance,
      ledgerDeltaMicros: delta,
      identityCostMicros: "150000",
      transactionCostMicros: "10000",
      profitMicros: profit,
    });
    assert.equal(trace.initialStateHash, hashEconomicState(before));
    assert.equal(trace.steps[0]?.beforeStateHash, trace.initialStateHash);
    assert.equal(trace.steps[0]?.afterStateHash, trace.finalStateHash);
    assert.equal(trace.steps[0]?.journal.length, 3);
    assert.ok(trace.steps[0]?.evaluations.some((rule) => rule.ruleId === "affiliateBonus" && rule.eligible));
    assert.deepEqual(before, state());
  }
});

test("JSON trace replay reproduces journals, state hashes, and score exactly", () => {
  const m = model();
  const trace = runStrategy(state(), [action(), action()], m, scenario());
  assert.equal(trace.score.profitMicros, "-170000");
  assert.equal(trace.steps[1]?.beforeStateHash, trace.steps[0]?.afterStateHash);
  const replay = replayStrategy(JSON.parse(JSON.stringify(trace)), m);
  assert.ok(replay.ok);
  assert.deepEqual(replay.trace, trace);
});

test("a single-role buyer is scored only on its explicitly controlled balance", () => {
  const trace = runStrategy(state(), [action()], model(), scenario(["buyer-1"]));
  assert.equal(trace.score.ledgerDeltaMicros, "-5000000");
  assert.equal(trace.score.profitMicros, "-5160000");
  assert.deepEqual(trace.scenario.controlledIdentities.map((identity) => identity.accountId), ["buyer-1"]);
});

test("a strategy cannot spend funds from a buyer outside its coalition", () => {
  for (const accountId of ["creator-1", "affiliate-1"]) {
    assert.throws(() => runStrategy(state(), [action()], model(), scenario([accountId])),
      (error: unknown) => error instanceof StrategyValidationError &&
        error.diagnostics.some((item) => item.path === "actions.0.buyer" &&
          item.message.includes("controlled by the coalition")));
  }
});

test("identity-cost sensitivity changes profit without changing the ledger or action trace", () => {
  const m = model();
  const low = runStrategy(state(), [action()], m, scenario());
  const high = runStrategy(state(), [action()], m, scenario(undefined, "500000"));
  assert.equal(low.score.profitMicros, "340000");
  assert.equal(high.score.profitMicros, "-10000");
  assert.deepEqual(low.steps, high.steps);
  assert.deepEqual(low.finalState, high.finalState);
  assert.equal(low.finalStateHash, high.finalStateHash);
  assert.notEqual(low.scenarioHash, high.scenarioHash);
});

test("one identity holding creator and affiliate roles is counted once", () => {
  const m = model();
  m.actors.find((actor) => actor.id === "creator-1")?.roles.push("affiliate");
  const trace = runStrategy(state(), [{ ...action(), affiliate: "creator-1" }],
    m, scenario(["buyer-1", "creator-1"]));
  assert.equal(trace.score.profitMicros, "340000");
  assert.equal(trace.finalState.balances["creator-1"], "5500000");
  assert.equal(trace.finalState.balances["affiliate-1"], "0");
});

test("a rejected action stops the strategy and still incurs its explicit attempt cost", () => {
  const m = model();
  const trace = runStrategy(state(), [action(), action("40000000"), action()], m, scenario());
  assert.equal(trace.status, "rejected");
  assert.equal(trace.actions.length, 3);
  assert.equal(trace.steps.length, 2);
  assert.equal(trace.steps[1]?.status, "rejected");
  assert.deepEqual(trace.steps[1]?.journal, []);
  assert.ok(trace.steps[1]?.diagnostics.length);
  assert.equal(trace.steps[1]?.beforeStateHash, trace.steps[1]?.afterStateHash);
  assert.equal(trace.finalState.tick, 1);
  assert.equal(trace.score.profitMicros, "330000");
  assert.equal(trace.score.transactionCostMicros, "20000");
  assert.ok(replayStrategy(trace, m).ok);
});

test("duplicate or unknown controlled identities and unsupported cost assumptions are rejected", () => {
  assert.throws(() => runStrategy(state(), [action()], model(), scenario(["buyer-1", "buyer-1"])), StrategyValidationError);
  assert.throws(() => runStrategy(state(), [action()], model(), scenario(["unknown"])), StrategyValidationError);
  const negative = scenario();
  negative.transactionCost.amountMicros = "-1";
  assert.throws(() => runStrategy(state(), [action()], model(), negative), StrategyValidationError);
  const missingEvidence = JSON.parse(JSON.stringify(scenario()));
  delete missingEvidence.controlledIdentities[0].identityCost.evidence;
  assert.throws(() => runStrategy(state(), [action()], model(), missingEvidence), StrategyValidationError);
  assert.throws(() => runStrategy(state(), JSON.parse("null"), model(), scenario()), StrategyValidationError);
});

test("replay rejects changed journals, scores, hashes, models, and extra trace fields", () => {
  const m = model();
  const trace = runStrategy(state(), [action()], m, scenario());
  for (const change of [
    (t: any) => { t.steps[0].journal[0].amountMicros = "1"; },
    (t: any) => { t.score.profitMicros = "999999"; },
    (t: any) => { t.steps[0].beforeStateHash = "0".repeat(64); },
    (t: any) => { t.scenario.transactionCost.amountMicros = "1"; },
    (t: any) => { t.extra = "not in the trace contract"; },
  ]) {
    const altered = JSON.parse(JSON.stringify(trace));
    change(altered);
    assert.equal(replayStrategy(altered, m).ok, false);
  }
  const changedModel = model();
  const fee = changedModel.parameters.platformFeeRate;
  assert.ok(fee && fee.kind === "rate");
  fee.value = "0.20";
  assert.equal(replayStrategy(trace, changedModel).ok, false);
});

test("state fingerprints are canonical and include counters as well as balances", () => {
  const before = state();
  const reordered = { ...before, balances: Object.fromEntries(Object.entries(before.balances).reverse()) };
  assert.equal(hashEconomicState(before), hashEconomicState(reordered));
  assert.notEqual(hashEconomicState(before), hashEconomicState({ ...before, tick: 1 }));
});
