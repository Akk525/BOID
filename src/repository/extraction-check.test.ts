import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { checkSecondMarketplace } from "./extraction-check.ts";
import { approveMarketplace, extractMarketplace } from "./extract.ts";
import { snapshotLocal } from "./snapshot.ts";

const root = "fixtures/second-marketplace";
test("independent pinned payment slice reproduces published misses and blocks approval", () => {
  const report = checkSecondMarketplace();
  assert.deepEqual(report, JSON.parse(readFileSync(`${root}/assessment.v1.json`, "utf8")));
  assert.deepEqual(report.counts, { reviewedFacts: 7, matched: 0, missed: 7 });
  assert.equal(report.decision, "assisted-modeling");
  assert.ok(Object.values(report.draft.claims).every((claim) => claim.status === "unresolved"));
  const snapshot = snapshotLocal(`${root}/upstream`);
  assert.equal(snapshot.files.length, 3);
  assert.throws(() => approveMarketplace(snapshot, extractMarketplace(snapshot),
    JSON.parse(readFileSync("fixtures/creator-marketplace/extraction-review.v1.json", "utf8"))), /unresolved|review/i);
});

for (const mutation of ["source", "span", "pin"] as const) {
  test(`rejects changed ${mutation} evidence`, () => {
    const directory = mkdtempSync(join(tmpdir(), "boid-extraction-"));
    try {
      cpSync(root, directory, { recursive: true });
      if (mutation === "source") writeFileSync(join(directory, "upstream/server/api-util/lineItems.js"), "changed");
      else {
        const path = join(directory, "gold.v1.json");
        const gold = JSON.parse(readFileSync(path, "utf8"));
        if (mutation === "span") gold.facts[0].evidence[0].textSha256 = "0".repeat(64);
        else gold.commit = "0".repeat(40);
        writeFileSync(path, JSON.stringify(gold));
      }
      assert.throws(() => checkSecondMarketplace(directory), /mismatch|source pin/);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
}
