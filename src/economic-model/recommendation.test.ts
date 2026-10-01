import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { canonicalJson, hashCanonical } from "./canonical.ts";
import { compareMechanisms } from "./compare.ts";
import { buildRecommendation, validateRecommendation } from "./recommendation.ts";
import type { RecommendationBundle } from "./recommendation.ts";
import { searchStrategies } from "./search.ts";
import { sweepSensitivity } from "./sensitivity.ts";

const root = "fixtures/creator-marketplace";
const readJson = (name: string) => JSON.parse(readFileSync(`${root}/${name}`, "utf8"));
let checkedFixture: RecommendationBundle | undefined;

function fixture(): RecommendationBundle {
  if (!checkedFixture) {
    const baselineModel = readJson("economic-model.v1.json");
    const repairModel = readJson("economic-model.fee-funded.v1.json");
    const populationModel = readJson("economic-model.population.v1.json");
    const searchInput = readJson("search-input.v1.json");
    const populationInput = readJson("population-input.v1.json");
    checkedFixture = {
      baselineModel, repairModel, populationModel, populationInput,
      search: searchStrategies(searchInput.initialState, baselineModel, searchInput.config),
      comparison: compareMechanisms(searchInput.initialState, baselineModel, repairModel,
        searchInput.config, readJson("reference-purchase.v1.json")),
      sensitivity: sweepSensitivity(populationInput.initialState, populationModel,
        populationInput.scenario, readJson("sensitivity-grid.v1.json")),
    };
  }
  return structuredClone(checkedFixture);
}

test("recommendation and CLI are reproducible with complete claim lineage", () => {
  const bundle = fixture();
  const artifact = buildRecommendation(bundle);
  assert.equal(canonicalJson(artifact), canonicalJson(buildRecommendation(bundle)));
  const { recommendationHash, ...core } = artifact;
  assert.equal(recommendationHash, hashCanonical(core));
  assert.deepEqual(validateRecommendation(artifact, bundle), { ok: true });
  assert.deepEqual(artifact.claims.map((claim) => claim.confidence), [
    "pinned_source", "replayed_conditional", "replayed_conditional", "scenario_conditional", "unknown_real_world",
  ]);
  for (const claim of artifact.claims) {
    const shownAmounts = claim.text.match(/-?\d+\.\d{6} USDC/g) ?? [];
    assert.equal(shownAmounts.length, claim.numericFacts.length, claim.id);
    assert.ok(claim.references.length > 0);
    assert.ok(claim.numericFacts.every((number) => number.references.length > 0));
  }
  const args = ["src/economic-model/recommendation-cli.ts", `${root}/economic-model.v1.json`,
    `${root}/economic-model.fee-funded.v1.json`, `${root}/search-input.v1.json`,
    `${root}/reference-purchase.v1.json`, `${root}/economic-model.population.v1.json`,
    `${root}/population-input.v1.json`, `${root}/sensitivity-grid.v1.json`];
  assert.equal(execFileSync(process.execPath, [...args, "--json"], { encoding: "utf8" }), canonicalJson(artifact));
});

test("fabricated numbers and unconditional wording invalidate a claim", () => {
  const bundle = fixture();
  const artifact = buildRecommendation(bundle);
  const fabricated = structuredClone(artifact);
  fabricated.claims[1]!.text = fabricated.claims[1]!.text.replace("0.340000 USDC", "9.990000 USDC");
  assert.equal(validateRecommendation(fabricated, bundle).ok, false);
  const alteredFact = structuredClone(artifact);
  alteredFact.claims[1]!.numericFacts[1]!.amountMicros = "9990000";
  const { recommendationHash: ignored, ...core } = alteredFact;
  alteredFact.recommendationHash = hashCanonical(core);
  assert.equal(validateRecommendation(alteredFact, bundle).ok, false);
  const unconditional = structuredClone(artifact);
  unconditional.claims[2]!.text = "The fee-funded rule eliminates every possible attack.";
  assert.equal(validateRecommendation(unconditional, bundle).ok, false);
});

test("missing source evidence or a deleted claim reference invalidates the artifact", () => {
  const bundle = fixture();
  const artifact = buildRecommendation(bundle);
  const missing = fixture();
  delete missing.baselineModel.evidence.affiliateBonusSource;
  assert.equal(validateRecommendation(artifact, missing).ok, false);
  const detached = structuredClone(artifact);
  detached.claims[0]!.references.splice(3, 1);
  assert.equal(validateRecommendation(detached, bundle).ok, false);
});

test("tampered comparison and scenario metrics fail even with refreshed artifact hashes", () => {
  const bundle = fixture();
  const artifact = buildRecommendation(bundle);
  const alteredComparison = fixture();
  alteredComparison.comparison.referencePurchase.baselineAffiliateAwardMicros = "2000000";
  const { comparisonHash: oldComparisonHash, ...comparisonCore } = alteredComparison.comparison;
  alteredComparison.comparison.comparisonHash = hashCanonical(comparisonCore);
  assert.equal(validateRecommendation(artifact, alteredComparison).ok, false);
  const alteredSweep = fixture();
  alteredSweep.sensitivity.cells[0]!.seedRuns[0]!.metrics.platformRevenueMicros = "999000000";
  const { sweepHash: oldSweepHash, ...sweepCore } = alteredSweep.sensitivity;
  alteredSweep.sensitivity.sweepHash = hashCanonical(sweepCore);
  assert.equal(validateRecommendation(artifact, alteredSweep).ok, false);
});
