import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseEconomicModel } from "./model.ts";
import type { EconomicState, PurchaseAction } from "./model.ts";
import { step } from "./step.ts";

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
const purchase = (amountMicros = "5000000"): PurchaseAction => ({
  type: "purchase", buyer: "buyer-1", creator: "creator-1",
  affiliate: "affiliate-1", amountMicros,
});
const total = (s: EconomicState) =>
  Object.values(s.balances).reduce((sum, value) => sum + BigInt(value), 0n);

test("first purchases match the hand-checked 5 and 20 USDC payout oracle", () => {
  for (const [amount, buyer, creator, platform] of [
    ["5000000", "35000000", "4500000", "500000"],
    ["20000000", "20000000", "18000000", "2000000"],
  ]) {
    assert.ok(amount && buyer && creator && platform);
    const before = state();
    const result = step(before, purchase(amount), model());
    assert.ok(result.ok);
    assert.deepEqual(result.state.balances, {
      "buyer-1": buyer, "creator-1": creator, "affiliate-1": "1000000",
      platform, campaignTreasury: "9000000",
    });
    assert.equal(result.state.completedPurchases["buyer-1"], 1);
    assert.equal(result.state.tick, 1);
    assert.deepEqual(before, state());
    assert.deepEqual(result.journal.map(({ ruleId, from, to, amountMicros }) =>
      ({ ruleId, from, to, amountMicros })), [
      { ruleId: "platformFee", from: "buyer-1", to: "platform", amountMicros: platform },
      { ruleId: "creatorPayout", from: "buyer-1", to: "creator-1", amountMicros: creator },
      { ruleId: "affiliateBonus", from: "campaignTreasury", to: "affiliate-1", amountMicros: "1000000" },
    ]);
  }
});

test("eligibility is evaluated against pre-purchase state at the exact threshold", () => {
  for (const [amount, bonus] of [
    ["4999999", "0"], ["5000000", "1000000"], ["5000001", "1000000"],
  ]) {
    const result = step(state(), purchase(amount), model());
    assert.ok(result.ok);
    assert.equal(result.state.balances["affiliate-1"], bonus);
    const evaluation = result.evaluations.find((item) => item.ruleId === "affiliateBonus");
    assert.equal(evaluation?.eligible, bonus !== "0");
    assert.ok(evaluation?.predicates.some((item) => item.op === "eq" && item.result));
  }
  const first = step(state(), purchase(), model());
  assert.ok(first.ok);
  const second = step(first.state, purchase(), model());
  assert.ok(second.ok);
  assert.equal(second.state.balances["affiliate-1"], "1000000");
  assert.equal(second.state.balances.campaignTreasury, "9000000");
  assert.equal(second.state.completedPurchases["buyer-1"], 2);
  assert.equal(second.evaluations.find((item) => item.ruleId === "affiliateBonus")?.eligible, false);
});

test("absent and same-account affiliates receive no bonus", () => {
  const withoutAffiliate: PurchaseAction = {
    type: "purchase", buyer: "buyer-1", creator: "creator-1", amountMicros: "5000000",
  };
  const absent = step(state(), withoutAffiliate, model());
  assert.ok(absent.ok);
  assert.equal(absent.state.balances.campaignTreasury, "10000000");
  const m = model();
  m.actors.find((actor) => actor.id === "buyer-1")?.roles.push("affiliate");
  const same = step(state(), { ...purchase(), affiliate: "buyer-1" }, m);
  assert.ok(same.ok);
  assert.equal(same.state.balances.campaignTreasury, "10000000");
  assert.equal(same.state.balances["buyer-1"], "35000000");
});

test("shares floor to micro-USDC and the creator receives every remainder unit", () => {
  const m = model();
  const rate = m.parameters.platformFeeRate;
  assert.ok(rate && rate.kind === "rate");
  rate.value = { numerator: "1", denominator: "3" };
  const result = step(state(), purchase("11"), m);
  assert.ok(result.ok);
  assert.equal(result.state.balances.platform, "3");
  assert.equal(result.state.balances["creator-1"], "8");
});

test("decimal rate arithmetic stays exact above the JavaScript safe integer range", () => {
  const before = state();
  before.balances["buyer-1"] = "90071992547409930";
  const result = step(before, purchase("90071992547409930"), model());
  assert.ok(result.ok);
  assert.equal(result.state.balances["buyer-1"], "0");
  assert.equal(result.state.balances.platform, "9007199254740993");
  assert.equal(result.state.balances["creator-1"], "81064793292668937");
  assert.equal(total(result.state), total(before));
});

