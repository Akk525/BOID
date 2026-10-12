import { readFileSync } from "node:fs";
import { canonicalJson } from "../economic-model/canonical.ts";
import { checkModelStaleness } from "./staleness.ts";

try {
  const [model, before, after, runs, prefix = "", ...extra] = process.argv.slice(2);
  if (!model || !before || !after || !runs || extra.length) throw new Error("Usage: npm run stale-check -- <model.json> <before-snapshot.json> <after-snapshot.json> <run-links.json> [snapshot-path-prefix]");
  const read = (path: string) => JSON.parse(readFileSync(path, "utf8"));
  process.stdout.write(canonicalJson(checkModelStaleness(read(model), read(before), read(after), read(runs), prefix)));
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
