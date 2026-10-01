import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { relative, join, sep } from "node:path";
import { z } from "zod";
import { hashCanonical } from "../economic-model/canonical.ts";
import { parseEconomicModel } from "../economic-model/model.ts";
import type { EconomicModel } from "../economic-model/model.ts";
import { resolveSourceSpan } from "./snapshot.ts";
import type { RepositorySnapshot, SourceSpan } from "./snapshot.ts";

const claimIds = [
  "platformFeeSource", "affiliateBonusSource", "minimumEligiblePurchaseSource",
  "firstPurchaseSource", "distinctAffiliateSource", "creatorPayoutSource",
  "buyerCreatorSource", "payoutRolesSource",
] as const;
type ClaimId = typeof claimIds[number];
type Candidate = { value: string; span: SourceSpan };
type DraftClaim = { status: "known" | "unresolved" | "conflict"; candidates: Candidate[]; reason?: string };
export type ExtractionDraft = {
  schemaVersion: 1;
  snapshotHash: string;
  extractorVersion: "creator-marketplace-v1";
  claims: Record<ClaimId, DraftClaim>;
  readyForReview: boolean;
  draftHash: string;
};

export class ExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExtractionError";
  }
}

const SpanSchema = z.strictObject({
  path: z.string().min(1), startLine: z.number().int().positive(),
  endLine: z.number().int().positive(), fileSha256: z.string().regex(/^[a-f0-9]{64}$/),
});
const ApprovalSchema = z.strictObject({ value: z.string().min(1), span: SpanSchema });
const ReviewSchema = z.strictObject({
  schemaVersion: z.literal(1),
  sourceRepository: z.string().min(1).regex(/^[A-Za-z0-9._/-]+$/).refine(
    (path) => path.split("/").every((part) => part && part !== "." && part !== ".."),
    "must be a normalized repository path"),
  sourceCommit: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/),
  actors: z.array(z.strictObject({
    id: z.string().min(1),
    roles: z.array(z.enum(["buyer", "creator", "affiliate", "platform", "campaignTreasury"])).min(1),
  })).min(1),
  objectives: z.array(z.strictObject({
    id: z.string().min(1),
    metric: z.enum(["campaignTreasuryBalance", "creatorEarnings", "platformRevenue"]),
    direction: z.enum(["min", "max"]),
  })).min(1),
  objectiveNotes: z.string().min(1),
  claims: z.strictObject(Object.fromEntries(claimIds.map((id) => [id, ApprovalSchema])) as Record<ClaimId, typeof ApprovalSchema>),
});
export type ExtractionReview = z.infer<typeof ReviewSchema>;

function codeCandidates(
  snapshot: RepositorySnapshot, filename: string, pattern: RegExp,
  value: (match: RegExpExecArray) => string,
): Candidate[] {
  const candidates: Candidate[] = [];
  for (const file of snapshot.files.filter((item) => item.path === filename || item.path.endsWith(`/${filename}`))) {
    const code = codeMask(file.content);
    const expression = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
    for (const match of file.content.matchAll(expression)) {
      const codeStart = match.index + (match[0].match(/^\s*/)?.[0].length ?? 0);
      if (!code[codeStart]) continue;
      const startLine = file.content.slice(0, match.index).split("\n").length;
      const endLine = startLine + (match[0].match(/\n/g)?.length ?? 0);
      const span = resolveSourceSpan(snapshot, file.path, startLine, endLine);
      candidates.push({ value: value(match), span });
    }
  }
  return candidates;
}

// Match only source text outside comments and string/template literals. This is
// a lexical guard, not a general JS parser; unsupported syntax stays unresolved.
function codeMask(source: string): Uint8Array {
  const mask = new Uint8Array(source.length);
  let mode: "code" | "line" | "block" | "single" | "double" | "template" = "code";
  for (let index = 0; index < source.length; index++) {
    const current = source[index];
    const next = source[index + 1];
    if (mode === "code") {
      if (current === "/" && next === "/") { mode = "line"; index++; }
      else if (current === "/" && next === "*") { mode = "block"; index++; }
      else if (current === "'") mode = "single";
      else if (current === '"') mode = "double";
      else if (current === "`") mode = "template";
      else mask[index] = 1;
    } else if (mode === "line") {
      if (current === "\n" || current === "\r") { mode = "code"; mask[index] = 1; }
    } else if (mode === "block") {
      if (current === "*" && next === "/") { mode = "code"; index++; }
    } else if (current === "\\") index++;
    else if ((mode === "single" && current === "'") ||
      (mode === "double" && current === '"') ||
      (mode === "template" && current === "`")) mode = "code";
  }
  return mask;
}

