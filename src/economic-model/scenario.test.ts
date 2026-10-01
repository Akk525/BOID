import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { canonicalJson, hashCanonical } from "./canonical.ts";
import { hashEconomicState } from "./model.ts";
import { runPopulationScenario, ScenarioValidationError } from "./scenario.ts";
import { step } from "./step.ts";

const root = "fixtures/creator-marketplace";
const model = () => JSON.parse(readFileSync(`${root}/economic-model.population.v1.json`, "utf8"));
const input = () => JSON.parse(readFileSync(`${root}/population-input.v1.json`, "utf8"));

test("same seed and inputs repeat byte for byte; event actions replay through step", () => {
  const fixture = input();
  const originalInput = canonicalJson(fixture);
  const first = runPopulationScenario(fixture.initialState, model(), fixture.scenario);
  const second = runPopulationScenario(fixture.initialState, model(), fixture.scenario);
  assert.equal(canonicalJson(first), canonicalJson(second));
  assert.equal(canonicalJson(fixture), originalInput);
  assert.equal(first.events.length, fixture.scenario.horizonTicks);
  assert.equal(first.metrics.attackerProfitMicros, "680000");
  assert.equal(first.metrics.attackerTreasuryExtractionMicros, "2000000");
  assert.equal(first.journalHash, hashCanonical(first.events.filter((event) => event.kind === "purchase")
    .map((event) => ({ tick: event.tick, journal: event.journal }))));
  const { runHash, ...core } = first;
  assert.equal(runHash, hashCanonical(core));
  let state = fixture.initialState;
  for (const event of first.events) {
    if (event.kind === "idle") continue;
    assert.equal(event.beforeStateHash, hashEconomicState(state));
    const result = step(state, event.action, model());
    assert.equal(event.status, result.ok ? "accepted" : "rejected");
    assert.deepEqual(event.journal, result.journal);
    assert.deepEqual(event.evaluations, result.evaluations);
    if (result.ok) state = result.state;
    assert.equal(event.afterStateHash, hashEconomicState(state));
  }
  assert.deepEqual(first.finalState, state);
  const changed = input();
  changed.scenario.seed++;
  const different = runPopulationScenario(changed.initialState, model(), changed.scenario);
  assert.notEqual(different.journalHash, first.journalHash);
  assert.notEqual(different.runHash, first.runHash);
  const args = ["src/economic-model/scenario-cli.ts", `${root}/economic-model.population.v1.json`,
    `${root}/population-input.v1.json`];
  const cli = execFileSync(process.execPath, args, { encoding: "utf8" });
  assert.equal(cli, canonicalJson(first));
});

test("every reported ledger total reconciles with the accepted journal", () => {
  const fixture = input();
  const result = runPopulationScenario(fixture.initialState, model(), fixture.scenario);
  const journal = result.events.flatMap((event) => event.kind === "purchase" ? event.journal : []);
  const sum = (predicate: (entry: typeof journal[number]) => boolean) => journal.reduce((total, entry) =>
    total + (predicate(entry) ? BigInt(entry.amountMicros) : 0n), 0n);
  assert.equal(BigInt(result.metrics.platformRevenueMicros), sum((entry) => entry.to === "platform"));
  assert.equal(BigInt(result.metrics.creatorEarningsMicros), sum((entry) => entry.to.endsWith("creator")));
  assert.equal(BigInt(result.metrics.affiliatePayoutMicros), sum((entry) => entry.from === "campaignTreasury"));
  assert.equal(BigInt(result.metrics.treasurySpentMicros),
    BigInt(result.metrics.initialTreasuryMicros) - BigInt(result.metrics.finalTreasuryMicros));
  const total = Object.values(result.initialState.balances).reduce((value, balance) => value + BigInt(balance as string), 0n);
  const finalTotal = Object.values(result.finalState.balances).reduce((value, balance) => value + BigInt(balance as string), 0n);
  assert.equal(finalTotal, total);
  assert.equal(result.metrics.acceptedActions + result.metrics.failedActions, result.metrics.attemptedActions);
});

test("zero attackers yields zero extraction, attempts, costs, and profit", () => {
  const fixture = input();
  fixture.scenario.attacker = null;
  fixture.scenario.attackerArrivalBps = 0;
  const result = runPopulationScenario(fixture.initialState, model(), fixture.scenario);
  assert.equal(result.metrics.attackerAttempts, 0);
  assert.equal(result.metrics.attackerTreasuryExtractionMicros, "0");
  assert.equal(result.metrics.attackerLedgerDeltaMicros, "0");
  assert.equal(result.metrics.attackerIdentityCostMicros, "0");
  assert.equal(result.metrics.attackerTransactionCostMicros, "0");
  assert.equal(result.metrics.attackerProfitMicros, "0");
  assert.ok(result.events.every((event) => event.kind === "idle" || event.policy === "honest"));
});

test("treasury exhaustion rejects later attempts atomically and records failed actions", () => {
  const fixture = input();
  fixture.initialState.balances.campaignTreasury = "1000000";
  fixture.scenario.attackerArrivalBps = 10000;
  fixture.scenario.horizonTicks = 4;
  const result = runPopulationScenario(fixture.initialState, model(), fixture.scenario);
  assert.equal(result.metrics.attackerAttempts, 4);
  assert.equal(result.metrics.attackerAccepted, 1);
  assert.equal(result.metrics.failedActions, 3);
  assert.equal(result.metrics.treasuryBlockedActions, 3);
  assert.equal(result.metrics.finalTreasuryMicros, "0");
  const rejected = result.events.filter((event) => event.kind === "purchase" && event.status === "rejected");
  assert.equal(rejected.length, 3);
  for (const event of rejected) {
    if (event.kind !== "purchase") continue;
    assert.deepEqual(event.journal, []);
    assert.equal(event.beforeStateHash, event.afterStateHash);
  }
  assert.equal(result.finalState.completedPurchases["attacker-buyer-2"], undefined);
});

test("unsupported populations and unbounded inputs fail validation", () => {
  for (const edit of [
    (fixture: ReturnType<typeof input>) => { fixture.scenario.horizonTicks = 10001; },
    (fixture: ReturnType<typeof input>) => { fixture.scenario.honest.buyers[0] = "attacker-buyer-1"; },
    (fixture: ReturnType<typeof input>) => { fixture.scenario.attacker.buyers[0].identityCost = undefined; },
    (fixture: ReturnType<typeof input>) => { fixture.scenario.attacker = null; },
  ]) {
    const fixture = input();
    edit(fixture);
    assert.throws(() => runPopulationScenario(fixture.initialState, model(), fixture.scenario), ScenarioValidationError);
  }
});
