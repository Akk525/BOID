import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import test from "node:test";
import { checkEconomicCi } from "./ci-check.ts";

const root = "fixtures/economic-ci";
const read = (name: string) => JSON.parse(readFileSync(`${root}/${name}.v1.json`, "utf8"));
for (const [name, status] of [["rule-change", "changed"], ["documentation-only", "unchanged"], ["failed-run", "failed"], ["source-drift", "failed"]]) {
  test(`CI ${name} reproduces linked before/after evidence`, () => {
    const baseline = read("baseline");
    const after = read(name!);
    const before = JSON.stringify({ baseline, after });
    const report = checkEconomicCi(baseline, after);
    assert.deepEqual(report, read(`${name}-report`));
    assert.equal(report.status, status);
    assert.equal(report.alert, status !== "unchanged");
    assert.equal(JSON.stringify({ baseline, after }), before);
    if (name === "rule-change") {
      assert.deepEqual(report.differences.find((item) => item.metric === "attackerProfitMicros"),
        { metric: "attackerProfitMicros", baseline: "680000", candidate: "-170000", delta: "-850000" });
      assert.ok(report.baseline?.runHash && report.candidate?.runHash);
    }
  });
}
test("CI command reads committed inputs, emits no alert for docs and preserves failed-run artifact", () => {
  const directory = mkdtempSync(join(tmpdir(), "boid-ci-"));
  const cli = resolve("src/economic-model/ci-check-cli.ts");
  const git = (args: string[]) => execFileSync("git", args, { cwd: directory, stdio: "pipe" }).toString().trim();
  try {
    git(["init"]);
    const write = (path: string, data: string) => {
      mkdirSync(dirname(join(directory, path)), { recursive: true });
      writeFileSync(join(directory, path), data);
    };
    const baseline = read("baseline");
    const fixture = "fixtures/creator-marketplace";
    for (const file of baseline.model.source.files) write(file.path, readFileSync(file.path, "utf8"));
    write(`${fixture}/economic-model.population.v1.json`, JSON.stringify(baseline.model));
    write(`${fixture}/population-input.v1.json`, JSON.stringify(baseline.input));
    const commit = () => {
      git(["add", "fixtures", "README.md"]);
      git(["-c", "user.name=BOID test", "-c", "user.email=test@example.org", "commit", "-m", "fixture"]);
      return git(["rev-parse", "HEAD"]);
    };
    write("README.md", "baseline\n");
    const base = commit();
    write("README.md", "documentation changed\n");
    const docs = commit();
    let execution = spawnSync(process.execPath, [cli, base, docs, "output"], { cwd: directory, encoding: "utf8" });
    assert.equal(execution.status, 0, execution.stderr);
    assert.equal(JSON.parse(readFileSync(join(directory, "output/report.json"), "utf8")).alert, false);
    write(`${fixture}/economic-model.population.v1.json`, JSON.stringify(read("rule-change").model));
    const changed = commit();
    execution = spawnSync(process.execPath, [cli, base, changed, "output"], { cwd: directory, encoding: "utf8" });
    assert.equal(execution.status, 1);
    assert.equal(JSON.parse(readFileSync(join(directory, "output/report.json"), "utf8")).status, "changed");
    write(`${fixture}/population-input.v1.json`, "invalid JSON");
    const failed = commit();
    execution = spawnSync(process.execPath, [cli, base, failed, "output"], { cwd: directory, encoding: "utf8" });
    assert.equal(execution.status, 1);
    const report = JSON.parse(readFileSync(join(directory, "output/report.json"), "utf8"));
    assert.equal(report.status, "failed");
    assert.equal(report.afterCommit, failed);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
