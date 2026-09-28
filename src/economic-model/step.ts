import {
  EconomicModelValidationError,
  parseEconomicModel,
  parseEconomicState,
  parsePurchaseAction,
} from "./model.ts";
import type {
  EconomicModel, EconomicState, ModelDiagnostic, PurchaseAction,
} from "./model.ts";

type Role = EconomicModel["actors"][number]["roles"][number];
type TransferRule = EconomicModel["actions"]["purchase"]["transfers"][number];
type Predicate = NonNullable<TransferRule["when"]>;
type Rate = Extract<EconomicModel["parameters"][string], { kind: "rate" }>["value"];
type Bindings = Record<Role, string | undefined>;

export const STEP_ENGINE_VERSION = "purchase-step.v1";

export type JournalEntry = {
  ruleId: string;
  asset: "USDC";
  from: string;
  to: string;
  amountMicros: string;
  evidence: string[];
};
export type PredicateEvaluation = { path: string; op: Predicate["op"]; result: boolean };
export type RuleEvaluation = {
  ruleId: string;
  eligible: boolean;
  predicates: PredicateEvaluation[];
};
export type StepResult =
  | { ok: true; state: EconomicState; journal: JournalEntry[]; evaluations: RuleEvaluation[] }
  | { ok: false; diagnostics: ModelDiagnostic[]; journal: []; evaluations: RuleEvaluation[] };

function reject(diagnostics: ModelDiagnostic[], evaluations: RuleEvaluation[] = []): StepResult {
  return { ok: false, diagnostics, journal: [], evaluations };
}

function parseInput<T>(label: string, parse: (input: unknown) => T, input: unknown): T {
  try {
    return parse(input);
  } catch (error) {
    if (!(error instanceof EconomicModelValidationError)) throw error;
    throw new EconomicModelValidationError(error.diagnostics.map((item) => ({
      path: `${label}.${item.path}`, message: item.message,
    })));
  }
}

function moneyParameter(model: EconomicModel, id: string): bigint {
  const parameter = model.parameters[id];
  if (!parameter || parameter.kind !== "money") {
    throw new Error(`Validated model lost money parameter ${id}`);
  }
  return BigInt(parameter.value);
}

function rateRatio(value: Rate): [bigint, bigint] {
  if (typeof value !== "string") return [BigInt(value.numerator), BigInt(value.denominator)];
  const [whole = "0", fraction = ""] = value.split(".");
  return [BigInt(whole + fraction), 10n ** BigInt(fraction.length)];
}

function purchaseCount(state: EconomicState, buyer: string): number {
  return Object.hasOwn(state.completedPurchases, buyer)
    ? state.completedPurchases[buyer] ?? 0 : 0;
}

function evaluate(
  predicate: Predicate, path: string, state: EconomicState,
  action: PurchaseAction, model: EconomicModel,
): { result: boolean; trace: PredicateEvaluation[] } {
  let result: boolean;
  let children: PredicateEvaluation[] = [];
  switch (predicate.op) {
    case "and": {
      // Evaluate every child for an inspectable trace, using only pre-action state.
      const outcomes = predicate.all.map((child, index) =>
        evaluate(child, `${path}.all.${index}`, state, action, model));
      result = outcomes.every((outcome) => outcome.result);
      children = outcomes.flatMap((outcome) => outcome.trace);
      break;
    }
    case "gte":
      result = BigInt(action.amountMicros) >= moneyParameter(model, predicate.right.parameter);
      break;
    case "eq":
      result = purchaseCount(state, action.buyer) === 0;
      break;
    case "present":
      result = action.affiliate !== undefined;
      break;
    case "differentAccount":
      result = action.affiliate !== undefined && action.buyer !== action.affiliate;
      break;
  }
  return { result, trace: [{ path, op: predicate.op, result }, ...children] };
}

function amountFor(
  rule: TransferRule, price: bigint, model: EconomicModel, amounts: Map<string, bigint>,
): bigint {
  switch (rule.amount.op) {
    case "fixed":
      return moneyParameter(model, rule.amount.parameter);
    case "share": {
      const parameter = model.parameters[rule.amount.rate.parameter];
      if (!parameter || parameter.kind !== "rate") {
        throw new Error("Validated model lost rate parameter");
      }
      const [numerator, denominator] = rateRatio(parameter.value);
      return price * numerator / denominator;
    }
    case "remainder": {
      const deducted = amounts.get(rule.amount.minusRule);
      if (deducted === undefined) throw new Error("Validated model lost preceding share");
      return price - deducted;
    }
  }
}

