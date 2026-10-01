import { readFileSync } from "node:fs";
import { canonicalJson } from "./canonical.ts";
import { compareMechanisms } from "./compare.ts";
import { buildRecommendation, renderRecommendation, validateRecommendation } from "./recommendation.ts";
import { searchStrategies } from "./search.ts";
import { sweepSensitivity } from "./sensitivity.ts";

try {
  const [baselinePath, repairPath, searchPath, referencePath, populationModelPath,
    populationPath, gridPath, option, validationPath, ...extra] = process.argv.slice(2);
  if (!baselinePath || !repairPath || !searchPath || !referencePath || !populationModelPath ||
    !populationPath || !gridPath || extra.length ||
    (option !== undefined && option !== "--json" && option !== "--validate") ||
    (option === "--validate" ? !validationPath : validationPath !== undefined)) {
    throw new Error("Usage: npm run --silent recommend -- <baseline-model.json> <repair-model.json> <search-input.json> <reference-purchase.json> <population-model.json> <population-input.json> <sensitivity-grid.json> [--json|--validate <recommendation.json>]");
  }
  const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8"));
  const baselineModel = readJson(baselinePath);
  const repairModel = readJson(repairPath);
  const populationModel = readJson(populationModelPath);
  const searchInput = readJson(searchPath);
  const populationInput = readJson(populationPath);
  const referencePurchase = readJson(referencePath);
  const grid = readJson(gridPath);
  if (!searchInput || !Object.hasOwn(searchInput, "initialState") || !Object.hasOwn(searchInput, "config") ||
    !populationInput || !Object.hasOwn(populationInput, "initialState") || !Object.hasOwn(populationInput, "scenario")) {
    throw new Error("Search and population inputs must contain their initial states and configurations");
  }
  const bundle = {
    baselineModel, repairModel, populationModel,
    search: searchStrategies(searchInput.initialState, baselineModel, searchInput.config),
    comparison: compareMechanisms(searchInput.initialState, baselineModel, repairModel,
      searchInput.config, referencePurchase),
    sensitivity: sweepSensitivity(populationInput.initialState, populationModel, populationInput.scenario, grid),
    populationInput,
  };
  if (option === "--validate") {
    const checked = validateRecommendation(readJson(validationPath!), bundle);
    if (!checked.ok) throw new Error(checked.reason);
    process.stdout.write("Recommendation validates against the locked result bundle.\n");
  } else {
    const artifact = buildRecommendation(bundle);
    process.stdout.write(option === "--json" ? canonicalJson(artifact) : renderRecommendation(artifact));
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
