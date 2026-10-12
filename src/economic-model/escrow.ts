import { z } from "zod";
import { canonicalJson, hashCanonical } from "./canonical.ts";
import { IdSchema as Id, MicroUsdcSchema as Money } from "./value-schema.ts";
import { ExternalCostSchema } from "./strategy.ts";

const Model = z.strictObject({ schemaVersion: z.literal(1), family: z.literal("pooled-escrow.v1"),
  escrowAccount: Id, refundRequiresPending: z.boolean(),
  evidence: z.strictObject({ kind: z.literal("user_supplied"), notes: z.string().min(1) }),
  policy: z.literal("One settlement per order; pending deposits remain fully collateralized"),
});
const Order = z.strictObject({ buyer: Id, seller: Id, amountMicros: Money.refine((value) => BigInt(value) > 0n),
  deposited: z.boolean(), released: z.boolean(), refunded: z.boolean(),
}).refine((order) => order.deposited || (!order.released && !order.refunded), "Settlement requires a deposit");
const State = z.strictObject({ balances: z.record(Id, Money), orders: z.record(Id, Order) });
const Action = z.strictObject({ type: z.enum(["deposit", "release", "refund"]), orderId: Id, actor: Id });
const Scenario = z.strictObject({ controlledAccounts: z.array(Id).min(1).max(8),
  identityCost: ExternalCostSchema, transactionCost: ExternalCostSchema });
const Limits = z.strictObject({ maxDepth: z.number().int().min(1).max(6),
  maxNodes: z.number().int().min(1).max(100_000), maxFindings: z.number().int().min(1).max(100) });
export type EscrowModel = z.infer<typeof Model>;
export type EscrowState = z.infer<typeof State>;
export type EscrowAction = z.infer<typeof Action>;
type Journal = { from: string; to: string; amountMicros: string; orderId: string; action: EscrowAction["type"] };

function validate(model: EscrowModel, state: EscrowState) {
  if (!Object.hasOwn(state.balances, model.escrowAccount)) throw new Error("Escrow account requires a balance");
  if (Object.keys(state.orders).length > 20 || Object.keys(state.balances).length > 50) throw new Error("Escrow state exceeds bounded family size");
  for (const order of Object.values(state.orders)) {
    if (![order.buyer, order.seller].every((id) => Object.hasOwn(state.balances, id)) ||
      order.buyer === order.seller || [order.buyer, order.seller].includes(model.escrowAccount)) throw new Error("Order requires distinct funded buyer, seller and escrow accounts");
  }
}
function harm(model: EscrowModel, state: EscrowState) {
  const pending = Object.values(state.orders).filter((order) => order.deposited && !order.released && !order.refunded)
    .reduce((sum, order) => sum + BigInt(order.amountMicros), 0n);
  const shortage = pending - BigInt(state.balances[model.escrowAccount]!);
  return { doubleSettledOrders: Object.entries(state.orders).filter(([, order]) => order.released && order.refunded).map(([id]) => id).sort(),
    pendingLiabilityMicros: pending.toString(), shortfallMicros: (shortage > 0n ? shortage : 0n).toString() };
}

/** Typed, atomic, single-asset escrow transition; no external code execution. */
export function stepEscrow(modelInput: unknown, stateInput: unknown, actionInput: unknown) {
  const model = Model.parse(modelInput), state = State.parse(stateInput), action = Action.parse(actionInput);
  validate(model, state);
  const reject = (reason: string) => ({ accepted: false, state, journal: [] as Journal[], reason });
  const order = Object.hasOwn(state.orders, action.orderId) ? state.orders[action.orderId] : undefined;
  if (!order || order.buyer !== action.actor) return reject("Only the order buyer may deposit, confirm release or cancel");
  if (action.type === "deposit" && order.deposited) return reject("Order already deposited");
  if (action.type !== "deposit" && !order.deposited) return reject("Order is not deposited");
  if (action.type === "release" && (order.released || order.refunded)) return reject("Order is not pending");
  if (action.type === "refund" && (order.refunded || (model.refundRequiresPending && order.released))) return reject("Refund guard rejected terminal order");
  const from = action.type === "deposit" ? order.buyer : model.escrowAccount;
  const to = action.type === "release" ? order.seller : action.type === "refund" ? order.buyer : model.escrowAccount;
  const amount = BigInt(order.amountMicros);
  if (BigInt(state.balances[from]!) < amount) return reject("Insufficient funds");
  const next = structuredClone(state);
  next.balances[from] = (BigInt(next.balances[from]!) - amount).toString();
  next.balances[to] = (BigInt(next.balances[to]!) + amount).toString();
  if (next.balances[to]!.length > 30) return reject("Balance exceeds serialized money bound");
  const updated = next.orders[action.orderId]!;
  if (action.type === "deposit") updated.deposited = true;
  if (action.type === "release") updated.released = true;
  if (action.type === "refund") updated.refunded = true;
  return { accepted: true, state: next, journal: [{ from, to, amountMicros: order.amountMicros, orderId: action.orderId, action: action.type }], reason: null };
}

