import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { hashCanonical } from "../economic-model/canonical.ts";
import { extractMarketplace } from "./extract.ts";
import { DEFAULT_SNAPSHOT_LIMITS, resolveSourceSpan, snapshotLocal } from "./snapshot.ts";
import type { SnapshotFile } from "./snapshot.ts";

const Hash = z.string().regex(/^[a-f0-9]{64}$/);
const Path = z.string().min(1).refine((value) => !value.startsWith("/") && !value.includes("\\") &&
  value.split("/").every((part) => part && part !== "." && part !== ".."), "normalized relative path required");
const Claim = z.enum(["platformFeeSource", "affiliateBonusSource", "minimumEligiblePurchaseSource", "firstPurchaseSource",
  "distinctAffiliateSource", "creatorPayoutSource", "buyerCreatorSource", "payoutRolesSource"]);
const Manifest = z.strictObject({
  schemaVersion: z.literal(1), repository: z.string().regex(/^[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+$/),
  commit: z.string().regex(/^[a-f0-9]{40}$/), scope: z.string().min(1), license: z.string().min(1),
  files: z.array(z.strictObject({ path: Path, sha256: Hash, selected: z.boolean() })).min(1).max(DEFAULT_SNAPSHOT_LIMITS.maxFiles),
});
const Span = z.strictObject({ path: Path, startLine: z.number().int().positive(), endLine: z.number().int().positive(), textSha256: Hash });
const Gold = z.strictObject({
  schemaVersion: z.literal(1), repository: z.string(), commit: z.string(),
  reviewMethod: z.string().min(1),
  facts: z.array(z.strictObject({ id: z.string().min(1), description: z.string().min(1),
    claimId: Claim.optional(), category: z.enum(["unsupported-syntax", "model-gap"]),
    extractedValue: z.string().optional(), evidence: z.array(Span).min(1) })).min(1),
  notEstablished: z.array(z.strictObject({ claimId: Claim, reason: z.string().min(1) })),
});

/** Offline, bounded regression: read pinned evidence as data and leave B08 unchanged. */
export function checkSecondMarketplace(root = "fixtures/second-marketplace") {
  const read = (path: string) => JSON.parse(readFileSync(join(root, path), "utf8"));
  const manifest = Manifest.parse(read("manifest.v1.json"));
  const gold = Gold.parse(read("gold.v1.json"));
  if (gold.repository !== manifest.repository || gold.commit !== manifest.commit) throw new Error("Gold facts must match the source pin");
  if (new Set(manifest.files.map((file) => file.path)).size !== manifest.files.length) throw new Error("Duplicate manifest paths");
  let totalBytes = 0;
  const allFiles: SnapshotFile[] = manifest.files.map((file) => {
    const bytes = readFileSync(join(root, "upstream", file.path));
    totalBytes += bytes.length;
    if (totalBytes > DEFAULT_SNAPSHOT_LIMITS.maxTotalBytes) throw new Error("Pinned evidence exceeds total byte limit");
    if (bytes.length > DEFAULT_SNAPSHOT_LIMITS.maxFileBytes) throw new Error("Pinned evidence exceeds file byte limit");
    if (createHash("sha256").update(bytes).digest("hex") !== file.sha256) throw new Error(`Pinned source hash mismatch: ${file.path}`);
    const content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return { path: file.path, sha256: file.sha256, bytes: bytes.length,
      content, lineCount: content.split(/\r\n|\n|\r/).length - (/[\r\n]$/.test(content) ? 1 : 0) };
  });
  const local = snapshotLocal(join(root, "upstream"));
  const selected = manifest.files.filter((file) => file.selected).map((file) => file.path).sort();
  if (JSON.stringify(local.files.map((file) => file.path)) !== JSON.stringify(selected)) throw new Error("Source selection differs from pinned manifest");
  const { snapshotHash: _localHash, ...localCore } = local;
  const core = { ...localCore, source: { type: "github" as const, repository: manifest.repository, commit: manifest.commit } };
  const snapshot = { ...core, snapshotHash: hashCanonical(core) };
  const draft = extractMarketplace(snapshot);
  if (new Set(gold.facts.map((fact) => fact.id)).size !== gold.facts.length) throw new Error("Duplicate gold fact IDs");
  const facts = gold.facts.map((fact) => {
    const evidence = fact.evidence.map((span) => {
      const resolved = resolveSourceSpan({ ...snapshot, files: allFiles }, span.path, span.startLine, span.endLine);
      if (createHash("sha256").update(resolved.text).digest("hex") !== span.textSha256) throw new Error(`Gold source span mismatch: ${fact.id}`);
      return { ...resolved, url: `https://github.com/${manifest.repository}/blob/${manifest.commit}/${span.path}#L${span.startLine}-L${span.endLine}` };
    });
    const claim = fact.claimId ? draft.claims[fact.claimId] : undefined;
    const matched = claim?.status === "known" && fact.extractedValue !== undefined && claim.candidates[0]?.value === fact.extractedValue && evidence.some((span) =>
      span.path === claim.candidates[0]?.span.path && span.startLine <= claim.candidates[0].span.startLine &&
      span.endLine >= claim.candidates[0].span.endLine);
    return { ...fact, evidence, extractorStatus: claim?.status ?? "outside-v1-model", outcome: matched ? "matched" as const : "missed" as const };
  });
  const result = { schemaVersion: 1 as const, source: snapshot.source, scope: manifest.scope, license: manifest.license,
    manifestHash: hashCanonical(manifest), goldHash: hashCanonical(gold), snapshotHash: snapshot.snapshotHash,
    reviewMethod: gold.reviewMethod, draft, facts, notEstablished: gold.notEstablished,
    counts: { reviewedFacts: facts.length, matched: facts.filter((fact) => fact.outcome === "matched").length,
      missed: facts.filter((fact) => fact.outcome === "missed").length },
    decision: "assisted-modeling" as const,
    limitation: "Automatic extraction currently supports the bundled checkout/referral fixture. The independent marketplace payment slice requires assisted modeling; unresolved rules cannot be approved." };
  return { ...result, assessmentHash: hashCanonical(result) };
}
