import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import test from "node:test";
import { compareObservations } from "./observations.ts";

const root = "fixtures/observed-metrics";
const read = (name: string) => JSON.parse(readFileSync(`${root}/${name}.v1.json`, "utf8"));
test("offline measurements retain distinct provenance and reproduce out-of-range assessment", () => {
  const observations = read("observations");
  const priors = read("prior-ranges");
  const before = JSON.stringify({ observations, priors });
  const result = compareObservations(observations, priors);
  assert.deepEqual(result, read("assessment"));
  assert.equal(result.comparisons[0]?.status, "above-range");
  assert.equal(result.comparisons[0]?.outOfRange, true);
  assert.equal(result.imported.observations[0]?.kind, "observed");
  assert.equal(result.priors.ranges[0]?.kind, "scenario-assumption");
  assert.equal(JSON.stringify({ observations, priors }), before);
  const bytes = readFileSync(`${root}/synthetic-counts.csv`);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), observations.observations[0].source.datasetSha256);
});
for (const [value, status] of [["2999", "below-range"], ["3000", "within-range"], ["6000", "within-range"], ["6001", "above-range"]]) {
  test(`inclusive range compares ${value} as ${status}`, () => {
    const input = read("observations");
    input.observations[0].value = value;
    assert.equal(compareObservations(input, read("prior-ranges")).comparisons[0]?.status, status);
  });
}
for (const mutation of ["units", "statistic", "window", "collection", "sample", "value", "query", "kind"]) {
  test(`rejects invalid observation ${mutation}`, () => {
    const input = read("observations");
    const item = input.observations[0];
    if (mutation === "units") item.units = "micro-USDC";
    if (mutation === "statistic") item.statistic = "mean";
    if (mutation === "window") item.window.end = item.window.start;
    if (mutation === "collection") item.collectedAt = item.window.start;
    if (mutation === "sample") item.sampleSize = 0;
    if (mutation === "value") item.value = "10001";
    if (mutation === "query") item.source.query = "";
    if (mutation === "kind") item.kind = "known";
    assert.throws(() => compareObservations(input, read("prior-ranges")));
  });
}
test("different populations and windows are not compared", () => {
  for (const field of ["population", "window"]) {
    const prior = read("prior-ranges");
    if (field === "population") prior.ranges[0].population = "a different population";
    else prior.ranges[0].window.start = "2026-09-30T00:00:00Z";
    const comparison = compareObservations(read("observations"), prior).comparisons[0];
    assert.equal(comparison?.status, "not-comparable");
    assert.equal(comparison?.outOfRange, false);
    assert.equal(comparison?.priorId, null);
  }
});
test("rejects reversed ranges, duplicates and ambiguous matching priors", () => {
  const prior = read("prior-ranges");
  prior.ranges[0].minimum = "7000";
  assert.throws(() => compareObservations(read("observations"), prior), /minimum exceeds/);
  const input = read("observations");
  input.observations.push(structuredClone(input.observations[0]));
  assert.throws(() => compareObservations(input, read("prior-ranges")), /Duplicate/);
  const ambiguous = read("prior-ranges");
  ambiguous.ranges.push({ ...ambiguous.ranges[0], id: "another-prior" });
  assert.throws(() => compareObservations(read("observations"), ambiguous), /Ambiguous/);
});
test("monetary means use exact integer arithmetic beyond Number precision", () => {
  const input = read("observations");
  Object.assign(input.observations[0], { metric: "identityCostMicros", units: "micro-USDC", statistic: "mean", value: "9007199254740993" });
  const prior = read("prior-ranges");
  Object.assign(prior.ranges[0], { metric: "identityCostMicros", units: "micro-USDC", statistic: "mean", minimum: "9007199254740991", maximum: "9007199254740992" });
  assert.equal(compareObservations(input, prior).comparisons[0]?.status, "above-range");
});
