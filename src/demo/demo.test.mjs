import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { JSDOM, VirtualConsole } from "jsdom";
import { canonicalJson, hashCanonical } from "../economic-model/canonical.ts";
import { buildDemoData } from "./view.ts";

function micros(shown) {
  const match = shown.match(/^([+−-]?)(\d+)\.(\d{6}) USDC$/);
  assert.ok(match, `expected a six-decimal USDC value: ${shown}`);
  return `${match[1] === "−" || match[1] === "-" ? "-" : ""}${BigInt(match[2] + match[3]).toString()}`;
}

test("generated demo steps through treasury flow and selectors display saved artifact values", () => {
  const output = mkdtempSync(join(tmpdir(), "boid-demo-e2e-"));
  try {
    execFileSync(process.execPath, ["src/demo/demo-cli.ts", output], { cwd: process.cwd(), encoding: "utf8" });
    const read = (name) => JSON.parse(readFileSync(join(output, `${name}.json`), "utf8"));
    const finding = read("finding");
    const comparison = read("comparison");
    const sensitivity = read("sensitivity");
    const recommendation = read("recommendation");
    const data = read("data");
    assert.equal(canonicalJson(data), canonicalJson(buildDemoData(finding, comparison, sensitivity, recommendation)));
    const { dataHash, ...core } = data;
    assert.equal(dataHash, hashCanonical(core));

    const errors = [];
    const virtualConsole = new VirtualConsole();
    virtualConsole.on("jsdomError", (error) => errors.push(error.message));
    const dom = new JSDOM(readFileSync(join(output, "index.html"), "utf8"), {
      runScripts: "dangerously", virtualConsole, url: "https://boid.example/demo",
    });
    const { document, Event } = dom.window;
    const node = (id) => document.getElementById(id);
    assert.deepEqual(errors, []);
    assert.equal(canonicalJson(JSON.parse(node("boid-data").textContent)), canonicalJson(data));
    assert.equal(micros(node("hero-profit").textContent), finding.best.profitMicros);
    assert.equal(micros(node("hero-treasury").textContent), finding.best.treasuryDrainMicros);
    assert.equal(micros(node("source-threshold").textContent), "5000000");
    assert.equal(micros(node("source-award").textContent), "1000000");
    assert.match(node("source-evidence").textContent, /src\/config\.mjs:4/);

    let clicked = 0;
    while (node("flow-from").textContent !== "campaignTreasury" && clicked < 20) {
      node("trace-next").click();
      clicked++;
    }
    assert.ok(clicked < 20, "treasury transfer appears in the step sequence");
    assert.equal(node("flow-to").textContent, "affiliate-1");
    assert.equal(micros(node("flow-amount").textContent), "1000000");
    assert.equal(micros(node("trace-profit").textContent), finding.best.profitMicros);
    assert.equal(micros(node("repair-before-profit").textContent), comparison.witness.baselineProfitMicros);
    assert.equal(micros(node("repair-after-profit").textContent), comparison.witness.repairProfitMicros);
    assert.equal(micros(node("repair-before-award").textContent), comparison.referencePurchase.baselineAffiliateAwardMicros);
    assert.equal(micros(node("repair-after-award").textContent), comparison.referencePurchase.repairAffiliateAwardMicros);

    node("cost-control").click();
    assert.equal(node("select-cost").value, "500000");
    node("select-share").value = "5000";
    node("select-distribution").value = "small-and-normal";
    node("select-order").value = "5000000";
    node("select-seed").value = "42";
    node("assumption-controls").dispatchEvent(new Event("change", { bubbles: true }));
    const cell = sensitivity.cells.find((item) => item.identityCostMicros === "500000" &&
      item.honestOrderDistribution.id === "small-and-normal" && item.attackerFractionBps === 5000 &&
      item.attackerOrderAmountMicros === "5000000");
    const run = cell.seedRuns.find((item) => item.seed === 42);
    assert.equal(micros(node("scenario-profit").textContent), run.metrics.attackerProfitMicros);
    assert.equal(micros(node("scenario-revenue").textContent), run.metrics.platformRevenueMicros);
    assert.equal(micros(node("scenario-treasury").textContent), run.metrics.treasurySpentMicros);
    assert.equal(micros(node("scenario-affiliate").textContent), run.metrics.affiliatePayoutMicros);
    assert.equal(node("scenario-failed").textContent, String(run.metrics.failedActions));
    assert.equal(node("scenario-region").textContent, cell.summary.region);
    assert.equal(node("scenario-run-hash").title, run.runHash);
    assert.match(node("claim-list").textContent, /not established as globally optimal/);
    dom.window.close();
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
});

test("demo rejects mismatched or altered run artifacts", () => {
  const output = mkdtempSync(join(tmpdir(), "boid-demo-parity-"));
  try {
    execFileSync(process.execPath, ["src/demo/demo-cli.ts", output], { cwd: process.cwd(), encoding: "utf8" });
    const read = (name) => JSON.parse(readFileSync(join(output, `${name}.json`), "utf8"));
    const finding = read("finding");
    const comparison = read("comparison");
    const sensitivity = read("sensitivity");
    const recommendation = read("recommendation");
    comparison.witness.baselineProfitMicros = "999000000";
    assert.throws(() => buildDemoData(finding, comparison, sensitivity, recommendation), /hash is invalid/);
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
});
