import { readFileSync } from "node:fs";
import { canonicalJson } from "./canonical.ts";
import { compareMechanisms, renderComparison } from "./compare.ts";

try {
  const [baselinePath, repairPath, inputPath, purchasePath, format, ...extra] = process.argv.slice(2);
  if (!baselinePath || !repairPath || !inputPath || !purchasePath || extra.length ||
    (format !== undefined && format !== "--json")) {
    throw new Error("Usage: npm run --silent compare -- <baseline-model.json> <repair-model.json> <search-input.json> <reference-purchase.json> [--json]");
  }
  const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8"));
  const input = readJson(inputPath);
  if (!input || !Object.hasOwn(input, "initialState") || !Object.hasOwn(input, "config")) {
    throw new Error("Search input must contain initialState and config");
  }
  const comparison = compareMechanisms(input.initialState, readJson(baselinePath),
    readJson(repairPath), input.config, readJson(purchasePath));
  process.stdout.write(format === "--json" ? canonicalJson(comparison) : renderComparison(comparison));
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
