import { readFileSync } from "node:fs";
import { canonicalJson } from "./canonical.ts";
import { renderSensitivity, sweepSensitivity } from "./sensitivity.ts";

try {
  const [modelPath, scenarioPath, gridPath, format, ...extra] = process.argv.slice(2);
  if (!modelPath || !scenarioPath || !gridPath || extra.length ||
    (format !== undefined && format !== "--json")) {
    throw new Error("Usage: npm run --silent sensitivity -- <model.json> <population-input.json> <grid.json> [--json]");
  }
  const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8"));
  const input = readJson(scenarioPath);
  if (!input || !Object.hasOwn(input, "initialState") || !Object.hasOwn(input, "scenario")) {
    throw new Error("Population input must contain initialState and scenario");
  }
  const result = sweepSensitivity(input.initialState, readJson(modelPath), input.scenario, readJson(gridPath));
  process.stdout.write(format === "--json" ? canonicalJson(result) : renderSensitivity(result));
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
