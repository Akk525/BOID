import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runEscrowStrategy, replayEscrowStrategy, searchEscrow, stepEscrow } from "./escrow.ts";

const read = (name: string) => JSON.parse(readFileSync(`fixtures/escrow/${name}.v1.json`, "utf8"));
const run = (input: ReturnType<typeof read>, actions: unknown) => runEscrowStrategy(input.model, input.initialState, actions, input.scenario);
test("escrow trace agrees with hand ledger, costs and independent harm policy", () => {
  const input = read("search-input"), oracle = read("hand-oracle");
  for (let length = 1; length <= 3; length++) {
    const trace = run(input, oracle.actions.slice(0, length));
    assert.deepEqual(trace.finalState.balances, oracle.balances[length - 1]);
    assert.equal(Object.values(trace.finalState.balances).reduce((n, value) => n + BigInt(value), 0n), 10_000_000n);
    assert.equal(trace.adverse, length === 3);
  }
  const trace = run(input, oracle.actions);
  assert.equal(trace.score.ledgerDeltaMicros, oracle.ledgerDeltaMicros);
  assert.equal(trace.score.externalCostMicros, oracle.externalCostMicros);
  assert.equal(trace.score.profitMicros, oracle.profitMicros);
  assert.equal(trace.policy.shortfallMicros, oracle.shortfallMicros);
  assert.deepEqual(trace.policy.doubleSettledOrders, ["attackerOrder"]);
  assert.ok(replayEscrowStrategy(trace, input.model));
  trace.score.profitMicros = "9999999";
  assert.equal(replayEscrowStrategy(trace, input.model), false);
});
test("bounded search matches an independent finite-state oracle and reproduces artifacts", () => {
  const input = read("search-input");
  const result = searchEscrow(input.model, input.initialState, input.scenario, input.limits);
  assert.deepEqual(result, read("search-result"));
  // Hand-reviewed state machine, independent of BOID's transition and scoring.
  const transitions: Record<string, Record<string, string>> = {
    unfunded: { deposit: "pending" }, pending: { release: "released", refund: "refunded" },
    released: { refund: "double" }, refunded: {}, double: {},
  };
  let nodes = 0, rejected = 0;
  const witnesses: string[] = [];
  const enumerate = (state: string, actions: string[]) => {
    for (const action of ["deposit", "release", "refund"]) {
      nodes++;
      const next = transitions[state]![action];
      const prefix = [...actions, action];
      const executed = run(input, prefix.map((type) => ({ type, orderId: "attackerOrder", actor: "buyer" })));
      assert.equal(executed.steps.at(-1)?.accepted, Boolean(next));
      assert.equal(Object.values(executed.finalState.balances).reduce((sum, value) => sum + BigInt(value), 0n), 10_000_000n);
      if (!next) rejected++;
      if ((next ?? state) === "double" && 5_000_000 - 100_000 - 10_000 * prefix.length > 0) witnesses.push(prefix.join(","));
      if (next && prefix.length < 3) enumerate(next, prefix);
    }
  };
  enumerate("unfunded", []);
  assert.equal(result.coverage.visitedNodes, nodes);
  assert.equal(result.coverage.rejectedActions, rejected);
  assert.equal(result.coverage.truncated, false);
  assert.deepEqual(result.findings.map((trace) => trace.actions.map((action) => action.type).join(",")).sort(), witnesses.sort());
  for (const trace of result.findings) assert.ok(replayEscrowStrategy(trace, input.model));
});
test("repair blocks double settlement atomically and has no finding in full declared grammar", () => {
  const input = read("repaired-input"), oracle = read("hand-oracle");
  const released = run(input, oracle.actions.slice(0, 2));
  const rejected = stepEscrow(input.model, released.finalState, oracle.actions[2]);
  assert.equal(rejected.accepted, false);
  assert.deepEqual(rejected.state, released.finalState);
  assert.deepEqual(rejected.journal, []);
  const trace = run(input, oracle.actions);
  assert.equal(trace.score.externalCostMicros, "130000");
  assert.equal(trace.adverse, false);
  assert.equal(trace.policy.shortfallMicros, "0");
  const result = searchEscrow(input.model, input.initialState, input.scenario, input.limits);
  assert.deepEqual(result, read("repaired-result"));
  assert.equal(result.findings.length, 0);
  assert.equal(result.coverage.truncated, false);
  assert.equal(replayEscrowStrategy(run(read("search-input"), oracle.actions), input.model), false);
});
test("profit is insufficient without harm, and harm is insufficient without positive profit", () => {
  const input = read("search-input"), oracle = read("hand-oracle");
  input.scenario.transactionCost.amountMicros = "2000000";
  const trace = run(input, oracle.actions);
  assert.equal(trace.policy.shortfallMicros, "5000000");
  assert.equal(trace.adverse, false);
  assert.equal(trace.score.profitMicros, "-1100000");
  const ordinary = run(read("search-input"), oracle.actions.slice(0, 2));
  assert.equal(ordinary.score.ledgerDeltaMicros, "0");
  assert.equal(ordinary.adverse, false);
});
test("insufficient funds, wrong authority, duplicate deposit and repeated refund reject atomically", () => {
  const input = read("search-input"), oracle = read("hand-oracle");
  const cases = [
    { state: input.initialState, action: { ...oracle.actions[0], actor: "seller" } },
    { state: { ...input.initialState, balances: { ...input.initialState.balances, buyer: "0" } }, action: oracle.actions[0] },
    { state: run(input, oracle.actions.slice(0, 1)).finalState, action: oracle.actions[0] },
    { state: run(input, [oracle.actions[0], oracle.actions[2]]).finalState, action: oracle.actions[2] },
  ];
  for (const { state, action } of cases) {
    const result = stepEscrow(input.model, state, action);
    assert.equal(result.accepted, false);
    assert.deepEqual(result.state, state);
    assert.deepEqual(result.journal, []);
  }
});
test("limits, coalition assumptions and unsupported actions remain explicit", () => {
  const input = read("search-input");
  const result = searchEscrow(input.model, input.initialState, input.scenario, { ...input.limits, maxNodes: 1 });
  assert.equal(result.coverage.truncated, true);
  assert.equal(result.findings.length, 0);
  assert.throws(() => run(input, [{ type: "arbitrary-call", orderId: "attackerOrder", actor: "buyer" }]));
  input.scenario.controlledAccounts.push("escrow");
  assert.throws(() => run(input, []), /escrow authority/);
});
