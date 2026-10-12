import { createHash } from "node:crypto";
import { hashCanonical } from "../economic-model/canonical.ts";
import { hashEconomicModel, parseEconomicModel } from "../economic-model/model.ts";
import { resolveSourceSpan } from "./snapshot.ts";
import type { RepositorySnapshot } from "./snapshot.ts";

function validateSnapshot(snapshot: RepositorySnapshot) {
  const { snapshotHash, ...core } = snapshot;
  if (hashCanonical(core) !== snapshotHash) throw new Error("Snapshot hash mismatch");
  if (new Set(snapshot.files.map((file) => file.path)).size !== snapshot.files.length) throw new Error("Duplicate snapshot paths");
  for (const file of snapshot.files) {
    if (createHash("sha256").update(file.content).digest("hex") !== file.sha256 ||
      Buffer.byteLength(file.content) !== file.bytes ||
      file.lineCount !== file.content.split(/\r\n|\n|\r/).length - (/[\r\n]$/.test(file.content) ? 1 : 0)) {
      throw new Error("Snapshot file integrity mismatch");
    }
  }
}

/** Explicit lifecycle check. File-level invalidation also covers edits outside cited lines. */
export function checkModelStaleness(input: unknown, before: RepositorySnapshot, after: RepositorySnapshot,
  runs: { id: string; modelHash: string }[] = [], pathPrefix = "") {
  const model = parseEconomicModel(input);
  validateSnapshot(before);
  validateSnapshot(after);
  if (pathPrefix && (!pathPrefix.endsWith("/") || pathPrefix.startsWith("/") ||
    pathPrefix.split("/").slice(0, -1).some((part) => !part || part === "." || part === ".."))) throw new Error("Invalid snapshot path prefix");
  if (before.selection !== after.selection || hashCanonical(before.limits) !== hashCanonical(after.limits)) throw new Error("Snapshot selection must match");
  if (before.source.type !== after.source.type) throw new Error("Snapshot repositories must match");
  if (before.source.type === "github" && after.source.type === "github") {
    if (before.source.repository !== model.source.repository || after.source.repository !== model.source.repository ||
      before.source.commit !== model.source.commit) throw new Error("Model source pin must match baseline repository");
  } else if (before.source.type === "local" && after.source.type === "local" && before.source.path !== after.source.path) {
    throw new Error("Local snapshot roots must match");
  }
  const relative = (path: string) => {
    if (!path.startsWith(pathPrefix)) throw new Error("Evidence path is outside snapshot prefix");
    return path.slice(pathPrefix.length);
  };
  const dependencies = model.source.files.map((file) => {
    const path = relative(file.path);
    const old = before.files.find((item) => item.path === path);
    if (!old || old.sha256 !== file.sha256) throw new Error("Model source file does not match baseline snapshot");
    const next = after.files.find((item) => item.path === path);
    return { path: file.path, beforeSha256: old.sha256, afterSha256: next?.sha256 ?? null,
      changed: next?.sha256 !== old.sha256 };
  });
  const evidence = Object.entries(model.evidence).flatMap(([id, item]) => {
    if (item.source.type !== "repo") return [];
    const source = item.source;
    if (source.commit !== model.source.commit) throw new Error("Evidence commit differs from model pin");
    const dependency = dependencies.find((file) => file.path === source.path);
    if (!dependency) throw new Error("Evidence file is not a model dependency");
    const path = relative(source.path);
    const span = resolveSourceSpan(before, path, source.startLine, source.endLine);
    let newText: string | null = null;
    try { newText = resolveSourceSpan(after, path, source.startLine, source.endLine).text; } catch { /* missing file or removed lines */ }
    return [{ id, path: source.path, startLine: source.startLine, endLine: source.endLine,
      beforeText: span.text, afterText: newText, spanChanged: span.text !== newText,
      status: dependency.changed ? "stale" as const : "current" as const }];
  });
  const modelHash = hashEconomicModel(model);
  const status = dependencies.some((file) => file.changed) ? "stale" as const : "current" as const;
  if (new Set(runs.map((run) => run.id)).size !== runs.length || runs.some((run) => !run.id || run.modelHash !== modelHash)) throw new Error("Runs must uniquely identify this model hash");
  const result = { schemaVersion: 1, modelHash, beforeSnapshotHash: before.snapshotHash,
    afterSnapshotHash: after.snapshotHash, beforeSource: before.source, afterSource: after.source,
    status, dependencies, evidence, runs: runs.map((run) => ({ ...run, status })),
    policy: "Any changed or removed model source file requires review; cited-line comparison is diagnostic only. No automatic model rewrite or result recomputation." };
  return { ...result, assessmentHash: hashCanonical(result) };
}