/**
 * Apply one purchase atomically. Input objects are never mutated.
 * A rejected action exposes no tentative state or transfer journal.
 */
export function step(
  inputState: EconomicState, inputPurchase: PurchaseAction, inputModel: EconomicModel,
): StepResult {
  let state: EconomicState;
  let action: PurchaseAction;
  let model: EconomicModel;
  try {
    model = parseInput("model", parseEconomicModel, inputModel);
    state = parseInput("state", parseEconomicState, inputState);
    action = parseInput("purchase", parsePurchaseAction, inputPurchase);
  } catch (error) {
    if (!(error instanceof EconomicModelValidationError)) throw error;
    return reject(error.diagnostics);
  }

  const diagnostics: ModelDiagnostic[] = [];
  const add = (path: string, message: string) => diagnostics.push({ path, message });
  const actors = new Map(model.actors.map((actor) => [actor.id, actor]));
  const bindings: Bindings = {
    buyer: action.buyer, creator: action.creator, affiliate: action.affiliate,
    platform: undefined, campaignTreasury: undefined,
  };
  for (const role of ["buyer", "creator", "affiliate"] as const) {
    const id = bindings[role];
    if (id === undefined) continue;
    if (!actors.get(id)?.roles.includes(role)) {
      add(`purchase.${role}`, `actor ${id} does not have the ${role} role`);
    }
  }
  for (const role of ["platform", "campaignTreasury"] as const) {
    const candidates = model.actors.filter((actor) => actor.roles.includes(role));
    if (candidates.length !== 1) add(`model.actors`, `${role} must resolve to exactly one account`);
    else bindings[role] = candidates[0]?.id;
  }
  for (const id of new Set(Object.values(bindings))) {
    if (id !== undefined && !Object.hasOwn(state.balances, id)) {
      add(`state.balances.${id}`, `missing balance for account ${id}`);
    }
  }
  if (action.buyer === action.creator) {
    add("purchase.creator", "buyer and creator accounts must differ");
  }
  const priorPurchases = purchaseCount(state, action.buyer);
  if (!Number.isSafeInteger(priorPurchases + 1) || !Number.isSafeInteger(state.tick + 1)) {
    add("state", "purchase count and tick must remain safe integers");
  }
  if (diagnostics.length) return reject(diagnostics);

  const price = BigInt(action.amountMicros);
  const balances = new Map(Object.entries(state.balances).map(([id, value]) => [id, BigInt(value)]));
  if ((balances.get(action.buyer) ?? 0n) < price) {
    return reject([{ path: `state.balances.${action.buyer}`, message: `insufficient funds in ${action.buyer} for purchase` }]);
  }

  const journal: JournalEntry[] = [];
  const evaluations: RuleEvaluation[] = [];
  const amounts = new Map<string, bigint>();
  for (const [index, rule] of model.actions.purchase.transfers.entries()) {
    const path = `model.actions.purchase.transfers.${index}`;
    const outcome = rule.when
      ? evaluate(rule.when, `${path}.when`, state, action, model)
      : { result: true, trace: [] };
    evaluations.push({ ruleId: rule.id, eligible: outcome.result, predicates: outcome.trace });
    if (!outcome.result) {
      amounts.set(rule.id, 0n);
      continue;
    }
    const from = bindings[rule.from];
    const to = bindings[rule.to];
    if (from === undefined || to === undefined) {
      return reject([{ path, message: `eligible transfer ${rule.id} has an absent account` }], evaluations);
    }
    const amount = amountFor(rule, price, model, amounts);
    const available = balances.get(from) ?? 0n;
    if (amount < 0n || available < amount) {
      return reject([{ path, message: `insufficient funds in ${from} for ${rule.id}` }], evaluations);
    }
    balances.set(from, available - amount);
    balances.set(to, (balances.get(to) ?? 0n) + amount);
    amounts.set(rule.id, amount);
    journal.push({
      ruleId: rule.id, asset: "USDC", from, to, amountMicros: amount.toString(),
      evidence: [...rule.evidence],
    });
  }

  try {
    const nextState = parseInput("nextState", parseEconomicState, {
      balances: Object.fromEntries([...balances].map(([id, value]) => [id, value.toString()])),
      completedPurchases: { ...state.completedPurchases, [action.buyer]: priorPurchases + 1 },
      tick: state.tick + 1,
    });
    return { ok: true, state: nextState, journal, evaluations };
  } catch (error) {
    if (!(error instanceof EconomicModelValidationError)) throw error;
    return reject(error.diagnostics, evaluations);
  }
}
