import assert from "node:assert/strict";
import test from "node:test";
import { checkout } from "../src/checkout.mjs";
import { sampleState } from "../src/sample-data.mjs";

const coalitionBalance = (state) =>
  state.balances["buyer-1"] +
  state.balances["creator-1"] +
  state.balances["affiliate-1"];

const totalBalance = (state) =>
  Object.values(state.balances).reduce((sum, amount) => sum + amount, 0);

test("the starter and standard purchases match the independent coalition oracle", () => {
  const before = sampleState();
  const externalCostsMicros = 150_000 + 10_000;

  for (const [listingId, expectedProfitMicros] of [
    ["starter", 340_000],
    ["standard", -1_160_000],
  ]) {
    const { state } = checkout(before, {
      buyerId: "buyer-1",
      listingId,
      affiliateId: "affiliate-1",
    });

    assert.equal(
      coalitionBalance(state) - coalitionBalance(before) - externalCostsMicros,
      expectedProfitMicros,
      listingId,
    );
    assert.equal(totalBalance(state), totalBalance(before), "ledger conserves USDC");
  }
});