test("insufficient buyer or treasury funds cannot commit a partial purchase", () => {
  for (const [account, funds] of [
    ["buyer-1", "4999999"], ["campaignTreasury", "999999"],
  ]) {
    assert.ok(account && funds);
    const before = state();
    before.balances[account] = funds;
    const unchanged = structuredClone(before);
    const result = step(before, purchase(), model());
    assert.equal(result.ok, false);
    if (result.ok) assert.fail("expected rejected purchase");
    assert.deepEqual(result.journal, []);
    assert.ok(result.diagnostics.some((item) => item.message.includes(account)));
    assert.deepEqual(before, unchanged);
  }
});

test("invalid roles, missing balances, and self-purchases fail with diagnostics", () => {
  for (const action of [
    { ...purchase(), buyer: "creator-1" },
    { ...purchase(), affiliate: "unknown" },
    { ...purchase(), creator: "affiliate-1" },
  ]) {
    const result = step(state(), action, model());
    assert.equal(result.ok, false);
    if (result.ok) assert.fail("expected invalid roles");
    assert.ok(result.diagnostics.some((item) => item.path.startsWith("purchase.")));
  }
  const missing = state();
  delete missing.balances.platform;
  assert.equal(step(missing, purchase(), model()).ok, false);
  const m = model();
  m.actors.find((actor) => actor.id === "buyer-1")?.roles.push("creator");
  assert.equal(step(state(), { ...purchase(), creator: "buyer-1" }, m).ok, false);
  m.actors.push({ id: "secondPlatform", roles: ["platform"] });
  assert.equal(step(state(), purchase(), m).ok, false);
});

test("invalid runtime inputs and exhausted counters fail without mutation", () => {
  const invalid = state();
  invalid.balances["buyer-1"] = "-1";
  assert.equal(step(invalid, purchase(), model()).ok, false);
  assert.equal(step(state(), purchase("0"), model()).ok, false);
  for (const before of [
    { ...state(), tick: Number.MAX_SAFE_INTEGER },
    { ...state(), completedPurchases: { "buyer-1": Number.MAX_SAFE_INTEGER } },
  ]) {
    const unchanged = structuredClone(before);
    assert.equal(step(before, purchase(), model()).ok, false);
    assert.deepEqual(before, unchanged);
  }
  const overflowing = state();
  overflowing.balances["creator-1"] = "999999999999999999999999999999";
  const unchanged = structuredClone(overflowing);
  const overflowResult = step(overflowing, purchase(), model());
  assert.equal(overflowResult.ok, false);
  assert.deepEqual(overflowResult.journal, []);
  assert.deepEqual(overflowing, unchanged);
});

test("an identity name cannot inherit a purchase count from Object.prototype", () => {
  const m = model();
  const buyer = m.actors.find((actor) => actor.id === "buyer-1");
  assert.ok(buyer);
  buyer.id = "constructor";
  const buyerId: string = buyer.id;
  const before = state();
  before.balances[buyerId] = before.balances["buyer-1"] ?? "0";
  delete before.balances["buyer-1"];
  const result = step(before, { ...purchase(), buyer: "constructor" }, m);
  assert.ok(result.ok);
  assert.equal(result.state.balances["affiliate-1"], "1000000");
  assert.equal(result.state.completedPurchases[buyerId], 1);
});

test("accepted actions conserve USDC and the journal reconstructs their balances", () => {
  const m = model();
  for (const amount of [...Array.from({ length: 120 }, (_, i) => BigInt(i + 1)),
    4_999_999n, 5_000_000n, 5_000_001n, 20_000_000n]) {
    const before = state();
    const result = step(before, purchase(amount.toString()), m);
    assert.ok(result.ok);
    assert.equal(total(result.state), total(before));
    const replay = Object.fromEntries(Object.entries(before.balances).map(([id, value]) =>
      [id, BigInt(value)]));
    for (const entry of result.journal) {
      assert.equal(entry.asset, "USDC");
      assert.ok(entry.evidence.length > 0);
      assert.ok(BigInt(entry.amountMicros) >= 0n);
      replay[entry.from] = (replay[entry.from] ?? 0n) - BigInt(entry.amountMicros);
      replay[entry.to] = (replay[entry.to] ?? 0n) + BigInt(entry.amountMicros);
    }
    assert.deepEqual(Object.fromEntries(Object.entries(replay).map(([id, value]) =>
      [id, value.toString()])), result.state.balances);
    assert.ok(Object.values(result.state.balances).every((value) => BigInt(value) >= 0n));
  }
});
