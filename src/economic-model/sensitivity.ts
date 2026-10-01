import { z } from "zod";
import { hashCanonical } from "./canonical.ts";
import type { EconomicModel, EconomicState } from "./model.ts";
import { runPopulationScenario } from "./scenario.ts";
import type { PopulationScenario, ScenarioMetrics } from "./scenario.ts";
import { IdSchema, MicroUsdcSchema } from "./value-schema.ts";

export const SENSITIVITY_ENGINE_VERSION = "sensitivity-sweep.v1";
const PositiveMoney = MicroUsdcSchema.refine((value) => BigInt(value) > 0n, "amount must be positive");
const GridSchema = z.strictObject({
  schemaVersion: z.literal(1),
  horizonTicks: z.number().int().min(1).max(10_000),
  arrivalBps: z.number().int().min(0).max(10_000),
  identityCostsMicros: z.array(MicroUsdcSchema).min(1).max(12),
  honestOrderDistributions: z.array(z.strictObject({
    id: IdSchema,
    orderAmountsMicros: z.array(PositiveMoney).min(1).max(100),
  })).min(1).max(12),
  attackerFractionsBps: z.array(z.number().int().min(0).max(10_000)).min(1).max(12),
  attackerOrderAmountsMicros: z.array(PositiveMoney).min(1).max(12),
  seeds: z.array(z.number().int().min(1).max(0xffff_ffff)).min(1).max(12),
  sharedAssumptions: z.array(z.string().min(1)).min(1).max(10),
});

export type SensitivityGrid = z.infer<typeof GridSchema>;
type SeedRun = {
  seed: number;
  runHash: string;
  journalHash: string;
  scenarioHash: string;
  metrics: ScenarioMetrics;
};
type Cell = {
  identityCostMicros: string;
  honestOrderDistribution: SensitivityGrid["honestOrderDistributions"][number];
  attackerFractionBps: number;
  attackerOrderAmountMicros: string;
  seedRuns: SeedRun[];
  summary: {
    attackerProfitRangeMicros: [string, string];
    platformRevenueRangeMicros: [string, string];
    treasurySpentRangeMicros: [string, string];
    positiveSeedRuns: number;
    failedActions: number;
    region: "positive" | "nonpositive" | "mixed";
  };
};
type SensitivityCore = {
  schemaVersion: 1;
  engineVersion: typeof SENSITIVITY_ENGINE_VERSION;
  modelHash: string;
  initialStateHash: string;
  baseScenarioHash: string;
  grid: SensitivityGrid;
  firstPurchaseProbes: {
    attackerOrderAmountMicros: string;
    accepted: boolean;
    breakEvenIdentityCostMicros: string | null;
    runHash: string;
    journalHash: string;
  }[];
  cells: Cell[];
  limitations: string[];
};
export type SensitivityResult = SensitivityCore & { sweepHash: string };

function unique<T>(values: T[], path: string): void {
  if (new Set(values).size !== values.length) throw new Error(`${path} must contain unique values`);
}

function range(values: bigint[]): [string, string] {
  let low = values[0]!;
  let high = values[0]!;
  for (const value of values) {
    if (value < low) low = value;
    if (value > high) high = value;
  }
  return [low.toString(), high.toString()];
}