export function runEscrowStrategy(modelInput: unknown, stateInput: unknown, actionsInput: unknown, scenarioInput: unknown) {
  const model = Model.parse(modelInput), initialState = State.parse(stateInput), scenario = Scenario.parse(scenarioInput);
  const actions = z.array(Action).max(6).parse(actionsInput);
  validate(model, initialState);
  const controlled = new Set(scenario.controlledAccounts);
  if (controlled.size !== scenario.controlledAccounts.length || controlled.has(model.escrowAccount) ||
    scenario.controlledAccounts.some((id) => !Object.hasOwn(initialState.balances, id))) throw new Error("Coalition accounts must be unique funded participants; escrow authority is excluded");
  // No preexisting claim is valued as free capital. The family starts coalition orders unfunded.
  if (Object.values(initialState.orders).some((order) => order.deposited && (controlled.has(order.buyer) || controlled.has(order.seller)))) throw new Error("Coalition orders must start undeposited");
  const initialHarm = harm(model, initialState);
  if (initialHarm.doubleSettledOrders.length || initialHarm.shortfallMicros !== "0") throw new Error("Initial escrow policy is already violated");
  if (actions.some((action) => !controlled.has(action.actor))) throw new Error("Strategy initiators must be controlled");
  let state = initialState;
  const steps = [];
  for (const action of actions) {
    const result = stepEscrow(model, state, action);
    steps.push({ action, beforeStateHash: hashCanonical(state), afterStateHash: hashCanonical(result.state),
      accepted: result.accepted, reason: result.reason, journal: result.journal });
    state = result.state;
    if (!result.accepted) break;
  }
  const balance = (value: EscrowState) => scenario.controlledAccounts.reduce((sum, id) => sum + BigInt(value.balances[id]!), 0n);
  const delta = balance(state) - balance(initialState);
  const costs = BigInt(scenario.identityCost.amountMicros) * BigInt(controlled.size) + BigInt(scenario.transactionCost.amountMicros) * BigInt(steps.length);
  const policy = harm(model, state);
  const profit = delta - costs;
  const core = { schemaVersion: 1, engineVersion: "escrow-strategy.v1", modelHash: hashCanonical(model),
    model, initialState, actions, scenario, steps, finalState: state,
    score: { ledgerDeltaMicros: delta.toString(), externalCostMicros: costs.toString(), profitMicros: profit.toString() },
    policy, adverse: profit > 0n && (policy.doubleSettledOrders.length > 0 || BigInt(policy.shortfallMicros) > 0n) };
  return { ...core, traceHash: hashCanonical(core) };
}

export function replayEscrowStrategy(input: unknown, model: unknown) {
  const envelope = z.object({ initialState: z.unknown(), actions: z.unknown(), scenario: z.unknown() }).safeParse(input);
  if (!envelope.success) return false;
  try {
    return canonicalJson(input) === canonicalJson(runEscrowStrategy(model, envelope.data.initialState, envelope.data.actions, envelope.data.scenario));
  } catch { return false; }
}

/** Exhaustive prefix enumeration over this declared fixed-order grammar, without pruning. */
export function searchEscrow(modelInput: unknown, stateInput: unknown, scenarioInput: unknown, limitsInput: unknown) {
  const model = Model.parse(modelInput), state = State.parse(stateInput), scenario = Scenario.parse(scenarioInput), limits = Limits.parse(limitsInput);
  runEscrowStrategy(model, state, [], scenario);
  const grammar = Object.entries(state.orders).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .filter(([, order]) => scenario.controlledAccounts.includes(order.buyer)).flatMap(([orderId, order]) =>
      (["deposit", "release", "refund"] as const).map((type) => ({ type, orderId, actor: order.buyer })));
  const findings: ReturnType<typeof runEscrowStrategy>[] = [];
  let visitedNodes = 0, rejectedActions = 0, adverseTraces = 0, truncated = false;
  const visit = (prefix: EscrowAction[]) => {
    for (const action of grammar) {
      if (visitedNodes >= limits.maxNodes) { truncated = true; return; }
      visitedNodes++;
      const actions = [...prefix, action];
      const trace = runEscrowStrategy(model, state, actions, scenario);
      if (trace.adverse) {
        adverseTraces++;
        findings.push(trace);
        findings.sort((a, b) => BigInt(a.score.profitMicros) > BigInt(b.score.profitMicros) ? -1 :
          BigInt(a.score.profitMicros) < BigInt(b.score.profitMicros) ? 1 : a.traceHash < b.traceHash ? -1 : a.traceHash > b.traceHash ? 1 : 0);
        if (findings.length > limits.maxFindings) findings.pop();
      }
      if (!trace.steps.at(-1)?.accepted) rejectedActions++;
      else if (actions.length < limits.maxDepth) visit(actions);
      if (truncated) return;
    }
  };
  visit([]);
  const core = { schemaVersion: 1, engineVersion: "escrow-search.v1", modelHash: hashCanonical(model),
    initialStateHash: hashCanonical(state), scenarioHash: hashCanonical(scenario), limits, grammar, findings,
    coverage: { visitedNodes, rejectedActions, adverseTraces, omittedFindings: adverseTraces - findings.length, truncated,
      limitation: "Only declared fixed-price orders, one supplied coalition, deposit/release/refund and the stated depth/node limits. No amount sampling, timing, dispute, admin or arbitrary-code actions. Model replay is not program execution." } };
  return { ...core, searchHash: hashCanonical(core) };
}
