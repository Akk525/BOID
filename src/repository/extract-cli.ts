import { readFileSync } from "node:fs";
import { canonicalJson } from "../economic-model/canonical.ts";
import { approveMarketplace, extractMarketplace } from "./extract.ts";
import { snapshotRepository } from "./snapshot.ts";

try {
  const [source, flag, reviewPath, ...extra] = process.argv.slice(2);
  if (!source || extra.length || (flag !== undefined && (flag !== "--review" || !reviewPath))) {
    throw new Error("Usage: npm run --silent extract -- <local-directory|pinned-GitHub-URL> [--review <review.json>]");
  }
  const snapshot = snapshotRepository(source);
  const draft = extractMarketplace(snapshot);
  process.stdout.write(canonicalJson(flag === "--review"
    ? approveMarketplace(snapshot, draft, JSON.parse(readFileSync(reviewPath!, "utf8"))) : draft));
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
