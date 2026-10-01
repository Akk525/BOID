import { hashCanonical } from "./canonical.ts";
import { hashEconomicModel, parseEconomicModel, parseEconomicState, parsePurchaseAction } from "./model.ts";
import type { EconomicModel, EconomicState, PurchaseAction } from "./model.ts";
import { searchStrategies } from "./search.ts";
import type { SearchConfig, SearchResult } from "./search.ts";
import { step } from "./step.ts";
import type { JournalEntry } from "./step.ts";
import { runStrategy } from "./strategy.ts";

type RunSummary = {
  modelHash: string;
  initialStateHash: string;
  searchHash: string;
  runHash: string;
  positiveFindings: number;
  coverage: SearchResult["coverage"];
};
type ComparisonCore = {
  schemaVersion: 1;
  baseline: RunSummary;
  repair: RunSummary;
  identicalBudget: boolean;
  budget: SearchConfig;
  affiliateRules: { baseline: string[]; repair: string[] };
  referencePurchase: {
    action: PurchaseAction;
    baselineJournal: JournalEntry[];
    repairJournal: JournalEntry[];
    baselineAffiliateAwardMicros: string;
    repairAffiliateAwardMicros: string;
  };
  witness?: {
    actions: PurchaseAction[];
    baselineTraceHash: string;
    repairTraceHash: string;
    baselineProfitMicros: string;
    repairProfitMicros: string;
  };
  noPositiveRepairWithinBudget: boolean;
  limitations: string[];
};
export type MechanismComparison = ComparisonCore & { comparisonHash: string };

function summary(result: SearchResult): RunSummary {
  return {
    modelHash: result.modelHash, searchHash: result.searchHash,
    initialStateHash: result.initialStateHash,
    runHash: hashCanonical(result), positiveFindings: result.findings.length,
    coverage: result.coverage,
  };
}

function affiliateAward(journal: JournalEntry[], model: EconomicModel): string {
  const treasuries = new Set(model.actors.filter((actor) =>
    actor.roles.includes("campaignTreasury")).map((actor) => actor.id));
  const affiliates = new Set(model.actors.filter((actor) =>
    actor.roles.includes("affiliate")).map((actor) => actor.id));
  return journal.reduce((sum, entry) => sum +
    (treasuries.has(entry.from) && affiliates.has(entry.to) ? BigInt(entry.amountMicros) : 0n), 0n).toString();
}

function affiliateRules(model: EconomicModel): string[] {
  return model.actions.purchase.transfers.filter((rule) =>
    rule.from === "campaignTreasury" && rule.to === "affiliate").map((rule) => {
    if (rule.amount.op === "fixed") {
      const parameter = model.parameters[rule.amount.parameter];
      return `${rule.id}: fixed ${parameter?.kind === "money" ? usdc(parameter.value) : "invalid parameter"}`;
    }
    if (rule.amount.op === "share") {
      const parameter = model.parameters[rule.amount.rate.parameter];
      const rate = parameter?.kind === "rate" ? (typeof parameter.value === "string"
        ? parameter.value : `${parameter.value.numerator}/${parameter.value.denominator}`) : "invalid parameter";
      const basis = typeof rule.amount.basis === "string" ? "purchase amount" : `collected ${rule.amount.basis.rule}`;
      return `${rule.id}: ${rate} × ${basis}`;
    }
    return `${rule.id}: purchase remainder`;
  });
}

