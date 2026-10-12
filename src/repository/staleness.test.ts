import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createHash } from "node:crypto";
import { hashCanonical } from "../economic-model/canonical.ts";
import { checkModelStaleness } from "./staleness.ts";
import type { RepositorySnapshot } from "./snapshot.ts";

const read = (name: string) => JSON.parse(readFileSync(`fixtures/model-staleness/${name}.v1.json`, "utf8"));
const model = JSON.parse(readFileSync("fixtures/creator-marketplace/economic-model.v1.json", "utf8"));
const prefix = "fixtures/creator-marketplace/";
const seal = (snapshot: RepositorySnapshot) => {
  const { snapshotHash: _, ...core } = snapshot;
  return { ...core, snapshotHash: hashCanonical(core) };
};
for (const name of ["relevant", "documentation-only"]) {
  test(`${name} commit diff reproduces model and run lifecycle assessment`, () => {
    const result = checkModelStaleness(model, read("before"), read(name), read("run-links"), prefix);
    assert.deepEqual(result, read(`${name}-assessment`));
    assert.equal(result.status, name === "relevant" ? "stale" : "current");
    assert.equal(result.runs[0]?.status, result.status);
    assert.equal(result.evidence.find((item) => item.id === "platformFeeSource")?.spanChanged, name === "relevant");
  });
}
test("changes beyond cited lines and removed files invalidate dependent runs", () => {
  const next: RepositorySnapshot = read("before");
  const file = next.files.find((item) => item.path === "src/config.mjs")!;
  file.content += "// reviewer must inspect this change\n";
  file.bytes = Buffer.byteLength(file.content);
  file.lineCount++;
  file.sha256 = createHash("sha256").update(file.content).digest("hex");
  next.totalBytes = next.files.reduce((sum, item) => sum + item.bytes, 0);
  const result = checkModelStaleness(model, read("before"), seal(next), read("run-links"), prefix);
  assert.equal(result.status, "stale");
  assert.equal(result.evidence.find((item) => item.id === "platformFeeSource")?.spanChanged, false);
  next.files = next.files.filter((item) => item.path !== file.path);
  next.totalBytes = next.files.reduce((sum, item) => sum + item.bytes, 0);
  assert.equal(checkModelStaleness(model, read("before"), seal(next), [], prefix).status, "stale");
});
test("rejects corrupt snapshots, mismatched pins and unrelated run links", () => {
  const next = read("relevant");
  next.files[0].content += "tampered";
  assert.throws(() => checkModelStaleness(model, read("before"), next, [], prefix), /hash mismatch/);
  assert.throws(() => checkModelStaleness(model, read("relevant"), read("before"), [], prefix), /source pin/);
  assert.throws(() => checkModelStaleness(model, read("before"), read("relevant"), [{ id: "wrong", modelHash: "0".repeat(64) }], prefix), /model hash/);
});
