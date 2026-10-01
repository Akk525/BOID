import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { canonicalJson, hashCanonical } from "./canonical.ts";
import { compareMechanisms } from "./compare.ts";
import { EconomicModelValidationError, parseEconomicModel } from "./model.ts";
import type { EconomicModel } from "./model.ts";
import { searchStrategies } from "./search.ts";
import { step } from "./step.ts";

const root = "fixtures/creator-marketplace";
const readJson = (path: string) => JSON.parse(readFileSync(`${root}/${path}`, "utf8"));
const baseline = (): EconomicModel => parseEconomicModel(readJson("economic-model.v1.json"));
const repair = (): EconomicModel => parseEconomicModel(readJson("economic-model.fee-funded.v1.json"));
const input = () => readJson("search-input.v1.json");
const referencePurchase = () => readJson("reference-purchase.v1.json");

function amountAt(model: EconomicModel, micros: string, priorPurchases = 0) {
  const state = input().initialState;
  state.completedPurchases["buyer-1"] = priorPurchases;
  return step(state, {
    type: "purchase", buyer: "buyer-1", creator: "creator-1",
    affiliate: "affiliate-1", amountMicros: micros,
  }, model);
}

test("the fee basis is the collected platform fee at threshold boundaries and normal orders", () => {
  for (const [amount, before, after, platformFee, creatorPayout] of [
    ["4999999", undefined, undefined, "499999", "4500000"],
    ["5000000", "1000000", "200000", "500000", "4500000"],
    ["5000001", "1000000", "200000", "500000", "4500001"],
    ["5000025", "1000000", "200000", "500002", "4500023"],
    ["20000000", "1000000", "800000", "2000000", "18000000"],
  ] as const) {
    const old = amountAt(baseline(), amount);
    const fixed = amountAt(repair(), amount);
    assert.equal(old.ok, true);
    assert.equal(fixed.ok, true);
    if (!old.ok || !fixed.ok) continue;
    assert.equal(old.journal.find((entry) => entry.ruleId === "affiliateBonus")?.amountMicros, before);
    assert.equal(fixed.journal.find((entry) => entry.ruleId === "affiliateBonus")?.amountMicros, after);
    assert.equal(old.journal[0]?.amountMicros, platformFee);
    assert.equal(fixed.journal[0]?.amountMicros, platformFee);
    assert.equal(old.journal[1]?.amountMicros, creatorPayout);
    assert.equal(fixed.journal[1]?.amountMicros, creatorPayout);
  }
  const reused = amountAt(repair(), "20000000", 1);
  assert.equal(reused.ok, true);
  if (reused.ok) assert.equal(reused.journal.some((entry) => entry.ruleId === "affiliateBonus"), false);
  const changedFee = repair();
  const feeRate = changedFee.parameters.platformFeeRate;
  assert.ok(feeRate?.kind === "rate");
  feeRate.value = "0.05";
  const changed = amountAt(changedFee, "5000000");
  assert.equal(changed.ok, true);
  if (changed.ok) assert.equal(changed.journal.find((entry) => entry.ruleId === "affiliateBonus")?.amountMicros, "100000");
});

test("invalid fee references fail model validation", () => {
  for (const edit of [
    (model: EconomicModel) => { const rule = model.actions.purchase.transfers[2]!; if (rule.amount.op === "share") rule.amount.basis = { rule: "missing" }; },
    (model: EconomicModel) => { const rule = model.actions.purchase.transfers[2]!; if (rule.amount.op === "share") rule.amount.basis = { rule: "creatorPayout" }; },
    (model: EconomicModel) => { const rule = model.actions.purchase.transfers[0]!; if (rule.amount.op === "share") rule.amount.basis = { rule: "affiliateBonus" }; },
  ]) {
    const model = repair();
    edit(model);
    assert.throws(() => parseEconomicModel(model), EconomicModelValidationError);
  }
});

test("comparison links both model and run hashes, shows the repair trade-off, and is byte stable", () => {
  const data = input();
  const result = compareMechanisms(data.initialState, baseline(), repair(), data.config, referencePurchase());
  assert.equal(result.identicalBudget, true);
  assert.notEqual(result.baseline.modelHash, result.repair.modelHash);
  assert.equal(result.baseline.initialStateHash, result.repair.initialStateHash);
  assert.equal(result.witness?.baselineProfitMicros, "340000");
  assert.equal(result.witness?.repairProfitMicros, "-460000");
  assert.equal(result.referencePurchase.baselineAffiliateAwardMicros, "1000000");
  assert.equal(result.referencePurchase.repairAffiliateAwardMicros, "800000");
  assert.equal(result.noPositiveRepairWithinBudget, true);
  assert.equal(result.repair.coverage.truncated, false);
  assert.equal(result.repair.coverage.stopReason, "exhausted");
  const { comparisonHash, ...core } = result;
  assert.equal(comparisonHash, hashCanonical(core));
  assert.equal(canonicalJson(compareMechanisms(data.initialState, baseline(), repair(), data.config, referencePurchase())), canonicalJson(result));
  const args = ["src/economic-model/compare-cli.ts", `${root}/economic-model.v1.json`,
    `${root}/economic-model.fee-funded.v1.json`, `${root}/search-input.v1.json`, `${root}/reference-purchase.v1.json`, "--json"];
  const output = execFileSync(process.execPath, args, { encoding: "utf8" });
  assert.equal(output, canonicalJson(result));
  assert.equal(execFileSync(process.execPath, args, { encoding: "utf8" }), output);
});

test("search detects a deliberately reintroduced treasury reward", () => {
  const leaky = repair();
  const original = leaky.actions.purchase.transfers[2]!;
  assert.ok(original.when);
  leaky.actions.purchase.transfers.push({
    id: "supplementalBonus", from: "campaignTreasury", to: "affiliate",
    amount: { op: "fixed", parameter: "affiliateBonus" },
    when: original.when,
    evidence: ["affiliateBonusSource"],
  });
  const data = input();
  const result = searchStrategies(data.initialState, leaky, data.config);
  assert.equal(result.coverage.truncated, false);
  assert.equal(result.findings[0]?.trace.actions[0]?.amountMicros, "5000000");
  assert.equal(result.findings[0]?.trace.score.profitMicros, "540000");
});
