import { canonicalJson, hashCanonical } from "./canonical.ts";
import { compareMechanisms } from "./compare.ts";
import type { MechanismComparison } from "./compare.ts";
import { buildFindingReport } from "./finding.ts";
import { hashEconomicModel, parseEconomicModel } from "./model.ts";
import type { EconomicModel, EconomicState } from "./model.ts";
import type { PopulationScenario } from "./scenario.ts";
import { searchStrategies } from "./search.ts";
import type { SearchResult } from "./search.ts";
import { sweepSensitivity } from "./sensitivity.ts";
import type { SensitivityResult } from "./sensitivity.ts";
import { step } from "./step.ts";
import type { JournalEntry } from "./step.ts";
import { replayStrategy, runStrategy } from "./strategy.ts";

export type RecommendationBundle = {
  baselineModel: EconomicModel;
  repairModel: EconomicModel;
  populationModel: EconomicModel;
  search: SearchResult;
  comparison: MechanismComparison;
  sensitivity: SensitivityResult;
  populationInput: { initialState: EconomicState; scenario: PopulationScenario };
};
type BundleArtifact = "baselineModel" | "repairModel" | "search" | "comparison" | "sensitivity";
type Reference = { artifact: BundleArtifact; path: string; valueHash: string };
type NumericFact = { label: string; amountMicros: string; references: Reference[] };
type Claim = {
  id: string;
  text: string;
  confidence: "pinned_source" | "replayed_conditional" | "scenario_conditional" | "unknown_real_world";
  references: Reference[];
  numericFacts: NumericFact[];
  unknowns: string[];
};
type RecommendationCore = {
  schemaVersion: 1;
  baselineModelHash: string;
  repairModelHash: string;
  searchRunHash: string;
  comparisonHash: string;
  sensitivityHash: string;
  recommendation: string;
  claims: Claim[];
  unknowns: { id: string; detail: string; references: Reference[] }[];
  limitation: string;
};
export type RecommendationArtifact = RecommendationCore & { recommendationHash: string };

