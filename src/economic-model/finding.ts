import { hashCanonical } from "./canonical.ts";
import type { EconomicModel } from "./model.ts";
import type { SearchFinding, SearchResult } from "./search.ts";
import type { JournalEntry } from "./step.ts";
import type { ExternalCost } from "./strategy.ts";

type Evidence = EconomicModel["evidence"][string];
type Rule = EconomicModel["actions"]["purchase"]["transfers"][number];
type Term = {
  kind: "journal" | "identityCost" | "transactionCost";
  amountMicros: string;
  source: string;
  evidence: string[] | ExternalCost["evidence"];
};

export type FindingReport = {
  schemaVersion: 1;
  modelHash: string;
  searchHash: string;
  runHash: string;
  source: EconomicModel["source"];
  parameters: { id: string; value: EconomicModel["parameters"][string]["value"]; evidence: { id: string; detail: Evidence } }[];
  rules: { id: string; amount: Rule["amount"]; when?: Rule["when"]; evidence: { id: string; detail: Evidence }[] }[];
  conclusion: "positive" | "noPositiveFinding";
  conditionalOn: string;
  best?: {
    traceHash: string;
    actionTrace: SearchFinding["trace"]["steps"];
    controlledIdentities: string[];
    terms: Term[];
    ledgerDeltaMicros: string;
    profitMicros: string;
    treasuryDrainMicros: string;
  };
  coverage: SearchResult["coverage"];
  budget: SearchResult["config"];
  retainedFindings: number;
};

function evidenceFor(model: EconomicModel, ids: string[]): { id: string; detail: Evidence }[] {
  return ids.map((id) => {
    const detail = model.evidence[id];
    if (!detail) throw new Error(`Missing evidence for ${id}`);
    return { id, detail };
  });
}

function journalTerm(entry: JournalEntry, index: number, controlled: Set<string>): Term | undefined {
  const sign = Number(controlled.has(entry.to)) - Number(controlled.has(entry.from));
  if (sign === 0) return undefined;
  return {
    kind: "journal", amountMicros: (BigInt(entry.amountMicros) * BigInt(sign)).toString(),
    source: `steps.${index}.journal.${entry.ruleId}`, evidence: entry.evidence,
  };
}

/** The report only cites replayable journal entries and declared cost assumptions. */
export function buildFindingReport(model: EconomicModel, search: SearchResult): FindingReport {
  const best = search.findings[0];
  const report: FindingReport = {
    schemaVersion: 1, modelHash: search.modelHash, searchHash: search.searchHash,
    runHash: hashCanonical(search), source: model.source,
    parameters: Object.entries(model.parameters).map(([id, parameter]) => ({
      id, value: parameter.value,
      evidence: evidenceFor(model, [parameter.evidence])[0]!,
    })),
    rules: model.actions.purchase.transfers.map((rule) => ({
      id: rule.id, amount: rule.amount, ...(rule.when ? { when: rule.when } : {}),
      evidence: evidenceFor(model, rule.evidence),
    })),
    conclusion: best ? "positive" : "noPositiveFinding",
    conditionalOn: "The declared model, controlled identities, external costs and bounded search grammar; no real-world identity control or cost is established.",
    coverage: search.coverage, budget: search.config, retainedFindings: search.findings.length,
  };
  if (!best) return report;

  const trace = best.trace;
  const controlled = new Set(trace.scenario.controlledIdentities.map((identity) => identity.accountId));
  const terms: Term[] = trace.steps.flatMap((step, index) =>
    step.journal.map((entry) => journalTerm(entry, index, controlled)).filter((term): term is Term => term !== undefined));
  for (const identity of trace.scenario.controlledIdentities) terms.push({
    kind: "identityCost", amountMicros: (-BigInt(identity.identityCost.amountMicros)).toString(),
    source: `scenario.controlledIdentities.${identity.accountId}.identityCost`,
    evidence: identity.identityCost.evidence,
  });
  for (const [index] of trace.steps.entries()) terms.push({
    kind: "transactionCost", amountMicros: (-BigInt(trace.scenario.transactionCost.amountMicros)).toString(),
    source: `steps.${index}.externalCostMicros`, evidence: trace.scenario.transactionCost.evidence,
  });
  const profit = terms.reduce((sum, term) => sum + BigInt(term.amountMicros), 0n);
  const journalDelta = terms.filter((term) => term.kind === "journal")
    .reduce((sum, term) => sum + BigInt(term.amountMicros), 0n);
  const treasuryAccounts = new Set(model.actors.filter((actor) =>
    actor.roles.includes("campaignTreasury")).map((actor) => actor.id));
  const treasuryDrain = trace.steps.flatMap((step) => step.journal).reduce((sum, entry) =>
    sum + (treasuryAccounts.has(entry.from) ? BigInt(entry.amountMicros) : 0n)
      - (treasuryAccounts.has(entry.to) ? BigInt(entry.amountMicros) : 0n), 0n);
  if (journalDelta.toString() !== trace.score.ledgerDeltaMicros ||
    treasuryDrain.toString() !== best.treasuryDrainMicros) {
    throw new Error("Finding ledger figures differ from replayable journal entries");
  }
  if (profit.toString() !== trace.score.profitMicros) {
    throw new Error("Finding arithmetic differs from replayable trace score");
  }
  report.best = {
    traceHash: best.traceHash, actionTrace: trace.steps,
    controlledIdentities: [...controlled], terms,
    ledgerDeltaMicros: trace.score.ledgerDeltaMicros,
    profitMicros: profit.toString(), treasuryDrainMicros: best.treasuryDrainMicros,
  };
  return report;
}