function integer(match: RegExpExecArray): string {
  const raw = match[1]?.replaceAll("_", "");
  if (!raw || !/^[0-9]+$/.test(raw)) throw new ExtractionError("Malformed integer source value");
  return BigInt(raw).toString();
}

function claim(candidates: Candidate[], reason: string): DraftClaim {
  if (!candidates.length) return { status: "unresolved", candidates, reason };
  if (candidates.length > 1) return { status: "conflict", candidates, reason: `Multiple candidate source spans for ${reason}` };
  return { status: "known", candidates };
}

function gatedClaim(candidates: Candidate[], prerequisites: Candidate[][], reason: string): DraftClaim {
  if (candidates.length > 1 || prerequisites.some((items) => items.length > 1)) {
    return { status: "conflict", candidates, reason: `Multiple candidate source spans for ${reason}` };
  }
  if (prerequisites.some((items) => items.length === 0)) {
    return { status: "unresolved", candidates, reason: `Missing supporting source rule for ${reason}` };
  }
  return claim(candidates, reason);
}

function rate(bps: bigint, denominator: bigint): string {
  if (denominator !== 10_000n || bps > denominator) throw new ExtractionError("Unsupported platform fee denominator or rate");
  const fraction = bps.toString().padStart(4, "0").replace(/0+$/, "");
  return `${bps === denominator ? "1" : "0"}.${(bps === denominator ? "0" : fraction).padEnd(2, "0")}`;
}

/** Recognize only the fixture's supported checkout/referral syntax. No source is executed. */
export function extractMarketplace(snapshot: RepositorySnapshot): ExtractionDraft {
  const feeConstant = codeCandidates(snapshot, "src/config.mjs",
    /^export const PLATFORM_FEE_BPS = ([0-9][0-9_]*);[^\n]*/m, integer);
  const denominator = codeCandidates(snapshot, "src/checkout.mjs",
    /^const BPS_DENOMINATOR = ([0-9][0-9_]*);[^\n]*/m, integer);
  const feeFormula = codeCandidates(snapshot, "src/checkout.mjs",
    /^\s*const platformFeeMicros = Number\(\s*BigInt\(priceMicros\) \* BigInt\(PLATFORM_FEE_BPS\) \/ BigInt\(BPS_DENOMINATOR\),\s*\);/m,
    () => "share(purchase.amount, PLATFORM_FEE_BPS/BPS_DENOMINATOR)");
  const bonusConstant = codeCandidates(snapshot, "src/config.mjs",
    /^export const FIRST_PURCHASE_AFFILIATE_BONUS_MICROS = ([0-9][0-9_]*);[^\n]*/m, integer);
  const thresholdConstant = codeCandidates(snapshot, "src/config.mjs",
    /^export const MINIMUM_REFERRED_ORDER_MICROS = ([0-9][0-9_]*);[^\n]*/m, integer);
  const bonusReturn = codeCandidates(snapshot, "src/referrals.mjs",
    /^\s*return FIRST_PURCHASE_AFFILIATE_BONUS_MICROS;/m, () => "fixed affiliate bonus");
  const thresholdGuard = codeCandidates(snapshot, "src/referrals.mjs",
    /^\s*if \(priceMicros < MINIMUM_REFERRED_ORDER_MICROS\) return 0;/m, () => "purchase.amount >= minimum");
  const first = codeCandidates(snapshot, "src/referrals.mjs",
    /^\s*if \(priorPurchases !== 0\) return 0;/m, () => "buyer.completedPurchases == 0");
  const distinct = codeCandidates(snapshot, "src/referrals.mjs",
    /^\s*if \(!affiliateId \|\| affiliateId === buyerId\) return 0;/m, () => "affiliate present and distinct from buyer");
  const creatorPayout = codeCandidates(snapshot, "src/checkout.mjs",
    /^\s*const platformFeeMicros = Number\(\s*BigInt\(priceMicros\) \* BigInt\(PLATFORM_FEE_BPS\) \/ BigInt\(BPS_DENOMINATOR\),\s*\);\s*const creatorPayoutMicros = priceMicros - platformFeeMicros;/m,
    () => "creator receives purchase remainder after platform fee");
  const buyerCreator = codeCandidates(snapshot, "src/checkout.mjs",
    /^\s*if \(buyerId === creatorId\) throw new Error\([^\n]*\);/m, () => "buyer and creator differ");
  const payoutRoles = codeCandidates(snapshot, "src/checkout.mjs",
    /^\s*balances\[buyerId\] -= priceMicros;\s*balances\[creatorId\] \+= creatorPayoutMicros;\s*balances\.platform \+= platformFeeMicros;\s*balances\.campaignTreasury -= affiliateBonusMicros;\s*if \(affiliateBonusMicros > 0\) balances\[affiliateId\] \+= affiliateBonusMicros;/m,
    () => "buyer pays; creator/platform receive; campaign treasury pays affiliate");

  const feeCandidates = denominator.length === 1 && denominator[0]?.value === "10000"
    ? feeConstant.map((item) => ({ ...item, value: rate(BigInt(item.value), BigInt(denominator[0]!.value)) }))
    : [];
  const claims: Record<ClaimId, DraftClaim> = {
    platformFeeSource: gatedClaim(feeCandidates, [denominator, feeFormula], "platform fee constant, denominator and checkout formula"),
    affiliateBonusSource: gatedClaim(bonusConstant, [bonusReturn, payoutRoles], "affiliate bonus constant, return and treasury payout"),
    minimumEligiblePurchaseSource: gatedClaim(thresholdConstant, [thresholdGuard], "minimum order constant and referral guard"),
    firstPurchaseSource: claim(first, "first-purchase guard"),
    distinctAffiliateSource: claim(distinct, "affiliate presence and distinct-account guard"),
    creatorPayoutSource: claim(creatorPayout, "platform fee and creator remainder calculation"),
    buyerCreatorSource: claim(buyerCreator, "buyer/creator distinction"),
    payoutRolesSource: claim(payoutRoles, "buyer, creator, platform, treasury and affiliate transfers"),
  };
  const core = {
    schemaVersion: 1 as const, snapshotHash: snapshot.snapshotHash,
    extractorVersion: "creator-marketplace-v1" as const, claims,
    readyForReview: Object.values(claims).every((item) => item.status === "known"),
  };
  return { ...core, draftHash: hashCanonical(core) };
}