/** Compare two mechanisms with one state, configuration, and reference purchase. */
export function compareMechanisms(
  inputState: EconomicState, inputBaseline: EconomicModel, inputRepair: EconomicModel,
  inputConfig: SearchConfig, inputReferencePurchase: PurchaseAction,
): MechanismComparison {
  const state = parseEconomicState(inputState);
  const baselineModel = parseEconomicModel(inputBaseline);
  const repairModel = parseEconomicModel(inputRepair);
  const action = parsePurchaseAction(inputReferencePurchase);
  const baseline = searchStrategies(state, baselineModel, inputConfig);
  const repair = searchStrategies(state, repairModel, inputConfig);
  const identicalBudget = hashCanonical(baseline.config) === hashCanonical(repair.config) &&
    baseline.initialStateHash === repair.initialStateHash;
  if (!identicalBudget) throw new Error("Comparison inputs changed the search budget or initial state");
  if (hashEconomicModel(baselineModel) === hashEconomicModel(repairModel)) {
    throw new Error("Comparison requires distinct mechanism model hashes");
  }
  const before = step(state, action, baselineModel);
  const after = step(state, action, repairModel);
  if (!before.ok || !after.ok) {
    throw new Error(`Reference purchase must succeed in both models: ${JSON.stringify([
      ...(before.ok ? [] : before.diagnostics), ...(after.ok ? [] : after.diagnostics),
    ])}`);
  }
  const core: ComparisonCore = {
    schemaVersion: 1, baseline: summary(baseline), repair: summary(repair), identicalBudget,
    budget: baseline.config,
    affiliateRules: { baseline: affiliateRules(baselineModel), repair: affiliateRules(repairModel) },
    referencePurchase: {
      action, baselineJournal: before.journal, repairJournal: after.journal,
      baselineAffiliateAwardMicros: affiliateAward(before.journal, baselineModel),
      repairAffiliateAwardMicros: affiliateAward(after.journal, repairModel),
    },
    noPositiveRepairWithinBudget: !repair.coverage.truncated && repair.findings.length === 0,
    limitations: [
      "The comparison is conditional on the declared source models, coalition costs, identity control, and finite search grammar.",
      "The reference purchase represents an unrelated buyer, creator, and affiliate only by assumption; account names do not prove independence.",
      "No positive repair finding means none was found in the stated budget, not that no possible strategy exists.",
    ],
  };
  const best = baseline.findings[0];
  if (best) {
    const repairedTrace = runStrategy(state, best.trace.actions, repairModel, best.trace.scenario);
    core.witness = {
      actions: best.trace.actions,
      baselineTraceHash: best.traceHash, repairTraceHash: hashCanonical(repairedTrace),
      baselineProfitMicros: best.trace.score.profitMicros,
      repairProfitMicros: repairedTrace.score.profitMicros,
    };
  }
  return { ...core, comparisonHash: hashCanonical(core) };
}

function usdc(micros: string): string {
  const amount = BigInt(micros);
  const absolute = amount < 0n ? -amount : amount;
  return `${amount < 0n ? "-" : ""}${absolute / 1_000_000n}.${(absolute % 1_000_000n).toString().padStart(6, "0")} USDC`;
}

export function renderComparison(comparison: MechanismComparison): string {
  const lines = [
    "Boid mechanism comparison (conditional)",
    `Baseline model: ${comparison.baseline.modelHash}; search: ${comparison.baseline.searchHash}; run: ${comparison.baseline.runHash}`,
    `Repair model: ${comparison.repair.modelHash}; search: ${comparison.repair.searchHash}; run: ${comparison.repair.runHash}`,
    `Comparison hash: ${comparison.comparisonHash}`,
    `Identical search budget and initial state: ${comparison.identicalBudget}`,
    `Search budget: ${comparison.budget.limits.maxNodes} nodes, depth ${comparison.budget.limits.maxDepth}, ${comparison.budget.limits.maxAccounts} accounts, ${usdc(comparison.budget.limits.maxPurchaseVolumeMicros)} cumulative volume; amount range ${usdc(comparison.budget.amounts.minMicros)} to ${usdc(comparison.budget.amounts.maxMicros)}.`,
    `Affiliate amount: ${comparison.affiliateRules.baseline.join("; ")} → ${comparison.affiliateRules.repair.join("; ")}.`,
  ];
  if (comparison.witness) {
    lines.push(`Baseline best strategy: ${comparison.witness.actions.map((action) => usdc(action.amountMicros)).join(" + ")} purchases.`);
    lines.push(`Coalition profit: ${usdc(comparison.witness.baselineProfitMicros)} → ${usdc(comparison.witness.repairProfitMicros)}.`);
    lines.push(`Witness traces: ${comparison.witness.baselineTraceHash} → ${comparison.witness.repairTraceHash}`);
  }
  lines.push(`Reference purchase affiliate award: ${usdc(comparison.referencePurchase.baselineAffiliateAwardMicros)} → ${usdc(comparison.referencePurchase.repairAffiliateAwardMicros)}.`);
  lines.push(`Repair search: ${comparison.repair.positiveFindings} retained positive findings; ${comparison.repair.coverage.visitedNodes} nodes; ${comparison.repair.coverage.stopReason}${comparison.repair.coverage.truncated ? " (truncated)" : ""}.`);
  lines.push(`No positive repair strategy within budget: ${comparison.noPositiveRepairWithinBudget}`);
  lines.push(...comparison.limitations.map((limitation) => `Condition: ${limitation}`));
  return lines.join("\n") + "\n";
}
