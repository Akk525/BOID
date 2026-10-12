import { readFileSync } from "node:fs";
import { canonicalJson } from "./canonical.ts";
import { searchEscrow } from "./escrow.ts";

try {
  const [path = "fixtures/escrow/search-input.v1.json", ...extra] = process.argv.slice(2);
  if (extra.length) throw new Error("Usage: npm run escrow-search -- [input.json]");
  const input = JSON.parse(readFileSync(path, "utf8"));
  process.stdout.write(canonicalJson(searchEscrow(input.model, input.initialState, input.scenario, input.limits)));
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