function usdc(micros: string): string {
  const value = BigInt(micros);
  const absolute = value < 0n ? -value : value;
  return `${value < 0n ? "-" : ""}${absolute / 1_000_000n}.${(absolute % 1_000_000n).toString().padStart(6, "0")} USDC`;
}

export function renderFinding(report: FindingReport): string {
  const lines = [
    "Boid finding (conditional)",
    `Source: ${report.source.repository} @ ${report.source.commit}`,
    `Model hash: ${report.modelHash}`,
    `Search hash: ${report.searchHash}`,
    `Run hash: ${report.runHash}`,
    "Rules and source evidence:",
  ];
  for (const parameter of report.parameters) {
    const source = parameter.evidence.detail.source;
    lines.push(`  ${parameter.id} = ${typeof parameter.value === "string" ? parameter.value : JSON.stringify(parameter.value)} (${parameter.evidence.id}: ${source.type === "repo" ? `${source.path}:${source.startLine}-${source.endLine} @ ${source.commit}` : source.type})`);
  }
  for (const rule of report.rules) {
    lines.push(`  ${rule.id}: ${JSON.stringify(rule.amount)}${rule.when ? ` when ${JSON.stringify(rule.when)}` : ""}`);
    for (const { id, detail } of rule.evidence) {
      const source = detail.source;
      lines.push(`    ${id} (${detail.kind}): ${source.type === "repo" ? `${source.path}:${source.startLine}-${source.endLine} @ ${source.commit}` : source.type}`);
    }
  }
  const { limits, amounts } = report.budget;
  lines.push(`Search budget: ${limits.maxNodes} nodes, depth ${limits.maxDepth}, ${limits.maxAccounts} accounts, ${usdc(limits.maxPurchaseVolumeMicros)} cumulative volume; amount range ${usdc(amounts.minMicros)} to ${usdc(amounts.maxMicros)}.`);
  lines.push(`Coverage: ${report.coverage.visitedNodes} nodes, ${report.coverage.attemptedActions} actions, ${report.coverage.stopReason}${report.coverage.truncated ? " (truncated)" : ""}; ${report.retainedFindings} retained positive findings.`);
  if (!report.best) {
    lines.push("No positive strategy found within this search budget.");
  } else {
    lines.push(`Best strategy controls: ${report.best.controlledIdentities.join(", ")}`);
    for (const [index, step] of report.best.actionTrace.entries()) {
      lines.push(`  Action ${index + 1}: ${step.action.buyer} buys from ${step.action.creator} for ${usdc(step.action.amountMicros)}${step.action.affiliate ? ` with affiliate ${step.action.affiliate}` : ""} (${step.status}).`);
      for (const entry of step.journal) lines.push(`    ${entry.ruleId}: ${entry.from} → ${entry.to} ${usdc(entry.amountMicros)} [${entry.evidence.join(", ")}]`);
    }
    lines.push("Coalition profit arithmetic (signed terms):");
    for (const term of report.best.terms) {
      const evidence = Array.isArray(term.evidence) ? term.evidence.join(", ") : `${term.evidence.kind}: ${term.evidence.notes}`;
      lines.push(`  ${usdc(term.amountMicros)} from ${term.source} [${evidence}]`);
    }
    lines.push(`  Profit: ${usdc(report.best.profitMicros)}; treasury drain: ${usdc(report.best.treasuryDrainMicros)}.`);
    lines.push(`Trace hash: ${report.best.traceHash}`);
  }
  lines.push(`Condition: ${report.conditionalOn}`);
  return lines.join("\n") + "\n";
}