function requireCondition(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function atPath(value: unknown, path: string): unknown {
  let current: unknown = value;
  for (const part of path.split(".")) {
    if (current === null || typeof current !== "object" || !Object.hasOwn(current, part)) {
      throw new Error(`Missing evidence item: ${path}`);
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function reference(bundle: RecommendationBundle, artifact: BundleArtifact, path: string): Reference {
  return { artifact, path, valueHash: hashCanonical(atPath(bundle[artifact], path)) };
}

function fact(label: string, amountMicros: string, references: Reference[]): NumericFact {
  return { label, amountMicros, references };
}

function usdc(micros: string): string {
  const amount = BigInt(micros);
  const absolute = amount < 0n ? -amount : amount;
  return `${amount < 0n ? "-" : ""}${absolute / 1_000_000n}.${(absolute % 1_000_000n).toString().padStart(6, "0")} USDC`;
}

function predicateHas(value: unknown, match: (item: Record<string, unknown>) => boolean): boolean {
  if (value === null || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return match(item) || (item.op === "and" && Array.isArray(item.all) &&
    item.all.some((child) => predicateHas(child, match)));
}

function thresholdParameter(value: unknown): string | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const item = value as Record<string, unknown>;
  if (item.op === "gte" && item.left === "purchase.amount" && item.right &&
    typeof item.right === "object" && typeof (item.right as Record<string, unknown>).parameter === "string") {
    return (item.right as { parameter: string }).parameter;
  }
  if (item.op === "and" && Array.isArray(item.all)) {
    for (const child of item.all) {
      const parameter = thresholdParameter(child);
      if (parameter) return parameter;
    }
  }
  return undefined;
}

function affiliateAward(journal: JournalEntry[], model: EconomicModel): string {
  const treasury = new Set(model.actors.filter((actor) => actor.roles.includes("campaignTreasury")).map((actor) => actor.id));
  const affiliates = new Set(model.actors.filter((actor) => actor.roles.includes("affiliate")).map((actor) => actor.id));
  return journal.reduce((sum, entry) => sum +
    (treasury.has(entry.from) && affiliates.has(entry.to) ? BigInt(entry.amountMicros) : 0n), 0n).toString();
}

/** Validate all supporting artifacts before generating any claim text. */
function validateBundle(bundle: RecommendationBundle): void {
  const baseline = parseEconomicModel(bundle.baselineModel);
  const repair = parseEconomicModel(bundle.repairModel);
  const population = parseEconomicModel(bundle.populationModel);
  const mechanismFields = (model: EconomicModel) => ({
    source: model.source, evidence: model.evidence, parameters: model.parameters,
    actions: model.actions, constraints: model.constraints, objectives: model.objectives,
  });
  requireCondition(hashCanonical(mechanismFields(baseline)) === hashCanonical(mechanismFields(population)),
    "Population model must retain the baseline mechanism and source evidence");
  const baselineHash = hashEconomicModel(baseline);
  const repairHash = hashEconomicModel(repair);
  requireCondition(bundle.search.modelHash === baselineHash, "Search model hash differs from baseline model");
  requireCondition(bundle.comparison.baseline.modelHash === baselineHash &&
    bundle.comparison.repair.modelHash === repairHash, "Comparison model hashes differ from supplied models");
  requireCondition(bundle.comparison.baseline.runHash === hashCanonical(bundle.search),
    "Comparison does not reference the supplied search run");
  const { comparisonHash, ...comparisonCore } = bundle.comparison;
  requireCondition(comparisonHash === hashCanonical(comparisonCore), "Comparison hash is invalid");
  requireCondition(bundle.comparison.identicalBudget &&
    hashCanonical(bundle.comparison.budget) === hashCanonical(bundle.search.config),
  "Comparison must use the search budget");
  requireCondition(bundle.comparison.noPositiveRepairWithinBudget ===
    (!bundle.comparison.repair.coverage.truncated && bundle.comparison.repair.positiveFindings === 0),
  "Repair coverage claim differs from comparison metrics");

  const best = bundle.search.findings[0];
  requireCondition(best, "Recommendation requires a retained positive search finding");
  requireCondition(bundle.comparison.baseline.initialStateHash === bundle.search.initialStateHash &&
    bundle.comparison.repair.initialStateHash === bundle.search.initialStateHash,
  "Comparison and search must start from the same state");
  const repeatedSearch = searchStrategies(best.trace.initialState, baseline, bundle.search.config);
  requireCondition(canonicalJson(repeatedSearch) === canonicalJson(bundle.search),
    "Search results differ from deterministic rerun");
  requireCondition(best.traceHash === hashCanonical(best.trace), "Finding trace hash is invalid");
  const replay = replayStrategy(best.trace, baseline);
  requireCondition(replay.ok, "Finding trace does not replay against baseline model");
  const report = buildFindingReport(baseline, bundle.search);
  requireCondition(report.best?.profitMicros === best.trace.score.profitMicros,
    "Finding profit does not reconcile with its journal and costs");
  const witness = bundle.comparison.witness;
  requireCondition(witness && witness.baselineTraceHash === best.traceHash &&
    witness.baselineProfitMicros === best.trace.score.profitMicros &&
    canonicalJson(witness.actions) === canonicalJson(best.trace.actions),
  "Comparison witness differs from the search finding");
  const repairedTrace = runStrategy(best.trace.initialState, best.trace.actions, repair, best.trace.scenario);
  requireCondition(witness.repairTraceHash === hashCanonical(repairedTrace) &&
    witness.repairProfitMicros === repairedTrace.score.profitMicros,
  "Comparison repair witness does not replay");
  const action = bundle.comparison.referencePurchase.action;
  const repeatedComparison = compareMechanisms(best.trace.initialState, baseline, repair,
    bundle.search.config, action);
  requireCondition(canonicalJson(repeatedComparison) === canonicalJson(bundle.comparison),
    "Comparison differs from deterministic rerun");
  const before = step(best.trace.initialState, action, baseline);
  const after = step(best.trace.initialState, action, repair);
  requireCondition(before.ok && after.ok, "Comparison reference purchase must succeed in both models");
  requireCondition(canonicalJson(before.journal) === canonicalJson(bundle.comparison.referencePurchase.baselineJournal) &&
    canonicalJson(after.journal) === canonicalJson(bundle.comparison.referencePurchase.repairJournal) &&
    affiliateAward(before.journal, baseline) === bundle.comparison.referencePurchase.baselineAffiliateAwardMicros &&
    affiliateAward(after.journal, repair) === bundle.comparison.referencePurchase.repairAffiliateAwardMicros,
  "Comparison reference awards differ from the shared transition");

  requireCondition(bundle.sensitivity.modelHash === hashEconomicModel(population),
    "Sensitivity model hash differs from population model");
  const replayedSweep = sweepSensitivity(bundle.populationInput.initialState, population,
    bundle.populationInput.scenario, bundle.sensitivity.grid);
  requireCondition(canonicalJson(replayedSweep) === canonicalJson(bundle.sensitivity),
    "Sensitivity results differ from paired scenario replay");
}

/** Build a fixed, numeric-checked recommendation from a locked result bundle. */
export function buildRecommendation(bundle: RecommendationBundle): RecommendationArtifact {
  validateBundle(bundle);
  const model = bundle.baselineModel;
  const best = bundle.search.findings[0]!;
  const witness = bundle.comparison.witness!;
  const ruleIndex = model.actions.purchase.transfers.findIndex((rule) =>
    rule.from === "campaignTreasury" && rule.to === "affiliate" && rule.amount.op === "fixed");
  requireCondition(ruleIndex >= 0, "Expected a fixed treasury-funded affiliate rule");
  const rule = model.actions.purchase.transfers[ruleIndex]!;
  requireCondition(rule.amount.op === "fixed", "Expected a fixed affiliate amount");
  const bonusId = rule.amount.parameter;
  const minimumId = thresholdParameter(rule.when);
  requireCondition(minimumId && predicateHas(rule.when, (item) => item.op === "eq" &&
    item.left === "buyer.completedPurchases" && item.right === 0),
  "Expected a first-purchase minimum-amount predicate");
  const bonus = model.parameters[bonusId];
  const minimum = model.parameters[minimumId];
  requireCondition(bonus?.kind === "money" && minimum?.kind === "money" &&
    rule.evidence.includes(bonus.evidence) && rule.evidence.includes(minimum.evidence),
  "Affiliate facts require cited money parameters and rule evidence");
  const sourceRefs = [
    reference(bundle, "baselineModel", `actions.purchase.transfers.${ruleIndex}`),
    reference(bundle, "baselineModel", `parameters.${bonusId}`),
    reference(bundle, "baselineModel", `parameters.${minimumId}`),
    reference(bundle, "baselineModel", `evidence.${bonus.evidence}`),
    reference(bundle, "baselineModel", `evidence.${minimum.evidence}`),
    ...rule.evidence.filter((id) => id !== bonus.evidence && id !== minimum.evidence)
      .map((id) => reference(bundle, "baselineModel", `evidence.${id}`)),
  ];
  const firstAction = best.trace.actions[0];
  requireCondition(firstAction, "Finding must contain a purchase action");
  const buyerIndex = best.trace.scenario.controlledIdentities.findIndex((identity) => identity.accountId === firstAction.buyer);
  requireCondition(buyerIndex >= 0, "Finding buyer must have an explicit cost assumption");
  const buyerCost = best.trace.scenario.controlledIdentities[buyerIndex]!.identityCost.amountMicros;
  const transactionCost = best.trace.scenario.transactionCost.amountMicros;
  const searchRefs = [
    reference(bundle, "search", "findings.0.trace.actions.0.amountMicros"),
    reference(bundle, "search", "findings.0.trace.score.profitMicros"),
    reference(bundle, "search", "findings.0.treasuryDrainMicros"),
    reference(bundle, "search", `findings.0.trace.scenario.controlledIdentities.${buyerIndex}.identityCost`),
    reference(bundle, "search", "findings.0.trace.scenario.transactionCost"),
    reference(bundle, "search", "coverage"),
  ];
  const repairRuleIndex = bundle.repairModel.actions.purchase.transfers.findIndex((item) =>
    item.from === "campaignTreasury" && item.to === "affiliate" && item.amount.op === "share");
  requireCondition(repairRuleIndex >= 0, "Expected a fee-funded affiliate repair rule");
  const repairRule = bundle.repairModel.actions.purchase.transfers[repairRuleIndex]!;
  requireCondition(repairRule.amount.op === "share" && typeof repairRule.amount.basis === "object",
    "Repair affiliate award must use a collected transfer as its basis");
  const repairRateId = repairRule.amount.rate.parameter;
  const repairRate = bundle.repairModel.parameters[repairRateId];
  requireCondition(repairRate?.kind === "rate" && repairRule.evidence.includes(repairRate.evidence),
    "Repair rate requires its declared assumption evidence");
  const comparisonRefs = [
    reference(bundle, "comparison", "witness"),
    reference(bundle, "comparison", "referencePurchase"),
    reference(bundle, "comparison", "repair.coverage"),
    reference(bundle, "comparison", "noPositiveRepairWithinBudget"),
    reference(bundle, "repairModel", `actions.purchase.transfers.${repairRuleIndex}`),
    reference(bundle, "repairModel", `parameters.${repairRateId}`),
    reference(bundle, "repairModel", `evidence.${repairRate.evidence}`),
  ];
  const probeIndex = bundle.sensitivity.firstPurchaseProbes.findIndex((probe) =>
    probe.attackerOrderAmountMicros === firstAction.amountMicros && probe.accepted);
  requireCondition(probeIndex >= 0, "Sensitivity sweep needs an accepted probe for the finding amount");
  const probe = bundle.sensitivity.firstPurchaseProbes[probeIndex]!;
  const lowCost = "150000";
  const controlCost = "500000";
  requireCondition(bundle.sensitivity.grid.identityCostsMicros.includes(lowCost) &&
    bundle.sensitivity.grid.identityCostsMicros.includes(controlCost) && buyerCost === lowCost &&
    probe.breakEvenIdentityCostMicros !== null,
  "Sensitivity sweep must include the 0.15 and 0.50 USDC cost controls linked to the finding");
  const lowProfit = (BigInt(probe.breakEvenIdentityCostMicros) - BigInt(lowCost)).toString();
  const controlProfit = (BigInt(probe.breakEvenIdentityCostMicros) - BigInt(controlCost)).toString();
  requireCondition(best.trace.actions.length === 1 && lowProfit === best.trace.score.profitMicros,
    "Isolated sensitivity probe must agree with the one-purchase search finding");
  const sensitivityRefs = [
    reference(bundle, "sensitivity", `firstPurchaseProbes.${probeIndex}`),
    reference(bundle, "sensitivity", "grid.identityCostsMicros"),
    reference(bundle, "sensitivity", "grid.seeds"),
    reference(bundle, "sensitivity", "limitations"),
  ];
  const repairSearchConclusion = bundle.comparison.noPositiveRepairWithinBudget
    ? "No positive repair trace was found within the declared search budget."
    : bundle.comparison.repair.positiveFindings > 0
      ? "The repair search retains positive traces within the declared budget."
      : "The repair search was truncated, so it cannot support an absence claim.";
  const unknowns: RecommendationCore["unknowns"] = [
    { id: "identity-cost", detail: "Actual identity acquisition cost is unmeasured; the 0.15 and 0.50 USDC values are declared assumptions.",
      references: [searchRefs[3]!, sensitivityRefs[1]!] },
    { id: "demand-mix", detail: "Arrival rates, order sizes, and attacker share are scenario inputs, not observed demand or confidence intervals.",
      references: [reference(bundle, "sensitivity", "grid"), sensitivityRefs[3]!] },
    { id: "common-control", detail: "Account names do not establish that one real actor controls the buyer, creator, and affiliate.",
      references: [reference(bundle, "search", "findings.0.trace.scenario.controlledIdentities")] },
  ];
  const claims: Claim[] = [
    {
      id: "source-rule",
      text: `The pinned source model pays ${usdc(bonus.value)} from the campaign treasury on a buyer's first eligible affiliate purchase of at least ${usdc(minimum.value)}.`,
      confidence: "pinned_source", references: sourceRefs,
      numericFacts: [fact("affiliate award", bonus.value, [sourceRefs[1]!, sourceRefs[3]!]),
        fact("minimum purchase", minimum.value, [sourceRefs[2]!, sourceRefs[4]!])],
      unknowns: [],
    },
    {
      id: "search-finding",
      text: `Within the declared search budget, a strategy beginning with a ${usdc(firstAction.amountMicros)} purchase earns ${usdc(best.trace.score.profitMicros)} coalition profit and drains ${usdc(best.treasuryDrainMicros)} from the treasury under ${usdc(buyerCost)} buyer identity cost and ${usdc(transactionCost)} per-attempt cost.`,
      confidence: "replayed_conditional", references: searchRefs,
      numericFacts: [
        fact("purchase amount", firstAction.amountMicros, [searchRefs[0]!]),
        fact("coalition profit", best.trace.score.profitMicros, [searchRefs[1]!]),
        fact("treasury drain", best.treasuryDrainMicros, [searchRefs[2]!]),
        fact("buyer identity cost", buyerCost, [searchRefs[3]!]),
        fact("transaction cost", transactionCost, [searchRefs[4]!]),
      ],
      unknowns: ["identity-cost", "common-control"],
    },
    {
      id: "repair-tradeoff",
      text: `For the same search trace, the tested fee-funded repair changes coalition profit from ${usdc(witness.baselineProfitMicros)} to ${usdc(witness.repairProfitMicros)}. On the ${usdc(bundle.comparison.referencePurchase.action.amountMicros)} reference purchase, the affiliate award changes from ${usdc(bundle.comparison.referencePurchase.baselineAffiliateAwardMicros)} to ${usdc(bundle.comparison.referencePurchase.repairAffiliateAwardMicros)}. ${repairSearchConclusion}`,
      confidence: "replayed_conditional", references: comparisonRefs,
      numericFacts: [
        fact("baseline witness profit", witness.baselineProfitMicros, [comparisonRefs[0]!]),
        fact("repair witness profit", witness.repairProfitMicros, [comparisonRefs[0]!]),
        fact("reference purchase", bundle.comparison.referencePurchase.action.amountMicros, [comparisonRefs[1]!]),
        fact("baseline affiliate award", bundle.comparison.referencePurchase.baselineAffiliateAwardMicros, [comparisonRefs[1]!]),
        fact("repair affiliate award", bundle.comparison.referencePurchase.repairAffiliateAwardMicros, [comparisonRefs[1]!]),
      ],
      unknowns: ["identity-cost", "common-control"],
    },
    {
      id: "cost-sensitivity",
      text: `For an isolated first ${usdc(firstAction.amountMicros)} purchase, the break-even identity cost is ${usdc(probe.breakEvenIdentityCostMicros)}. Profit is ${usdc(lowProfit)} at the assumed ${usdc(lowCost)} cost and ${usdc(controlProfit)} at the ${usdc(controlCost)} control, with the same transaction cost.`,
      confidence: "scenario_conditional", references: sensitivityRefs,
      numericFacts: [
        fact("purchase amount", firstAction.amountMicros, [sensitivityRefs[0]!]),
        fact("break-even identity cost", probe.breakEvenIdentityCostMicros, [sensitivityRefs[0]!]),
        fact("low identity cost", lowCost, [sensitivityRefs[1]!]),
        fact("low-cost profit", lowProfit, [sensitivityRefs[0]!, sensitivityRefs[1]!]),
        fact("control identity cost", controlCost, [sensitivityRefs[1]!]),
        fact("control profit", controlProfit, [sensitivityRefs[0]!, sensitivityRefs[1]!]),
      ],
      unknowns: ["identity-cost", "demand-mix", "common-control"],
    },
    {
      id: "scope",
      text: "The tested repair is a candidate for human review under these inputs. Its fee share is not established as globally optimal, and the scenario grid is not a forecast of real activity.",
      confidence: "unknown_real_world", references: [comparisonRefs[4]!, sensitivityRefs[3]!],
      numericFacts: [], unknowns: ["identity-cost", "demand-mix", "common-control"],
    },
  ];
  const core: RecommendationCore = {
    schemaVersion: 1, baselineModelHash: hashEconomicModel(model), repairModelHash: hashEconomicModel(bundle.repairModel),
    searchRunHash: hashCanonical(bundle.search), comparisonHash: bundle.comparison.comparisonHash,
    sensitivityHash: bundle.sensitivity.sweepHash,
    recommendation: "Review the tested fee-funded affiliate repair alongside its smaller honest referral award and verify external cost and population assumptions before applying it.",
    claims, unknowns,
    limitation: "This artifact validates lineage and arithmetic for conditional model runs; it does not verify actual identity control, external costs, demand, or global optimality.",
  };
  return { ...core, recommendationHash: hashCanonical(core) };
}

export function validateRecommendation(candidate: unknown, bundle: RecommendationBundle):
  { ok: true } | { ok: false; reason: string } {
  try {
    const expected = buildRecommendation(bundle);
    if (canonicalJson(candidate) !== canonicalJson(expected)) {
      return { ok: false, reason: "Recommendation claims, references, or hash differ from the locked result bundle" };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

export function renderRecommendation(artifact: RecommendationArtifact): string {
  const lines = [
    "Boid recommendation (conditional)",
    `Recommendation hash: ${artifact.recommendationHash}`,
    `Baseline ${artifact.baselineModelHash}; repair ${artifact.repairModelHash}; search ${artifact.searchRunHash}; comparison ${artifact.comparisonHash}; sensitivity ${artifact.sensitivityHash}.`,
    artifact.recommendation,
    ...artifact.claims.map((claim) => `${claim.id} [${claim.confidence}]: ${claim.text}`),
    ...artifact.unknowns.map((unknown) => `Unknown ${unknown.id}: ${unknown.detail}`),
    `Condition: ${artifact.limitation}`,
  ];
  return lines.join("\n") + "\n";
}