function variant(
  base: PopulationScenario, grid: SensitivityGrid, seed: number, identityCostMicros: string,
  distribution: SensitivityGrid["honestOrderDistributions"][number], attackerFractionBps: number,
  attackerOrderAmountMicros: string,
): PopulationScenario {
  if (!base.attacker) throw new Error("Sensitivity sweep requires an attacker population");
  return {
    ...base,
    seed,
    horizonTicks: grid.horizonTicks,
    arrivalBps: grid.arrivalBps,
    attackerArrivalBps: attackerFractionBps,
    honest: { ...base.honest, orderAmountsMicros: [...distribution.orderAmountsMicros] },
    attacker: {
      ...base.attacker,
      orderAmountMicros: attackerOrderAmountMicros,
      buyers: base.attacker.buyers.map((buyer) => ({
        ...buyer,
        identityCost: {
          amountMicros: identityCostMicros,
          evidence: {
            kind: "user_supplied" as const,
            source: { type: "user" as const },
            notes: `Sensitivity grid assumption: identity ${buyer.accountId} costs ${identityCostMicros} micro-USDC.`,
          },
        },
      })),
    },
    assumptions: [
      ...grid.sharedAssumptions,
      `The horizon is ${grid.horizonTicks} ticks with ${grid.arrivalBps}/10000 arrival probability per tick.`,
      `Honest order amounts are sampled uniformly from distribution ${distribution.id}: ${distribution.orderAmountsMicros.join(", ")} micro-USDC.`,
      `Attacker share of arrivals is ${attackerFractionBps}/10000; attacker order amount is ${attackerOrderAmountMicros} micro-USDC.`,
      `Every activated attacker buyer identity costs ${identityCostMicros} micro-USDC; seed is ${seed}.`,
    ],
  };
}

/** Pair identical seeds across a bounded grid; all economics come from runPopulationScenario. */
export function sweepSensitivity(
  initialState: EconomicState, model: EconomicModel, baseScenario: PopulationScenario,
  inputGrid: SensitivityGrid,
): SensitivityResult {
  const grid = GridSchema.parse(inputGrid);
  if (!baseScenario.attacker) throw new Error("Sensitivity sweep requires an attacker population");
  unique(grid.identityCostsMicros, "identityCostsMicros");
  unique(grid.honestOrderDistributions.map((item) => item.id), "honestOrderDistributions.id");
  unique(grid.attackerFractionsBps, "attackerFractionsBps");
  unique(grid.attackerOrderAmountsMicros, "attackerOrderAmountsMicros");
  unique(grid.seeds, "seeds");
  const runs = grid.identityCostsMicros.length * grid.honestOrderDistributions.length *
    grid.attackerFractionsBps.length * grid.attackerOrderAmountsMicros.length * grid.seeds.length;
  if (runs > 256) throw new Error(`Sensitivity grid has ${runs} runs; maximum is 256`);

  const firstDistribution = grid.honestOrderDistributions[0]!;
  const probes = grid.attackerOrderAmountsMicros.map((amount) => {
    const probeScenario = variant(baseScenario, grid, grid.seeds[0]!, "0", firstDistribution, 10_000, amount);
    probeScenario.horizonTicks = 1;
    probeScenario.arrivalBps = 10_000;
    probeScenario.attacker!.maxAttempts = 1;
    probeScenario.assumptions = [
      ...grid.sharedAssumptions,
      "This probe makes one fresh attacker purchase attempt before any other activity, with zero identity cost.",
      `The attacker order amount is ${amount} micro-USDC; transaction cost remains declared in the base scenario.`,
    ];
    const result = runPopulationScenario(initialState, model, probeScenario);
    return {
      attackerOrderAmountMicros: amount,
      accepted: result.metrics.attackerAccepted === 1,
      breakEvenIdentityCostMicros: result.metrics.attackerAccepted === 1 ? result.metrics.attackerProfitMicros : null,
      runHash: result.runHash,
      journalHash: result.journalHash,
    };
  });

  const cells: Cell[] = [];
  let modelHash = "";
  let initialStateHash = "";
  for (const identityCostMicros of grid.identityCostsMicros) {
    for (const distribution of grid.honestOrderDistributions) {
      for (const attackerFractionBps of grid.attackerFractionsBps) {
        for (const attackerOrderAmountMicros of grid.attackerOrderAmountsMicros) {
          const seedRuns = grid.seeds.map((seed): SeedRun => {
            const scenario = variant(baseScenario, grid, seed, identityCostMicros,
              distribution, attackerFractionBps, attackerOrderAmountMicros);
            const result = runPopulationScenario(initialState, model, scenario);
            modelHash = result.modelHash;
            initialStateHash = result.initialStateHash;
            return {
              seed, runHash: result.runHash, journalHash: result.journalHash,
              scenarioHash: result.scenarioHash, metrics: result.metrics,
            };
          });
          const profits = seedRuns.map((run) => BigInt(run.metrics.attackerProfitMicros));
          const positiveSeedRuns = profits.filter((value) => value > 0n).length;
          cells.push({
            identityCostMicros, honestOrderDistribution: distribution,
            attackerFractionBps, attackerOrderAmountMicros, seedRuns,
            summary: {
              attackerProfitRangeMicros: range(profits),
              platformRevenueRangeMicros: range(seedRuns.map((run) => BigInt(run.metrics.platformRevenueMicros))),
              treasurySpentRangeMicros: range(seedRuns.map((run) => BigInt(run.metrics.treasurySpentMicros))),
              positiveSeedRuns,
              failedActions: seedRuns.reduce((sum, run) => sum + run.metrics.failedActions, 0),
              region: positiveSeedRuns === seedRuns.length ? "positive" : positiveSeedRuns === 0 ? "nonpositive" : "mixed",
            },
          });
        }
      }
    }
  }
  const core: SensitivityCore = {
    schemaVersion: 1, engineVersion: SENSITIVITY_ENGINE_VERSION, modelHash, initialStateHash,
    baseScenarioHash: hashCanonical({ initialState, scenario: baseScenario }), grid,
    firstPurchaseProbes: probes, cells,
    limitations: [
      "Every value is conditional on the declared mechanism, fixed population, initial balances, policies, and finite horizon.",
      "The seed range shows variation across selected deterministic runs, not a statistical confidence interval or future-demand forecast.",
      "The first-purchase break-even cost assumes one accepted fresh-buyer attempt before other activity; treasury exhaustion can change realized results.",
    ],
  };
  return { ...core, sweepHash: hashCanonical(core) };
}

