import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { PublicKey } from "@solana/web3.js";
import { generatePayout, payoutConfigurationDiff, payoutTransfers, validateGeneratedPayout } from "./payout-generator.ts";
import { verifyGeneratedPayout } from "./generated-payout.ts";
import { hashCanonical } from "../economic-model/canonical.ts";

const read = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const baseline = () => read("fixtures/creator-marketplace/economic-model.v1.json");
const repair = () => read("fixtures/creator-marketplace/economic-model.fee-funded.v1.json");
const bindings = () => read("fixtures/solana-payout/reviewed-bindings.v1.json");

test("reviewed baseline and repair generate deterministic gold artifacts and distinct payouts", () => {
  const before = generatePayout(baseline(), bindings());
  const after = generatePayout(repair(), bindings());
  assert.deepEqual(before, read("fixtures/solana-payout/generated/baseline.v1.json"));
  assert.deepEqual(after, read("fixtures/solana-payout/generated/repair.v1.json"));
  assert.deepEqual(payoutConfigurationDiff(before, after), read("fixtures/solana-payout/generated/configuration.diff.json"));
  for (const [artifact, expected] of [[before, "1000000"], [after, "200000"]] as const) {
    const sample = artifact.cases.find((item) => item.name === "purchase-5000000");
    assert.ok(sample);
    assert.deepEqual(payoutTransfers(artifact, sample.initialState, sample.action).map((item) => item.amountMicros), ["500000", "4500000", expected]);
  }
});

test("unsupported economic policy, funding source and transfer grammar refuse generation", () => {
  for (const mutate of [
    (model: ReturnType<typeof repair>) => model.actions.purchase.transfers[2].when.all.pop(),
    (model: ReturnType<typeof repair>) => model.actions.purchase.transfers[2].when.all.push({ op: "present", role: "affiliate" }),
    (model: ReturnType<typeof repair>) => { model.actions.purchase.transfers[2].from = "platform"; },
    (model: ReturnType<typeof repair>) => { model.actions.purchase.transfers[2].amount.basis = "purchase.amount"; },
    (model: ReturnType<typeof repair>) => { model.parameters.minimumEligiblePurchase.value = "18446744073709551616"; },
    (model: ReturnType<typeof repair>) => model.actors[0].roles.push("affiliate"),
    (model: ReturnType<typeof repair>) => model.actions.purchase.transfers.push({ ...model.actions.purchase.transfers[2], id: "extraReward" }),
  ]) {
    const model = repair(); mutate(model);
    assert.throws(() => generatePayout(model, bindings()), /Refusing executable payout generation/);
  }
});

test("model actor names cannot inherit first-purchase state from Object.prototype", () => {
  const model = repair();
  model.actors[0].id = "constructor";
  const value = bindings(); value.accounts.buyer.actor = "constructor";
  const artifact = generatePayout(model, value);
  const sample = artifact.cases.find((item) => item.name === "purchase-5000000");
  assert.ok(sample);
  assert.equal(payoutTransfers(artifact, sample.initialState, sample.action)[2]?.amountMicros, "200000");
});

test("missing owners or eligibility authority, PDA signing and invalid account bindings fail closed", () => {
  for (const mutate of [
    (value: ReturnType<typeof bindings>) => { delete value.accounts.campaignTreasury.owner; },
    (value: ReturnType<typeof bindings>) => { delete value.eligibilityAuthority; },
    (value: ReturnType<typeof bindings>) => { value.accounts.buyer.owner = "invalid"; },
    (value: ReturnType<typeof bindings>) => { value.accounts.creator.actor = "buyer-1"; },
    (value: ReturnType<typeof bindings>) => { value.accounts.affiliate.tokenAccount = value.accounts.creator.tokenAccount; },
    (value: ReturnType<typeof bindings>) => { value.decimals = 9; },
    (value: ReturnType<typeof bindings>) => { value.tokenProgram = "unsupported"; },
    (value: ReturnType<typeof bindings>) => { value.accounts.campaignTreasury.owner = PublicKey.findProgramAddressSync([Buffer.from("unsupported")], new PublicKey(value.tokenProgram))[0].toBase58(); },
  ]) {
    const value = bindings(); mutate(value);
    assert.throws(() => generatePayout(repair(), value), /Refusing executable payout generation/);
  }
});

test("tampering with config or generated expectations fails even with a refreshed artifact hash", () => {
  for (const mutate of [
    (value: ReturnType<typeof generatePayout>) => { value.configuration.minimumEligiblePurchase = "1"; },
    (value: ReturnType<typeof generatePayout>) => { value.assumptions = []; },
    (value: ReturnType<typeof generatePayout>) => { value.cases = []; },
  ]) {
    const artifact = generatePayout(repair(), bindings()); mutate(artifact);
    const { artifactHash: _hash, ...body } = artifact;
    artifact.artifactHash = hashCanonical(body);
    assert.throws(() => validateGeneratedPayout(artifact), /differs from the reviewed model/);
    assert.throws(() => payoutTransfers(artifact, {}, {}), /Refusing executable payout generation/);
  }
});

test("CLI refuses unsupported authority without emitting output", () => {
  const directory = mkdtempSync(join(tmpdir(), "boid-payout-generator-"));
  try {
    const value = bindings(); delete value.eligibilityAuthority;
    const input = join(directory, "bindings.json");
    const output = join(directory, "generated");
    writeFileSync(input, JSON.stringify(value));
    assert.throws(() => execFileSync(process.execPath, ["src/solana/generate-payout-cli.ts",
      "fixtures/creator-marketplace/economic-model.v1.json", "fixtures/creator-marketplace/economic-model.fee-funded.v1.json", input, output], { stdio: "pipe" }), /Command failed/);
    assert.equal(existsSync(output), false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("generated baseline and repair execute with model parity on SPL Token", async () => {
  for (const model of [baseline(), repair()]) {
    const result = await verifyGeneratedPayout(generatePayout(model, bindings()));
    assert.equal(result.rows.length, 9);
  }
});
