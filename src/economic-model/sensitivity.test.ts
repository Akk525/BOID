import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { canonicalJson, hashCanonical } from "./canonical.ts";
import { sweepSensitivity } from "./sensitivity.ts";

const root = "fixtures/creator-marketplace";
const readJson = (name: string) => JSON.parse(readFileSync(`${root}/${name}`, "utf8"));
const model = () => readJson("economic-model.population.v1.json");
const population = () => readJson("population-input.v1.json");
const grid = () => readJson("sensitivity-grid.v1.json");

test("the paired sweep and CLI reproduce byte-equivalent hashes and labeled output", () => {
  const input = population();
  const config = grid();
  const first = sweepSensitivity(input.initialState, model(), input.scenario, config);
  const second = sweepSensitivity(input.initialState, model(), input.scenario, config);
  assert.equal(canonicalJson(first), canonicalJson(second));
  const { sweepHash, ...core } = first;
  assert.equal(sweepHash, hashCanonical(core));
  assert.equal(first.cells.length, 24);
  assert.ok(first.cells.every((cell) => cell.seedRuns.map((run) => run.seed).join(",") === "42,43,44"));
  const args = ["src/economic-model/sensitivity-cli.ts", `${root}/economic-model.population.v1.json`,
    `${root}/population-input.v1.json`, `${root}/sensitivity-grid.v1.json`];
  const json = execFileSync(process.execPath, [...args, "--json"], { encoding: "utf8" });
  assert.equal(json, canonicalJson(first));
  const table = execFileSync(process.execPath, args, { encoding: "utf8" });
  assert.match(table, /0\.490000 USDC break-even identity cost/);
  assert.match(table, /platform revenue range \(USDC\)/);
  assert.match(table, /not a statistical confidence interval/);
});

test("the 5 USDC first-purchase control flips from +0.34 to -0.01 at 0.50 identity cost", () => {
  const input = population();
  const config = grid();
  config.horizonTicks = 1;
  config.arrivalBps = 10000;
  config.honestOrderDistributions = config.honestOrderDistributions.slice(0, 1);
  config.attackerFractionsBps = [10000];
  config.attackerOrderAmountsMicros = ["5000000"];
  config.seeds = [42];
  const result = sweepSensitivity(input.initialState, model(), input.scenario, config);
  assert.equal(result.firstPurchaseProbes[0]!.breakEvenIdentityCostMicros, "490000");
  assert.deepEqual(result.cells.map((cell) => cell.seedRuns[0]!.metrics.attackerProfitMicros), ["340000", "-10000"]);
  assert.deepEqual(result.cells.map((cell) => cell.summary.region), ["positive", "nonpositive"]);
  assert.ok(result.cells.every((cell) => cell.seedRuns[0]!.metrics.attackerAccepted === 1));
});

test("cost rows share journals and have an exact monotone profit difference", () => {
  const input = population();
  const result = sweepSensitivity(input.initialState, model(), input.scenario, grid());
  const half = result.cells.length / 2;
  for (let index = 0; index < half; index++) {
    const low = result.cells[index]!;
    const high = result.cells[index + half]!;
    for (let seedIndex = 0; seedIndex < low.seedRuns.length; seedIndex++) {
      const a = low.seedRuns[seedIndex]!;
      const b = high.seedRuns[seedIndex]!;
      assert.equal(a.seed, b.seed);
      assert.equal(a.journalHash, b.journalHash);
      assert.equal(a.metrics.treasurySpentMicros, b.metrics.treasurySpentMicros);
      assert.equal(a.metrics.platformRevenueMicros, b.metrics.platformRevenueMicros);
      const costDelta = BigInt(b.metrics.attackerIdentityCostMicros) - BigInt(a.metrics.attackerIdentityCostMicros);
      assert.equal(BigInt(a.metrics.attackerProfitMicros) - BigInt(b.metrics.attackerProfitMicros), costDelta);
      assert.equal(BigInt(a.metrics.treasurySpentMicros),
        BigInt(a.metrics.initialTreasuryMicros) - BigInt(a.metrics.finalTreasuryMicros));
    }
  }
});

test("paired larger honest orders cannot reduce platform revenue in this fixture", () => {
  const input = population();
  const result = sweepSensitivity(input.initialState, model(), input.scenario, grid());
  for (const small of result.cells.filter((cell) => cell.honestOrderDistribution.id === "small-only")) {
    const mixed = result.cells.find((cell) => cell.honestOrderDistribution.id === "small-and-normal" &&
      cell.identityCostMicros === small.identityCostMicros &&
      cell.attackerFractionBps === small.attackerFractionBps &&
      cell.attackerOrderAmountMicros === small.attackerOrderAmountMicros)!;
    for (let index = 0; index < small.seedRuns.length; index++) {
      assert.ok(BigInt(mixed.seedRuns[index]!.metrics.platformRevenueMicros) >=
        BigInt(small.seedRuns[index]!.metrics.platformRevenueMicros));
    }
  }
});

test("invalid grids and unsupported populations fail before a sweep", () => {
  const input = population();
  const duplicate = grid();
  duplicate.seeds = [42, 42];
  assert.throws(() => sweepSensitivity(input.initialState, model(), input.scenario, duplicate), /seeds must contain unique/);
  const oversized = grid();
  oversized.seeds = Array.from({ length: 12 }, (_, index) => index + 1);
  assert.throws(() => sweepSensitivity(input.initialState, model(), input.scenario, oversized), /maximum is 256/);
  const absent = population();
  absent.scenario.attacker = null;
  assert.throws(() => sweepSensitivity(absent.initialState, model(), absent.scenario, grid()), /requires an attacker/);
});
