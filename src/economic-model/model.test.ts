import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  EconomicModelValidationError,
  hashEconomicModel,
  parseEconomicModel,
  parseEconomicState,
  parsePurchaseAction,
  serializeEconomicModel,
} from "./model.ts";

const fixturePath = join(process.cwd(), "fixtures/creator-marketplace/economic-model.v1.json");
const fixture = () => JSON.parse(readFileSync(fixturePath, "utf8"));

function expectInvalid(change: (draft: any) => void, text: RegExp) {
  const draft = fixture();
  change(draft);
  assert.throws(
    () => parseEconomicModel(draft),
    (error) => error instanceof EconomicModelValidationError &&
      error.diagnostics.some((item) => text.test(`${item.path}: ${item.message}`)),
  );
}

test("the fixture model loads with traceable rules and a stable source manifest", () => {
  const model = parseEconomicModel(fixture());
  assert.equal(model.schemaVersion, 1);
  assert.equal(model.source.commit, "5ee0fd0f87d1e1467af924990ed024c581915b04");
  assert.deepEqual(model.assets, [{ id: "USDC", decimals: 6 }]);
  assert.deepEqual(model.actions.purchase.transfers.map((rule) => rule.id), [
    "platformFee", "creatorPayout", "affiliateBonus",
  ]);

  for (const file of model.source.files) {
    const content = readFileSync(join(process.cwd(), file.path));
    assert.equal(createHash("sha256").update(content).digest("hex"), file.sha256);
    const pinnedContent: Buffer = execFileSync("git", ["show", `${model.source.commit}:${file.path}`]);
    assert.equal(createHash("sha256").update(pinnedContent).digest("hex"), file.sha256);
  }
});

test("canonical serialization round-trips and ignores JSON object key order", () => {
  const model = parseEconomicModel(fixture());
  const serialized = serializeEconomicModel(model);
  assert.deepEqual(parseEconomicModel(JSON.parse(serialized)), model);
  assert.equal(hashEconomicModel(model), createHash("sha256").update(serialized).digest("hex"));

  const reordered = fixture();
  reordered.parameters = Object.fromEntries(Object.entries(reordered.parameters).reverse());
  reordered.evidence = Object.fromEntries(Object.entries(reordered.evidence).reverse());
  assert.equal(hashEconomicModel(parseEconomicModel(reordered)), hashEconomicModel(model));
});

test("schema rejects unsupported versions, operators, rates, and malformed money", () => {
  expectInvalid((m) => { m.schemaVersion = 2; }, /schemaVersion/);
  expectInvalid((m) => { m.actions.purchase.transfers[0].amount.op = "eval"; }, /amount/);
  expectInvalid((m) => { m.parameters.platformFeeRate.value = "-0.10"; }, /parameters\.platformFeeRate/);
  expectInvalid((m) => {
    m.parameters.platformFeeRate.value = { numerator: "1", denominator: "0" };
  }, /parameters\.platformFeeRate/);
  expectInvalid((m) => { m.parameters.affiliateBonus.value = "1.5"; }, /parameters\.affiliateBonus/);
  expectInvalid((m) => { m.parameters.affiliateBonus.value = "-1"; }, /parameters\.affiliateBonus/);
  expectInvalid((m) => {
    m.parameters.platformFeeRate.value = { numerator: "2", denominator: "1" };
  }, /parameters\.platformFeeRate/);
  expectInvalid((m) => { m.actions.purchase.transfers[0].arbitraryCode = "return 999"; }, /transfers\.0/);
});

test("semantic validation rejects missing evidence, parameters, and duplicate IDs", () => {
  expectInvalid((m) => { m.parameters.affiliateBonus.evidence = "does-not-exist"; }, /affiliateBonus.*evidence/);
  expectInvalid((m) => { m.actions.purchase.transfers[2].amount.parameter = "does-not-exist"; }, /transfers\.2.*parameter/);
  expectInvalid((m) => { m.actions.purchase.transfers[2].amount.parameter = "constructor"; }, /unknown parameter constructor/);
  expectInvalid((m) => { m.actions.purchase.transfers[1].id = "platformFee"; }, /duplicate.*platformFee/i);
  expectInvalid((m) => { m.actors[1].id = m.actors[0].id; }, /duplicate.*actor/i);
  expectInvalid((m) => { m.actions.purchase.transfers[0].amount.rate.parameter = "affiliateBonus"; }, /requires.*rate/i);
  expectInvalid((m) => { m.constraints.buyerCreatorDifferent.evidence = "missing"; }, /buyerCreatorDifferent.*evidence/);
  expectInvalid((m) => { m.evidence.platformFeeSource.kind = "unknown_knowable"; }, /platformFeeRate.*point value/);
  expectInvalid((m) => { m.evidence.platformFeeSource.source = { type: "user" }; }, /known evidence.*direct/);
  expectInvalid((m) => {
    const bonus = m.actions.purchase.transfers.pop();
    m.actions.purchase.transfers.splice(1, 0, bonus);
    m.actions.purchase.transfers[2].amount.minusRule = "affiliateBonus";
  }, /remainder must subtract an unconditional buyer-to-platform purchase share/);
});

test("multiple actor identities may share the buyer role", () => {
  const draft = fixture();
  draft.actors.push({ id: "buyer-2", roles: ["buyer"] });
  assert.equal(parseEconomicModel(draft).actors.length, 6);
  expectInvalid((m) => { m.actors[0].roles.push("buyer"); }, /duplicate.*role/i);
});

test("a rational rate is accepted without conversion to a floating point value", () => {
  const draft = fixture();
  draft.parameters.platformFeeRate.value = { numerator: "1", denominator: "10" };
  const model = parseEconomicModel(draft);
  assert.deepEqual(model.parameters.platformFeeRate?.value, { numerator: "1", denominator: "10" });
});

test("repository evidence requires pinned, bounded source spans", () => {
  expectInvalid((m) => { delete m.evidence.platformFeeSource.source.startLine; }, /startLine/);
  expectInvalid((m) => { m.evidence.platformFeeSource.source.path = "../secret"; }, /path/);
  expectInvalid((m) => { m.evidence.platformFeeSource.source.path = "src/other.mjs"; }, /source.*files|manifest/i);
});

test("state and purchase inputs use integer micro-USDC and typed identities", () => {
  assert.deepEqual(parseEconomicState({
    balances: { "buyer-1": "40000000", campaignTreasury: "10000000" },
    completedPurchases: { "buyer-1": 0 },
    tick: 0,
  }).balances, { "buyer-1": "40000000", campaignTreasury: "10000000" });
  assert.equal(parsePurchaseAction({
    type: "purchase", buyer: "buyer-1", creator: "creator-1",
    affiliate: "affiliate-1", amountMicros: "5000000",
  }).amountMicros, "5000000");
  assert.throws(() => parseEconomicState({
    balances: { "buyer-1": "-1" }, completedPurchases: {}, tick: 0,
  }), EconomicModelValidationError);
  assert.throws(() => parsePurchaseAction({
    type: "purchase", buyer: "buyer-1", creator: "creator-1", amountMicros: "0",
  }), EconomicModelValidationError);
});