/** Approvals must exactly match a deterministic candidate and its file hash. */
export function approveMarketplace(
  snapshot: RepositorySnapshot, draft: ExtractionDraft, inputReview: unknown,
): EconomicModel {
  const result = ReviewSchema.safeParse(inputReview);
  if (!result.success) throw new ExtractionError(`Invalid review: ${result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`);
  const review = result.data;
  if (draft.snapshotHash !== snapshot.snapshotHash || !draft.readyForReview ||
    hashCanonical(extractMarketplace(snapshot)) !== hashCanonical(draft)) {
    throw new ExtractionError("Draft is unresolved, conflicting, or does not match this snapshot; review the source and extract again");
  }
  if (snapshot.source.type === "github" &&
    (review.sourceRepository !== snapshot.source.repository || review.sourceCommit !== snapshot.source.commit)) {
    throw new ExtractionError("Review repository and commit must match the pinned GitHub snapshot");
  }
  if (snapshot.source.type === "local") verifyLocalPin(snapshot, review);
  for (const id of claimIds) {
    const approved = review.claims[id];
    const candidate = draft.claims[id].candidates[0];
    if (!candidate || approved.value !== candidate.value ||
      approved.span.path !== candidate.span.path ||
      approved.span.startLine !== candidate.span.startLine ||
      approved.span.endLine !== candidate.span.endLine ||
      approved.span.fileSha256 !== candidate.span.fileSha256) {
      throw new ExtractionError(`Review claim ${id} does not match the extracted value and exact source span`);
    }
    const resolved = resolveSourceSpan(snapshot, approved.span.path, approved.span.startLine, approved.span.endLine);
    if (resolved.fileSha256 !== approved.span.fileSha256 || resolved.text !== candidate.span.text) {
      throw new ExtractionError(`Review claim ${id} has an invented or changed source span`);
    }
  }

  const path = (id: ClaimId) => `${review.sourceRepository}/${review.claims[id].span.path}`;
  const repoEvidence = (id: ClaimId) => ({
    kind: "known" as const,
    source: { type: "repo" as const, commit: review.sourceCommit, path: path(id),
      startLine: review.claims[id].span.startLine, endLine: review.claims[id].span.endLine },
  });
  const sourceFiles = ["platformFeeSource", "firstPurchaseSource", "creatorPayoutSource"] as const;
  const model = {
    schemaVersion: 1 as const,
    source: {
      repository: review.sourceRepository, commit: review.sourceCommit,
      files: sourceFiles.map((id) => ({
        path: path(id), sha256: review.claims[id].span.fileSha256,
      })),
    },
    assets: [{ id: "USDC" as const, decimals: 6 as const }],
    actors: review.actors,
    state: { balances: { asset: "USDC" as const }, completedPurchases: { actorRole: "buyer" as const } },
    evidence: {
      platformFeeSource: repoEvidence("platformFeeSource"),
      creatorPayoutSource: repoEvidence("creatorPayoutSource"),
      affiliateBonusSource: repoEvidence("affiliateBonusSource"),
      minimumEligiblePurchaseSource: repoEvidence("minimumEligiblePurchaseSource"),
      firstPurchaseSource: repoEvidence("firstPurchaseSource"),
      distinctAffiliateSource: repoEvidence("distinctAffiliateSource"),
      buyerCreatorSource: repoEvidence("buyerCreatorSource"),
      objectiveSource: { kind: "user_supplied" as const, source: { type: "user" as const }, notes: review.objectiveNotes },
    },
    parameters: {
      platformFeeRate: { kind: "rate" as const, value: review.claims.platformFeeSource.value, evidence: "platformFeeSource" },
      affiliateBonus: { kind: "money" as const, value: review.claims.affiliateBonusSource.value, evidence: "affiliateBonusSource" },
      minimumEligiblePurchase: { kind: "money" as const, value: review.claims.minimumEligiblePurchaseSource.value, evidence: "minimumEligiblePurchaseSource" },
    },
    actions: { purchase: { transfers: [
      { id: "platformFee", from: "buyer", to: "platform", amount: { op: "share", basis: "purchase.amount", rate: { parameter: "platformFeeRate" } }, evidence: ["platformFeeSource"] },
      { id: "creatorPayout", from: "buyer", to: "creator", amount: { op: "remainder", basis: "purchase.amount", minusRule: "platformFee" }, evidence: ["creatorPayoutSource"] },
      { id: "affiliateBonus", from: "campaignTreasury", to: "affiliate", amount: { op: "fixed", parameter: "affiliateBonus" },
        when: { op: "and", all: [
          { op: "present", role: "affiliate" },
          { op: "differentAccount", left: "buyer", right: "affiliate" },
          { op: "eq", left: "buyer.completedPurchases", right: 0 },
          { op: "gte", left: "purchase.amount", right: { parameter: "minimumEligiblePurchase" } },
        ] }, evidence: ["affiliateBonusSource", "minimumEligiblePurchaseSource", "firstPurchaseSource", "distinctAffiliateSource"] },
    ] } },
    constraints: { noNegativeBalances: true as const, buyerCreatorDifferent: { value: true as const, evidence: "buyerCreatorSource" } },
    objectives: review.objectives.map((objective) => ({ ...objective, evidence: "objectiveSource" })),
  };
  return parseEconomicModel(model);
}

