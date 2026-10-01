import { readFileSync } from "node:fs";
import { canonicalJson } from "./canonical.ts";
import { buildFindingReport, renderFinding } from "./finding.ts";
import { searchStrategies } from "./search.ts";

try {
  const [modelPath, inputPath, format, ...extra] = process.argv.slice(2);
  if (!modelPath || !inputPath || extra.length || (format !== undefined && format !== "--json" && format !== "--raw")) {
    throw new Error("Usage: npm run --silent search -- <model.json> <search-input.json> [--json|--raw]");
  }
  const model = JSON.parse(readFileSync(modelPath, "utf8"));
  const input = JSON.parse(readFileSync(inputPath, "utf8"));
  if (!input || typeof input !== "object" || !Object.hasOwn(input, "initialState") || !Object.hasOwn(input, "config")) {
    throw new Error("Search input must contain initialState and config.");
  }
  if (!input.config?.transactionCost?.amountMicros || input.config?.identities?.some(
    (identity: { identityCost?: { amountMicros?: string } }) => !identity.identityCost?.amountMicros,
  )) {
    throw new Error("Missing external cost. Supply an explicit transaction and identity cost assumption (or investigate an explicit cost range) before making a point-profit claim.");
  }
  const search = searchStrategies(input.initialState, model, input.config);
  process.stdout.write(format === "--raw" ? canonicalJson(search)
    : format === "--json" ? canonicalJson(buildFindingReport(model, search))
      : renderFinding(buildFindingReport(model, search)));
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
