import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { canonicalJson } from "../economic-model/canonical.ts";
import { searchStrategies } from "../economic-model/search.ts";
import { step } from "../economic-model/step.ts";
import { approveMarketplace, extractMarketplace, ExtractionError } from "./extract.ts";
import type { ExtractionReview } from "./extract.ts";
import { snapshotLocal } from "./snapshot.ts";

const fixture = "fixtures/creator-marketplace";
const goldPath = `${fixture}/economic-model.v1.json`;
const reviewPath = `${fixture}/extraction-review.v1.json`;

function review(): ExtractionReview {
  return JSON.parse(readFileSync(reviewPath, "utf8"));
}

test("fixture draft matches the gold model and approved output runs through B06 unchanged", () => {
  const snapshot = snapshotLocal(fixture);
  const draft = extractMarketplace(snapshot);
  assert.equal(draft.readyForReview, true);
  assert.ok(Object.values(draft.claims).every((item) => item.status === "known"));
  const model = approveMarketplace(snapshot, draft, review());
  const gold = JSON.parse(readFileSync(goldPath, "utf8"));
  assert.equal(canonicalJson(model), canonicalJson(gold));
  for (const item of Object.values(draft.claims)) {
    const candidate = item.candidates[0]!;
    assert.ok(candidate.span.text.length);
    assert.equal(candidate.span.fileSha256, snapshot.files.find((file) =>
      file.path === candidate.span.path)?.sha256);
  }
  const input = JSON.parse(readFileSync(`${fixture}/search-input.v1.json`, "utf8"));
  const extractedResult = searchStrategies(input.initialState, model, input.config);
  const goldResult = searchStrategies(input.initialState, gold, input.config);
  assert.equal(canonicalJson(extractedResult), canonicalJson(goldResult));
  assert.equal(extractedResult.findings[0]?.trace.score.profitMicros, "340000");
  const cliDraft = JSON.parse(execFileSync(process.execPath, ["src/repository/extract-cli.ts", fixture], { encoding: "utf8" }));
  const cliModel = JSON.parse(execFileSync(process.execPath, [
    "src/repository/extract-cli.ts", fixture, "--review", reviewPath,
  ], { encoding: "utf8" }));
  assert.equal(canonicalJson(cliDraft), canonicalJson(draft));
  assert.equal(canonicalJson(cliModel), canonicalJson(gold));
});

