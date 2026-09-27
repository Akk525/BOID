import assert from "node:assert/strict";
import test from "node:test";
import { checkout } from "../src/checkout.mjs";

const baseState = () => ({
  balances: {
    "buyer-1": 40_000_000,
    "creator-1": 0,
    "affiliate-1": 0,
    platform: 0,
    campaignTreasury: 10_000_000,
  },
  purchasesByBuyer: {},
  listings: {
    starter: { creatorId: "creator-1", priceMicros: 5_000_000 },
    standard: { creatorId: "creator-1", priceMicros: 20_000_000 },
    small: { creatorId: "creator-1", priceMicros: 4_000_000 },
  },
});

test("first referred starter purchase pays the creator, platform, and affiliate", () => {
  const before = baseState();
  const { state, receipt } = checkout(before, {
    buyerId: "buyer-1",
    listingId: "starter",
    affiliateId: "affiliate-1",
  });

  // Independent worked example: 5.00 = 4.50 creator + 0.50 platform;
  // the campaign separately pays 1.00 to the affiliate.
  assert.deepEqual(state.balances, {
    "buyer-1": 35_000_000,
    "creator-1": 4_500_000,
    "affiliate-1": 1_000_000,
    platform: 500_000,
    campaignTreasury: 9_000_000,
  });
  assert.equal(state.purchasesByBuyer["buyer-1"], 1);
  assert.equal(receipt.affiliateBonusMicros, 1_000_000);
  assert.deepEqual(before, baseState(), "checkout must leave its input unchanged");
});

test("normal first order shows the fixed bonus does not scale with price", () => {
  const { state } = checkout(baseState(), {
    buyerId: "buyer-1",
    listingId: "standard",
    affiliateId: "affiliate-1",
  });

  assert.deepEqual(state.balances, {
    "buyer-1": 20_000_000,
    "creator-1": 18_000_000,
    "affiliate-1": 1_000_000,
    platform: 2_000_000,
    campaignTreasury: 9_000_000,
  });
});

test("an order below the referral minimum earns no affiliate bonus", () => {
  const { state, receipt } = checkout(baseState(), {
    buyerId: "buyer-1",
    listingId: "small",
    affiliateId: "affiliate-1",
  });

  assert.equal(state.balances["creator-1"], 3_600_000);
  assert.equal(state.balances.platform, 400_000);
  assert.equal(state.balances["affiliate-1"], 0);
  assert.equal(state.balances.campaignTreasury, 10_000_000);
  assert.equal(receipt.affiliateBonusMicros, 0);
});

test("only the buyer's first purchase qualifies for the bonus", () => {
  const first = checkout(baseState(), {
    buyerId: "buyer-1",
    listingId: "starter",
    affiliateId: "affiliate-1",
  });
  const second = checkout(first.state, {
    buyerId: "buyer-1",
    listingId: "starter",
    affiliateId: "affiliate-1",
  });

  assert.equal(second.receipt.affiliateBonusMicros, 0);
  assert.equal(second.state.balances["affiliate-1"], 1_000_000);
  assert.equal(second.state.balances.campaignTreasury, 9_000_000);
  assert.equal(second.state.purchasesByBuyer["buyer-1"], 2);
});

test("direct self-referral cannot collect the affiliate bonus", () => {
  const state = baseState();
  state.balances["buyer-1"] = 40_000_000;
  const { receipt } = checkout(state, {
    buyerId: "buyer-1",
    listingId: "starter",
    affiliateId: "buyer-1",
  });
  assert.equal(receipt.affiliateBonusMicros, 0);
});

test("a purchase fails atomically if the buyer or campaign lacks funds", () => {
  const poorBuyer = baseState();
  poorBuyer.balances["buyer-1"] = 4_999_999;
  assert.throws(() => checkout(poorBuyer, {
    buyerId: "buyer-1", listingId: "starter", affiliateId: "affiliate-1",
  }), /buyer balance/i);
  assert.deepEqual(poorBuyer.purchasesByBuyer, {});

  const emptyCampaign = baseState();
  emptyCampaign.balances.campaignTreasury = 999_999;
  const unchangedCampaign = structuredClone(emptyCampaign);
  assert.throws(() => checkout(emptyCampaign, {
    buyerId: "buyer-1", listingId: "starter", affiliateId: "affiliate-1",
  }), /campaign treasury/i);
  assert.deepEqual(emptyCampaign, unchangedCampaign);
});
