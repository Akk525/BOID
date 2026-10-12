import { readFileSync } from "node:fs";
import { canonicalJson } from "./canonical.ts";
import { compareObservations } from "./observations.ts";

try {
  const [observations, priors, ...extra] = process.argv.slice(2);
  if (!observations || !priors || extra.length) throw new Error("Usage: npm run observe -- <observations.json> <prior-ranges.json>");
  const read = (path: string) => JSON.parse(readFileSync(path, "utf8"));
  process.stdout.write(canonicalJson(compareObservations(read(observations), read(priors))));
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
