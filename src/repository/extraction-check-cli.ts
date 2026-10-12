import { canonicalJson } from "../economic-model/canonical.ts";
import { checkSecondMarketplace } from "./extraction-check.ts";

try {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const [root = "fixtures/second-marketplace", ...extra] = args.filter((arg) => arg !== "--json");
  const option = json ? "--json" : undefined;
  if (extra.length || (option !== undefined && option !== "--json")) throw new Error(
    "Usage: npm run extraction-check -- [fixture-directory] [--json]");
  const report = checkSecondMarketplace(root);
  if (option === "--json") process.stdout.write(canonicalJson(report));
  else {
    console.log(`${report.source.repository}@${report.source.commit}: ${report.counts.matched}/${report.counts.reviewedFacts} reviewed facts extracted.`);
    for (const fact of report.facts) console.log(`${fact.id}: ${fact.outcome} (${fact.category}; ${fact.extractorStatus})`);
    console.log(`${report.limitation}\nAssessment: ${report.assessmentHash}`);
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
