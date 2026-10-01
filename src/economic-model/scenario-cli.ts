import { readFileSync } from "node:fs";
import { canonicalJson } from "./canonical.ts";
import { runPopulationScenario } from "./scenario.ts";

try {
  const [modelPath, inputPath, option, ...extra] = process.argv.slice(2);
  if (!modelPath || !inputPath || extra.length || (option !== undefined && option !== "--summary")) {
    throw new Error("Usage: npm run --silent scenario -- <model.json> <population-input.json> [--summary]");
  }
  const model = JSON.parse(readFileSync(modelPath, "utf8"));
  const input = JSON.parse(readFileSync(inputPath, "utf8"));
  if (!input || !Object.hasOwn(input, "initialState") || !Object.hasOwn(input, "scenario")) {
    throw new Error("Population input must contain initialState and scenario");
  }
  const result = runPopulationScenario(input.initialState, model, input.scenario);
  if (option === "--summary") {
    const metrics = result.metrics;
    process.stdout.write([
      `Boid scenario (conditional): ${result.scenario.id}`,
      `Seed ${result.scenario.seed}; ${result.scenario.horizonTicks} ticks; arrival ${result.scenario.arrivalBps}/10000; attacker arrivals ${result.scenario.attackerArrivalBps}/10000.`,
      `Model ${result.modelHash}; scenario ${result.scenarioHash}; journal ${result.journalHash}; run ${result.runHash}.`,
      `Accepted ${metrics.acceptedActions}; failed ${metrics.failedActions}; honest ${metrics.honestAccepted}; attacker ${metrics.attackerAccepted}.`,
      `Platform revenue ${metrics.platformRevenueMicros} micro-USDC; creator earnings ${metrics.creatorEarningsMicros}; affiliate payout ${metrics.affiliatePayoutMicros}.`,
      `Treasury ${metrics.initialTreasuryMicros} → ${metrics.finalTreasuryMicros}; attacker extraction ${metrics.attackerTreasuryExtractionMicros}; attacker profit ${metrics.attackerProfitMicros}.`,
      ...result.scenario.assumptions.map((assumption) => `Assumption: ${assumption}`),
      `Condition: ${result.limitation}`,
    ].join("\n") + "\n");
  } else process.stdout.write(canonicalJson(result));
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
