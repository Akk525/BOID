import {
  FIRST_PURCHASE_AFFILIATE_BONUS_MICROS,
  MINIMUM_REFERRED_ORDER_MICROS,
} from "./config.mjs";

export function referralBonusFor({ buyerId, affiliateId, priceMicros, priorPurchases }) {
  if (!affiliateId || affiliateId === buyerId) return 0;
  if (priorPurchases !== 0) return 0;
  if (priceMicros < MINIMUM_REFERRED_ORDER_MICROS) return 0;
  return FIRST_PURCHASE_AFFILIATE_BONUS_MICROS;
}
