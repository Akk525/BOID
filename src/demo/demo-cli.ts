import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { canonicalJson } from "../economic-model/canonical.ts";
import { compareMechanisms } from "../economic-model/compare.ts";
import { buildFindingReport } from "../economic-model/finding.ts";
import { buildRecommendation } from "../economic-model/recommendation.ts";
import { searchStrategies } from "../economic-model/search.ts";
import { sweepSensitivity } from "../economic-model/sensitivity.ts";
import { buildDemoData, renderDemoHtml } from "./view.ts";

try {
  const [directory = "demo-output", ...extra] = process.argv.slice(2);
  if (extra.length) throw new Error("Usage: npm run demo -- [output-directory]");
  const root = "fixtures/creator-marketplace";
  const readJson = (name: string) => JSON.parse(readFileSync(`${root}/${name}`, "utf8"));
  const baselineModel = readJson("economic-model.v1.json");
  const repairModel = readJson("economic-model.fee-funded.v1.json");
  const populationModel = readJson("economic-model.population.v1.json");
  const searchInput = readJson("search-input.v1.json");
  const populationInput = readJson("population-input.v1.json");
  const search = searchStrategies(searchInput.initialState, baselineModel, searchInput.config);
  const comparison = compareMechanisms(searchInput.initialState, baselineModel, repairModel,
    searchInput.config, readJson("reference-purchase.v1.json"));
  const sensitivity = sweepSensitivity(populationInput.initialState, populationModel,
    populationInput.scenario, readJson("sensitivity-grid.v1.json"));
  const recommendation = buildRecommendation({
    baselineModel, repairModel, populationModel, search, comparison, sensitivity, populationInput,
  });
  const finding = buildFindingReport(baselineModel, search);
  const data = buildDemoData(finding, comparison, sensitivity, recommendation);
  const css = readFileSync(new URL("./style.css", import.meta.url), "utf8");
  const client = readFileSync(new URL("./client.js", import.meta.url), "utf8");
  const output = resolve(directory);
  mkdirSync(output, { recursive: true });
  for (const [name, artifact] of Object.entries({ finding, comparison, sensitivity, recommendation, data })) {
    writeFileSync(resolve(output, `${name}.json`), canonicalJson(artifact));
  }
  writeFileSync(resolve(output, "index.html"), renderDemoHtml(data, css, client));
  process.stdout.write(`Boid demo: ${resolve(output, "index.html")}\nData hash: ${data.dataHash}\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
