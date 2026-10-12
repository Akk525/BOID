import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { canonicalJson, hashCanonical } from "./canonical.ts";
import { checkEconomicCi } from "./ci-check.ts";
import { parseEconomicModel } from "./model.ts";

const [requestedBefore, requestedAfter, requestedOutput = "economic-ci-output"] = process.argv.slice(2);
try {
  const [before, after, output = "economic-ci-output", ...extra] = process.argv.slice(2);
  if (!before || !after || extra.length || ![before, after].every((sha) => /^[a-f0-9]{40}$/.test(sha))) throw new Error("Usage: npm run economic-ci -- <base-commit-sha> <head-commit-sha> [output-directory]");
  const root = "fixtures/creator-marketplace";
  const blob = (commit: string, path: string) => execFileSync("git", ["show", `${commit}:${path}`], { maxBuffer: 5_000_000, stdio: ["ignore", "pipe", "pipe"] });
  const load = (commit: string) => {
    const model = parseEconomicModel(JSON.parse(blob(commit, `${root}/economic-model.population.v1.json`).toString("utf8")));
    const input = JSON.parse(blob(commit, `${root}/population-input.v1.json`).toString("utf8"));
    const sourceFiles = Object.fromEntries(model.source.files.map((file) => {
      try { return [file.path, createHash("sha256").update(blob(commit, file.path)).digest("hex")]; }
      catch { return [file.path, "0".repeat(64)]; }
    }));
    return { commit, model, input, sourceFiles };
  };
  const report = checkEconomicCi(load(before), load(after));
  mkdirSync(output, { recursive: true });
  writeFileSync(resolve(output, "report.json"), canonicalJson(report));
  const repository = process.env.GITHUB_REPOSITORY;
  const link = (sha: string) => repository && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)
    ? `[${sha}](https://github.com/${repository}/commit/${sha})` : sha;
  const summary = ["# Conditional economic CI check", "", `Status: **${report.status}**; alert: ${report.alert}.`,
    `Commits: ${link(before)} → ${link(after)}`, `Report hash: ${report.reportHash}`, "",
    ...report.differences.map((item) => `- ${item.metric}: ${item.baseline} → ${item.candidate} (delta ${item.delta})`),
    ...(report.failure ? [`Failure: ${report.failure}`] : []), "", report.limitation, ""].join("\n");
  writeFileSync(resolve(output, "summary.md"), summary);
  process.stdout.write(summary);
  if (report.alert) process.exitCode = 1;
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if ([requestedBefore, requestedAfter].every((sha) => sha && /^[a-f0-9]{40}$/.test(sha))) {
    const core = { schemaVersion: 1, status: "failed", alert: true, beforeCommit: requestedBefore,
      afterCommit: requestedAfter, failure: message };
    mkdirSync(requestedOutput, { recursive: true });
    writeFileSync(resolve(requestedOutput, "report.json"), canonicalJson({ ...core, reportHash: hashCanonical(core) }));
    writeFileSync(resolve(requestedOutput, "summary.md"), `# Economic CI input failure\n\n${requestedBefore} → ${requestedAfter}\n\n${message}\n`);
  }
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
