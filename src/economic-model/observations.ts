import { z } from "zod";
import { hashCanonical } from "./canonical.ts";
import { IdSchema, MicroUsdcSchema } from "./value-schema.ts";

const definitions = {
  arrivalBps: { units: "basis-points", statistic: "rate" },
  attackerArrivalBps: { units: "basis-points", statistic: "rate" },
  honestOrderAmountMicros: { units: "micro-USDC", statistic: "mean" },
  identityCostMicros: { units: "micro-USDC", statistic: "mean" },
} as const;
const Metric = z.enum(["arrivalBps", "attackerArrivalBps", "honestOrderAmountMicros", "identityCostMicros"]);
const Timestamp = z.iso.datetime({ precision: 0 });
const Window = z.strictObject({ start: Timestamp, end: Timestamp }).refine(
  (window) => Date.parse(window.start) < Date.parse(window.end), "window start must precede end");
const Units = z.enum(["basis-points", "micro-USDC"]);
const Statistic = z.enum(["rate", "mean"]);
const Hash = z.string().regex(/^[a-f0-9]{64}$/);
const Observation = z.strictObject({
  id: IdSchema, kind: z.literal("observed"), metric: Metric, units: Units, statistic: Statistic,
  population: z.string().min(1).max(500), value: MicroUsdcSchema,
  window: Window, sampleSize: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  collectedAt: Timestamp,
  source: z.strictObject({
    kind: z.enum(["application", "onchain"]), uri: z.url(), query: z.string().min(1).max(20_000),
    datasetSha256: Hash,
  }),
}).superRefine((item, context) => {
  const definition = definitions[item.metric];
  if (item.units !== definition.units || item.statistic !== definition.statistic) context.addIssue({
    code: "custom", message: "Metric units/statistic mismatch", path: ["units"],
  });
  if (item.units === "basis-points" && BigInt(item.value) > 10_000n) context.addIssue({
    code: "custom", message: "Rate exceeds 10000 basis points", path: ["value"],
  });
  if (Date.parse(item.collectedAt) < Date.parse(item.window.end)) context.addIssue({
    code: "custom", message: "Collection precedes window end", path: ["collectedAt"],
  });
});
const Import = z.strictObject({ schemaVersion: z.literal(1), observations: z.array(Observation).min(1).max(1000) });
const Prior = z.strictObject({
  id: IdSchema, kind: z.literal("scenario-assumption"), scenarioHash: Hash,
  metric: Metric, units: Units, statistic: Statistic, population: z.string().min(1).max(500),
  window: Window, minimum: MicroUsdcSchema, maximum: MicroUsdcSchema,
}).superRefine((item, context) => {
  const definition = definitions[item.metric];
  if (item.units !== definition.units || item.statistic !== definition.statistic) context.addIssue({
    code: "custom", message: "Metric units/statistic mismatch", path: ["units"],
  });
  if (BigInt(item.minimum) > BigInt(item.maximum)) context.addIssue({ code: "custom", message: "Range minimum exceeds maximum" });
  if (item.units === "basis-points" && BigInt(item.maximum) > 10_000n) context.addIssue({ code: "custom", message: "Rate exceeds 10000 basis points" });
});
const Priors = z.strictObject({ schemaVersion: z.literal(1), ranges: z.array(Prior).min(1).max(1000) });

/** Import measurements as evidence; never rewrite economic models or scenario inputs. */
export function compareObservations(importInput: unknown, priorInput: unknown) {
  const imported = Import.parse(importInput);
  const priors = Priors.parse(priorInput);
  for (const items of [imported.observations, priors.ranges]) {
    if (new Set(items.map((item) => item.id)).size !== items.length) throw new Error("Duplicate evidence IDs");
  }
  const comparisons = imported.observations.map((observation) => {
    const compatible = priors.ranges.filter((prior) => prior.metric === observation.metric &&
      prior.units === observation.units && prior.statistic === observation.statistic &&
      prior.population === observation.population && prior.window.start === observation.window.start &&
      prior.window.end === observation.window.end);
    if (compatible.length > 1) throw new Error(`Ambiguous prior ranges for ${observation.id}`);
    const prior = compatible[0];
    const value = BigInt(observation.value);
    const status = !prior ? "not-comparable" as const : value < BigInt(prior.minimum) ? "below-range" as const :
      value > BigInt(prior.maximum) ? "above-range" as const : "within-range" as const;
    return { observationId: observation.id, priorId: prior?.id ?? null, status,
      outOfRange: status === "below-range" || status === "above-range",
      reason: prior ? "Compared against inclusive scenario bounds for matching metric, population, statistic, units and window." :
        "No prior with matching metric, population, statistic, units and window; no range conclusion." };
  });
  const result = { schemaVersion: 1, engineVersion: "observed-metrics.v1", importHash: hashCanonical(imported),
    priorHash: hashCanonical(priors), imported, priors, comparisons,
    limitation: "Offline provenance is recorded, not independently verified. Sample size is reported; no statistical confidence or causal inference is implied. Observations do not replace source-code facts or scenario assumptions." };
  return { ...result, assessmentHash: hashCanonical(result) };
}
