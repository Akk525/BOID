import { PLATFORM_FEE_BPS } from "./config.mjs";
import { referralBonusFor } from "./referrals.mjs";

const BPS_DENOMINATOR = 10_000;

function requireAccount(balances, id, role) {
  if (!Object.hasOwn(balances, id)) {
    throw new Error(`Unknown ${role} account: ${id}`);
  }
  if (!Number.isSafeInteger(balances[id]) || balances[id] < 0) {
    throw new Error(`Invalid ${role} balance`);
  }
}

/**
 * Settle one listing purchase against an application-owned USDC ledger.
 * The listing sets the price; campaign rewards are funded separately.
 * This fixture models application rules, not Solana settlement or identity proof.
 */
export function checkout(state, { buyerId, listingId, affiliateId } = {}) {
  const listing = state.listings[listingId];
  if (!listing) throw new Error(`Unknown listing: ${listingId}`);

  const { creatorId, priceMicros } = listing;
  if (!Number.isSafeInteger(priceMicros) || priceMicros <= 0) {
    throw new Error("Listing price must be a positive integer number of micro-USDC");
  }
  if (buyerId === creatorId) throw new Error("Buyer cannot purchase their own listing");

  requireAccount(state.balances, buyerId, "buyer");
  requireAccount(state.balances, creatorId, "creator");
  requireAccount(state.balances, "platform", "platform");
  requireAccount(state.balances, "campaignTreasury", "campaign treasury");
  if (affiliateId) requireAccount(state.balances, affiliateId, "affiliate");

  const priorPurchases = state.purchasesByBuyer[buyerId] ?? 0;
  if (!Number.isSafeInteger(priorPurchases) || priorPurchases < 0) {
    throw new Error("Invalid buyer purchase count");
  }

  const affiliateBonusMicros = referralBonusFor({
    buyerId, affiliateId, priceMicros, priorPurchases,
  });
  const platformFeeMicros = Number(
    BigInt(priceMicros) * BigInt(PLATFORM_FEE_BPS) / BigInt(BPS_DENOMINATOR),
  );
  const creatorPayoutMicros = priceMicros - platformFeeMicros;

  if (state.balances[buyerId] < priceMicros) {
    throw new Error("Insufficient buyer balance");
  }
  if (state.balances.campaignTreasury < affiliateBonusMicros) {
    throw new Error("Insufficient campaign treasury balance");
  }

  const balances = { ...state.balances };
  balances[buyerId] -= priceMicros;
  balances[creatorId] += creatorPayoutMicros;
  balances.platform += platformFeeMicros;
  balances.campaignTreasury -= affiliateBonusMicros;
  if (affiliateBonusMicros > 0) balances[affiliateId] += affiliateBonusMicros;

  if (Object.values(balances).some((balance) => !Number.isSafeInteger(balance))) {
    throw new Error("Checkout would exceed the safe integer range");
  }

  return {
    state: {
      ...state,
      balances,
      purchasesByBuyer: {
        ...state.purchasesByBuyer,
        [buyerId]: priorPurchases + 1,
      },
    },
    receipt: {
      buyerId,
      creatorId,
      affiliateId: affiliateId ?? null,
      listingId,
      priceMicros,
      creatorPayoutMicros,
      platformFeeMicros,
      affiliateBonusMicros,
    },
  };
}
