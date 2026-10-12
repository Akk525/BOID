import { PublicKey } from "@solana/web3.js";
import { z } from "zod";
import { parseEconomicModel, parseEconomicState, parsePurchaseAction } from "../economic-model/model.ts";
import type { EconomicModel, EconomicState, PurchaseAction } from "../economic-model/model.ts";
import { canonicalJson, hashCanonical } from "../economic-model/canonical.ts";
import { step } from "../economic-model/step.ts";

export const PAYOUT_ROLES = ["buyer", "creator", "affiliate", "platform", "campaignTreasury"] as const;
type Role = typeof PAYOUT_ROLES[number];
const Key = z.string().refine((value) => {
  try { return new PublicKey(value).toBase58() === value; } catch { return false; }
}, "requires a canonical Solana public key");
const SigningKey = Key.refine((value) => {
  try { return PublicKey.isOnCurve(new PublicKey(value).toBytes()); } catch { return false; }
}, "template requires a signing owner; PDA authorities are unsupported");
const Account = z.strictObject({ actor: z.string().min(1), tokenAccount: Key, owner: SigningKey });
const Bindings = z.strictObject({
  mint: Key, decimals: z.literal(6), tokenProgram: z.literal("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
  feePayer: SigningKey, eligibilityAuthority: SigningKey,
  review: z.strictObject({ reviewer: z.string().min(1), note: z.string().min(1) }),
  accounts: z.strictObject({ buyer: Account, creator: Account, affiliate: Account, platform: Account, campaignTreasury: Account }),
});
export type PayoutBindings = z.infer<typeof Bindings>;
type Ratio = { numerator: string; denominator: string };
const MAX = 18_446_744_073_709_551_615n;

export class PayoutGenerationError extends Error {
  constructor(message: string) { super(`Refusing executable payout generation: ${message}`); }
}
const refuse = (message: string): never => { throw new PayoutGenerationError(message); };
function ratio(model: EconomicModel, id: string): Ratio {
  const parameter = model.parameters[id];
  if (!parameter || parameter.kind !== "rate") return refuse(`missing rate ${id}`);
  if (typeof parameter.value !== "string") return parameter.value;
  const [whole = "0", fraction = ""] = parameter.value.split(".");
  return { numerator: BigInt(whole + fraction).toString(), denominator: (10n ** BigInt(fraction.length)).toString() };
}
function money(model: EconomicModel, id: string): string {
  const parameter = model.parameters[id];
  if (!parameter || parameter.kind !== "money" || BigInt(parameter.value) > MAX) return refuse(`unsupported SPL u64 amount ${id}`);
  return parameter.value;
}

/** Compile only the reviewed purchase family; never derive keys or new policy. */
export function generatePayout(inputModel: unknown, inputBindings: unknown) {
  let model: EconomicModel;
  try { model = parseEconomicModel(inputModel); }
  catch (error) { return refuse(error instanceof Error ? error.message : "invalid model"); }
  const checked = Bindings.safeParse(inputBindings);
  if (!checked.success) return refuse(`missing or invalid reviewed authority/account bindings: ${checked.error.message}`);
  const bindings = checked.data;
  if (model.actors.length !== 5) return refuse("template requires exactly five single-role actors");
  for (const role of PAYOUT_ROLES) {
    const actor = model.actors.find((item) => item.id === bindings.accounts[role].actor);
    if (!actor || actor.roles.length !== 1 || actor.roles[0] !== role) return refuse(`binding for ${role} does not match a single-role model actor`);
  }
  if (new Set(PAYOUT_ROLES.map((role) => bindings.accounts[role].tokenAccount)).size !== 5) return refuse("token accounts must be distinct");
  const [fee, creator, award] = model.actions.purchase.transfers;
  if (model.actions.purchase.transfers.length !== 3 || !fee || !creator || !award ||
    fee.from !== "buyer" || fee.to !== "platform" || fee.when !== undefined || fee.amount.op !== "share" || fee.amount.basis !== "purchase.amount" ||
    creator.from !== "buyer" || creator.to !== "creator" || creator.when !== undefined || creator.amount.op !== "remainder" || creator.amount.minusRule !== fee.id ||
    award.from !== "campaignTreasury" || award.to !== "affiliate") return refuse("unsupported transfer order, recipients, funding source or arithmetic");
  const predicate = award.when;
  if (!predicate || predicate.op !== "and" || predicate.all.length !== 4) return refuse("unsupported referral eligibility");
  const threshold = predicate.all.find((item) => item.op === "gte");
  if (!threshold || threshold.op !== "gte") return refuse("missing purchase threshold");
  const expectedPredicate = { op: "and", all: [
    { op: "present", role: "affiliate" }, { op: "differentAccount", left: "buyer", right: "affiliate" },
    { op: "eq", left: "buyer.completedPurchases", right: 0 },
    { op: "gte", left: "purchase.amount", right: { parameter: threshold.right.parameter } },
  ] };
  // Conjunction order does not change policy; duplicate/missing/altered predicates do.
  const terms = (value: typeof predicate) => value.all.map((item) => canonicalJson(item)).sort();
  if (canonicalJson(terms(predicate)) !== canonicalJson(expectedPredicate.all.map((item) => canonicalJson(item)).sort())) return refuse("unsupported referral eligibility");
  const affiliateAward = award.amount.op === "fixed"
    ? { kind: "fixed" as const, amountMicros: money(model, award.amount.parameter) }
    : award.amount.op === "share" && typeof award.amount.basis !== "string" && award.amount.basis.rule === fee.id
      ? { kind: "fee-share" as const, rate: ratio(model, award.amount.rate.parameter) }
      : refuse("affiliate award must be fixed or a share of the preceding collected fee");
  const configuration = { schemaVersion: 1 as const, templateVersion: "spl-purchase.v1" as const,
    modelHash: hashCanonical(model), bindings, platformFee: ratio(model, fee.amount.rate.parameter),
    minimumEligiblePurchase: money(model, threshold.right.parameter), affiliateAward,
    rules: { fee: fee.id, creator: creator.id, award: award.id },
    evidence: { fee: fee.evidence, creator: creator.evidence, award: award.evidence } };
  const minimum = BigInt(configuration.minimumEligiblePurchase);
  const amounts = [...new Set([1n, 11n, minimum - 1n, minimum, minimum + 1n, minimum + 29n, 20_000_000n]
    .filter((amount) => amount > 0n && amount <= MAX).map(String))];
  const initialState: EconomicState = { balances: Object.fromEntries(PAYOUT_ROLES.map((role) =>
    [bindings.accounts[role].actor, role === "buyer" ? "40000000" : role === "campaignTreasury" ? "10000000" : "0"])), completedPurchases: {}, tick: 0 };
  const action = (amountMicros: string): PurchaseAction => ({ type: "purchase", buyer: bindings.accounts.buyer.actor,
    creator: bindings.accounts.creator.actor, affiliate: bindings.accounts.affiliate.actor, amountMicros });
  const cases = amounts.map((amount) => ({ name: `purchase-${amount}`, initialState, action: action(amount),
    expected: step(initialState, action(amount), model) }));
  const repeatedState = { ...initialState, completedPurchases: { [bindings.accounts.buyer.actor]: 1 } };
  cases.push({ name: "repeat-purchase", initialState: repeatedState, action: action("5000000"), expected: step(repeatedState, action("5000000"), model) });
  const absent: PurchaseAction = { type: "purchase", buyer: bindings.accounts.buyer.actor, creator: bindings.accounts.creator.actor, amountMicros: "5000000" };
  cases.push({ name: "absent-affiliate", initialState, action: absent, expected: step(initialState, absent, model) });
  const assumptions = [
    "Reviewed client settlement, not onchain enforcement of rates or referral policy.",
    "Buyer owner signs purchase debits; treasury owner signs affiliate debits; fee payer signs and pays SOL fees.",
    `Trusted offchain eligibility authority: ${bindings.eligibilityAuthority}. First-purchase state and referral attestation come from this service.`,
    "Distinct account addresses do not prove independent users. Receipt persistence, concurrency and crash recovery require application integration.",
    "Award is debited from campaign treasury, including when its amount is sized from platform fees.",
    "SPL Token only; six decimals; no Token-2022 extensions, PDA derivation, escrow or deployment.",
    "Bindings are declarations to review, not proof that these accounts exist or are controlled by the listed owners.",
  ];
  const artifact = { configuration, model, cases, assumptions };
  return { ...artifact, artifactHash: hashCanonical(artifact) };
}
export type GeneratedPayout = ReturnType<typeof generatePayout>;

export function validateGeneratedPayout(input: unknown): GeneratedPayout {
  const shape = z.strictObject({ configuration: z.object({ bindings: z.unknown() }).passthrough(),
    model: z.unknown(), cases: z.unknown(), assumptions: z.unknown(), artifactHash: z.string() }).safeParse(input);
  if (!shape.success) return refuse("malformed generated artifact");
  const regenerated = generatePayout(shape.data.model, shape.data.configuration.bindings);
  if (canonicalJson(regenerated) !== canonicalJson(input)) return refuse("artifact differs from the reviewed model/template or its expected tests");
  return regenerated;
}

/** Fixed-template arithmetic independent of BOID's transition engine. */
export function payoutTransfers(input: unknown, inputState: unknown, inputAction: unknown) {
  const artifact = validateGeneratedPayout(input);
  let state: EconomicState;
  let action: PurchaseAction;
  try { state = parseEconomicState(inputState); action = parsePurchaseAction(inputAction); }
  catch (error) { return refuse(error instanceof Error ? error.message : "invalid purchase/state"); }
  const config = artifact.configuration;
  const price = BigInt(action.amountMicros);
  if (price <= 0n || price > MAX) return refuse("purchase must fit SPL u64");
  const accounts = config.bindings.accounts;
  if (action.buyer !== accounts.buyer.actor || action.creator !== accounts.creator.actor ||
    (action.affiliate !== undefined && action.affiliate !== accounts.affiliate.actor)) return refuse("purchase identities do not match reviewed bindings");
  const share = (basis: bigint, rate: Ratio) => basis * BigInt(rate.numerator) / BigInt(rate.denominator);
  const fee = share(price, config.platformFee);
  const transfers: { ruleId: string; from: Role; to: Role; amountMicros: string }[] = [
    { ruleId: config.rules.fee, from: "buyer", to: "platform", amountMicros: fee.toString() },
    { ruleId: config.rules.creator, from: "buyer", to: "creator", amountMicros: (price - fee).toString() },
  ];
  const completed = Object.hasOwn(state.completedPurchases, action.buyer) ? state.completedPurchases[action.buyer] ?? 0 : 0;
  if (action.affiliate !== undefined && action.buyer !== action.affiliate &&
    completed === 0 && price >= BigInt(config.minimumEligiblePurchase)) {
    const amount = config.affiliateAward.kind === "fixed" ? BigInt(config.affiliateAward.amountMicros)
      : share(fee, config.affiliateAward.rate);
    transfers.push({ ruleId: config.rules.award, from: "campaignTreasury", to: "affiliate", amountMicros: amount.toString() });
  }
  return transfers;
}

export function payoutConfigurationDiff(baseline: GeneratedPayout, repair: GeneratedPayout) {
  return Object.fromEntries(Object.keys(repair.configuration).filter((key) =>
    canonicalJson(Reflect.get(baseline.configuration, key)) !== canonicalJson(Reflect.get(repair.configuration, key)))
    .map((key) => [key, { before: Reflect.get(baseline.configuration, key), after: Reflect.get(repair.configuration, key) }]));
}
