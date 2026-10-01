import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { hashCanonical } from "./canonical.ts";
import { hashEconomicModel, parseEconomicModel } from "./model.ts";
import { replayStrategy } from "./strategy.ts";

const modelPath = "fixtures/creator-marketplace/economic-model.v1.json";
const inputPath = "fixtures/creator-marketplace/search-input.v1.json";
const command = (format?: string, path = inputPath) =>
  ["src/economic-model/search-cli.ts", modelPath, path, ...(format ? [format] : [])];

test("one command prints a conditional cited finding and stable structured result", () => {
  const text = execFileSync(process.execPath, command(), { encoding: "utf8" });
  assert.match(text, /Profit: 0\.340000 USDC; treasury drain: 1\.000000 USDC/);
  assert.match(text, /affiliateBonusSource.*config\.mjs:4-4/);
  assert.match(text, /-0\.150000 USDC.*identityCost \[user_supplied/);
  assert.match(text, /5000 nodes, depth 2, 3 accounts/);
  assert.match(text, /Condition: The declared model/);

  const first = execFileSync(process.execPath, command("--json"), { encoding: "utf8" });
  assert.equal(execFileSync(process.execPath, command("--json"), { encoding: "utf8" }), first);
  const report = JSON.parse(first);
  const raw = JSON.parse(execFileSync(process.execPath, command("--raw"), { encoding: "utf8" }));
  const model = parseEconomicModel(JSON.parse(readFileSync(modelPath, "utf8")));
  assert.equal(report.modelHash, hashEconomicModel(model));
  assert.equal(report.searchHash, raw.searchHash);
  assert.equal(report.runHash, hashCanonical(raw));
  assert.equal(report.best.traceHash, raw.findings[0].traceHash);
  assert.equal(report.best.profitMicros, "340000");
  assert.equal(report.best.treasuryDrainMicros, "1000000");
  assert.equal(report.best.actionTrace[0].action.amountMicros, "5000000");
  assert.deepEqual(report.best.actionTrace[0].journal.map((entry: { amountMicros: string }) => entry.amountMicros),
    ["500000", "4500000", "1000000"]);
  assert.equal(report.best.terms.reduce((sum: bigint, term: { amountMicros: string }) =>
    sum + BigInt(term.amountMicros), 0n), 340000n);
  assert.ok(report.best.terms.every((term: { evidence: unknown }) => term.evidence));
  assert.ok(replayStrategy(raw.findings[0].trace, model).ok);
});

test("missing external cost blocks a point-profit report", () => {
  const directory = mkdtempSync(join(tmpdir(), "boid-finding-"));
  try {
    const input = JSON.parse(readFileSync(inputPath, "utf8"));
    delete input.config.transactionCost;
    const path = join(directory, "input.json");
    writeFileSync(path, JSON.stringify(input));
    const result = spawnSync(process.execPath, command("--json", path), { encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /explicit.*cost assumption.*cost range/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