function usdc(micros: string): string {
  const amount = BigInt(micros);
  const absolute = amount < 0n ? -amount : amount;
  return `${amount < 0n ? "-" : ""}${absolute / 1_000_000n}.${(absolute % 1_000_000n).toString().padStart(6, "0")}`;
}

export function renderSensitivity(result: SensitivityResult): string {
  const lines = [
    `Boid sensitivity sweep (conditional); hash ${result.sweepHash}`,
    `Model ${result.modelHash}; initial state ${result.initialStateHash}; ${result.grid.horizonTicks} ticks; arrival ${result.grid.arrivalBps}/10000; paired seeds ${result.grid.seeds.join(", ")}.`,
    `Inputs: identity costs [${result.grid.identityCostsMicros.map(usdc).join(", ")}] USDC; attacker shares [${result.grid.attackerFractionsBps.join(", ")}] bps; attacker orders [${result.grid.attackerOrderAmountsMicros.map(usdc).join(", ")}] USDC.`,
    `Honest order distributions: ${result.grid.honestOrderDistributions.map((item) => `${item.id}=[${item.orderAmountsMicros.map(usdc).join(", ")}]`).join("; ")} USDC (uniform choices).`,
    "First fresh attacker purchase (one accepted attempt before other activity):",
    ...result.firstPurchaseProbes.map((probe) =>
      `  ${usdc(probe.attackerOrderAmountMicros)} USDC order: ${probe.accepted ? `${usdc(probe.breakEvenIdentityCostMicros!)} USDC break-even identity cost` : "rejected; break-even unavailable"}; run ${probe.runHash}.`),
    "Grid: cost | honest orders | attacker share | attacker order | profit range (USDC) | platform revenue range (USDC) | treasury spent range (USDC) | positive seeds | failed actions | region",
    ...result.cells.map((cell) => [
      usdc(cell.identityCostMicros), cell.honestOrderDistribution.id,
      `${cell.attackerFractionBps} bps`, usdc(cell.attackerOrderAmountMicros),
      cell.summary.attackerProfitRangeMicros.map(usdc).join(".."),
      cell.summary.platformRevenueRangeMicros.map(usdc).join(".."),
      cell.summary.treasurySpentRangeMicros.map(usdc).join(".."),
      `${cell.summary.positiveSeedRuns}/${cell.seedRuns.length}`,
      cell.summary.failedActions, cell.summary.region,
    ].join(" | ")),
    ...result.limitations.map((limitation) => `Condition: ${limitation}`),
  ];
  return lines.join("\n") + "\n";
}
