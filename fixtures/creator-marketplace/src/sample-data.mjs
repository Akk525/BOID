// Example application data. Identity relationships are not encoded here:
// account IDs represent application users, not proven distinct people.
export function sampleState() {
  return {
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
  };
}
