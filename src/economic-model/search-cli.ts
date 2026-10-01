import { readFileSync } from "node:fs";
import { canonicalJson } from "./canonical.ts";
import { searchStrategies } from "./search.ts";

try {
  const [modelPath, inputPath, ...extra] = process.argv.slice(2);
  if (!modelPath || !inputPath || extra.length) {
    throw new Error("Usage: npm run --silent search -- <model.json> <search-input.json>");
  }
  const model = JSON.parse(readFileSync(modelPath, "utf8"));
  const input = JSON.parse(readFileSync(inputPath, "utf8"));
  if (!input || typeof input !== "object" || !Object.hasOwn(input, "initialState") || !Object.hasOwn(input, "config")) {
    throw new Error("Search input must contain initialState and config.");
  }
  process.stdout.write(canonicalJson(searchStrategies(input.initialState, model, input.config)));
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