function verifyLocalPin(snapshot: RepositorySnapshot, review: ExtractionReview): void {
  if (snapshot.source.type !== "local") return;
  if (review.sourceCommit.length === 64) {
    if (review.sourceCommit !== snapshot.snapshotHash) {
      throw new ExtractionError("Local content pin must equal the current snapshot hash");
    }
    return;
  }
  try {
    const repoRoot = execFileSync("git", ["-C", snapshot.source.path, "rev-parse", "--show-toplevel"],
      { encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "pipe"] }).trim();
    const sourceRelative = relative(repoRoot, snapshot.source.path).split(sep).join("/");
    if (sourceRelative !== review.sourceRepository) {
      throw new ExtractionError("Local review repository path differs from the Git worktree path");
    }
    const uniqueFiles = new Map(Object.values(review.claims).map((item) =>
      [item.span.path, item.span.fileSha256]));
    for (const [path, hash] of uniqueFiles) {
      const committed = execFileSync("git", ["-C", repoRoot, "show", `${review.sourceCommit}:${join(sourceRelative, path)}`],
        { encoding: "buffer", maxBuffer: snapshot.limits.maxFileBytes + 1, timeout: 5000, stdio: ["ignore", "pipe", "pipe"] });
      if (createHash("sha256").update(committed).digest("hex") !== hash) {
        throw new ExtractionError(`Reviewed source ${path} differs from the claimed Git commit`);
      }
    }
  } catch (error) {
    if (error instanceof ExtractionError) throw error;
    throw new ExtractionError(`Cannot verify the local source commit; use the exact snapshot hash as a content pin or a reachable Git commit: ${error instanceof Error ? error.message : String(error)}`);
  }
}
