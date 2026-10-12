import { z } from "zod";
import { hashCanonical } from "./canonical.ts";
import { hashEconomicModel, parseEconomicModel } from "./model.ts";
import { runPopulationScenario } from "./scenario.ts";
import type { ScenarioResult } from "./scenario.ts";

const Hash = z.string().regex(/^[a-f0-9]{64}$/);
const Package = z.strictObject({
  commit: z.string().regex(/^[a-f0-9]{40}$/), model: z.unknown(),
  input: z.strictObject({ initialState: z.unknown(), scenario: z.unknown() }),
  sourceFiles: z.record(z.string(), Hash),
});
export type EconomicCiPackage = z.infer<typeof Package>;

function execute(input: EconomicCiPackage) {
  const model = parseEconomicModel(input.model);
  const drift = model.source.files.filter((file) => input.sourceFiles[file.path] !== file.sha256).map((file) => file.path);
  if (drift.length) throw new Error(`Reviewed model source is stale or missing: ${drift.join(", ")}`);
  // The scenario runner validates the complete model, state and scenario.
  return runPopulationScenario(input.input.initialState as Parameters<typeof runPopulationScenario>[0], model,
    input.input.scenario as Parameters<typeof runPopulationScenario>[2]);
}

/** Fixed approved input on both commits; source drift and failed runs are explicit failures. */
export function checkEconomicCi(beforeInput: unknown, afterInput: unknown) {
  const before = Package.parse(beforeInput);
  const after = Package.parse(afterInput);
  let baseline: ScenarioResult | null = null;
  let candidate: ScenarioResult | null = null;
  let failure: string | null = null;
  try {
    if (hashCanonical(before.input) !== hashCanonical(after.input)) throw new Error("Approved scenario input changed; review it separately before comparison");
    baseline = execute(before);
    candidate = execute(after);
  } catch (error) { failure = error instanceof Error ? error.message : String(error); }
  const differences = baseline && candidate ? Object.entries(baseline.metrics).flatMap(([metric, value]) => {
    const next = candidate!.metrics[metric as keyof typeof candidate.metrics];
    return value === next ? [] : [{ metric, baseline: String(value), candidate: String(next),
      delta: (BigInt(next) - BigInt(value)).toString() }];
  }) : [];
  const traceChanged = baseline && candidate ? hashCanonical(baseline.events) !== hashCanonical(candidate.events) : false;
  const status = failure ? "failed" : differences.length || traceChanged ? "changed" : "unchanged";
  const core = { schemaVersion: 1, engineVersion: "economic-ci.v1", beforeCommit: before.commit, afterCommit: after.commit,
    beforePackageHash: hashCanonical(before), afterPackageHash: hashCanonical(after), approvedInputHash: hashCanonical(before.input),
    status, alert: status !== "unchanged", failure, differences, traceChanged,
    baseline, candidate,
    modelChanged: baseline && candidate ? hashEconomicModel(parseEconomicModel(before.model)) !== hashEconomicModel(parseEconomicModel(after.model)) : null,
    limitation: "One reviewed seeded marketplace scenario, not an exhaustive safety check. Changes are conditional economic differences, not verified adverse findings. Source drift or invalid runs require review; no automatic parameter or model updates." };
  return { ...core, reportHash: hashCanonical(core) };
}