test("an altered mechanism extracts changed numbers and a new reviewed model", () => {
  const root = mkdtempSync(join(tmpdir(), "boid-extract-"));
  try {
    cpSync(join(fixture, "src"), join(root, "src"), { recursive: true });
    const configPath = join(root, "src", "config.mjs");
    const config = readFileSync(configPath, "utf8")
      .replace("PLATFORM_FEE_BPS = 1_000", "PLATFORM_FEE_BPS = 500")
      .replace("BONUS_MICROS = 1_000_000", "BONUS_MICROS = 2_000_000")
      .replace("ORDER_MICROS = 5_000_000", "ORDER_MICROS = 6_000_000");
    writeFileSync(configPath, config);
    const snapshot = snapshotLocal(root);
    const draft = extractMarketplace(snapshot);
    assert.equal(draft.readyForReview, true);
    assert.equal(draft.claims.platformFeeSource.candidates[0]?.value, "0.05");
    assert.equal(draft.claims.affiliateBonusSource.candidates[0]?.value, "2000000");
    assert.equal(draft.claims.minimumEligiblePurchaseSource.candidates[0]?.value, "6000000");
    const edited = review();
    edited.sourceRepository = "altered-marketplace";
    edited.sourceCommit = snapshot.snapshotHash;
    for (const [id, item] of Object.entries(draft.claims)) {
      const candidate = item.candidates[0]!;
      edited.claims[id as keyof typeof edited.claims] = {
        value: candidate.value,
        span: { path: candidate.span.path, startLine: candidate.span.startLine,
          endLine: candidate.span.endLine, fileSha256: candidate.span.fileSha256 },
      };
    }
    const model = approveMarketplace(snapshot, draft, edited);
    assert.equal(model.parameters.platformFeeRate?.value, "0.05");
    assert.equal(model.parameters.affiliateBonus?.value, "2000000");
    const input = JSON.parse(readFileSync(`${fixture}/search-input.v1.json`, "utf8"));
    const result = step(input.initialState, {
      type: "purchase", buyer: "buyer-1", creator: "creator-1", affiliate: "affiliate-1", amountMicros: "6000000",
    }, model);
    assert.equal(result.ok, true);
    if (result.ok) assert.deepEqual(result.journal.map((entry) => entry.amountMicros),
      ["300000", "5700000", "2000000"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("missing and conflicting rules remain unresolved and cannot be approved", () => {
  const root = mkdtempSync(join(tmpdir(), "boid-extract-"));
  try {
    cpSync(join(fixture, "src"), join(root, "src"), { recursive: true });
    const referralPath = join(root, "src", "referrals.mjs");
    writeFileSync(referralPath, readFileSync(referralPath, "utf8")
      .replace("if (priorPurchases !== 0) return 0;", "// first-purchase rule removed"));
    let snapshot = snapshotLocal(root);
    let draft = extractMarketplace(snapshot);
    assert.equal(draft.claims.firstPurchaseSource.status, "unresolved");
    assert.throws(() => approveMarketplace(snapshot, draft, review()), ExtractionError);

    writeFileSync(referralPath, readFileSync(join(fixture, "src", "referrals.mjs"), "utf8"));
    const configPath = join(root, "src", "config.mjs");
    writeFileSync(configPath, readFileSync(configPath, "utf8") +
      "\nexport const FIRST_PURCHASE_AFFILIATE_BONUS_MICROS = 9_000_000;\n");
    snapshot = snapshotLocal(root);
    draft = extractMarketplace(snapshot);
    assert.equal(draft.claims.affiliateBonusSource.status, "conflict");
    assert.equal(draft.claims.affiliateBonusSource.candidates.length, 2);
    assert.throws(() => approveMarketplace(snapshot, draft, review()), ExtractionError);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("text inside comments and templates is not treated as source evidence", () => {
  const root = mkdtempSync(join(tmpdir(), "boid-extract-"));
  try {
    cpSync(join(fixture, "src"), join(root, "src"), { recursive: true });
    const configPath = join(root, "src", "config.mjs");
    writeFileSync(configPath, readFileSync(configPath, "utf8") +
      "\n/*\nexport const PLATFORM_FEE_BPS = 9_999;\n*/\n" +
      "const example = `\nexport const PLATFORM_FEE_BPS = 8_888;\n`;\n");
    const draft = extractMarketplace(snapshotLocal(root));
    assert.equal(draft.claims.platformFeeSource.status, "known");
    assert.equal(draft.claims.platformFeeSource.candidates[0]?.value, "0.10");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("invented spans, values, source commits, and missing objectives are rejected", () => {
  const snapshot = snapshotLocal(fixture);
  const draft = extractMarketplace(snapshot);
  const invented = review();
  invented.claims.platformFeeSource.span.startLine = 2;
  assert.throws(() => approveMarketplace(snapshot, draft, invented), /exact source span/);
  const changedValue = review();
  changedValue.claims.platformFeeSource.value = "0.20";
  assert.throws(() => approveMarketplace(snapshot, draft, changedValue), /extracted value/);
  const wrongCommit = review();
  wrongCommit.sourceCommit = "0".repeat(40);
  assert.throws(() => approveMarketplace(snapshot, draft, wrongCommit), /verify the local source commit/);
  const noObjective = review();
  noObjective.objectives = [];
  assert.throws(() => approveMarketplace(snapshot, draft, noObjective), /Invalid review/);
});
