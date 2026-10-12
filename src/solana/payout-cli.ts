import { canonicalJson } from "../economic-model/canonical.ts";
import { liteRuntime, validatorRuntime } from "./local-runtime.ts";
import { verifyPayoutFixture } from "./payout-fixture.ts";

const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--validator" && arg !== "--json")) {
  throw new Error("Usage: npm run payout -- [--validator] [--json]");
}
const result = await verifyPayoutFixture(args.includes("--validator") ? validatorRuntime : liteRuntime);
if (args.includes("--json")) process.stdout.write(canonicalJson(result));
else {
  console.log(`${result.runtime}: ${result.rows.length} SPL execution/parity cases passed.`);
  for (const row of result.rows) console.log(`${row.case}: ${row.ok ? "matched BOID" : `rejected (${row.error})`}; fee ${row.feeLamports} lamports`);
  const starter = result.rows.find((row) => row.case === "purchase-5000000");
  console.log(`5 token purchase balances (minor units): ${JSON.stringify(starter?.after)}`);
  console.log(`Model: ${result.modelHash}\nEvidence: ${result.evidenceHash}`);
  console.log(`Economic parity hash: ${result.economicHash}`);
  console.log("Trusted client settlement; offchain referral eligibility and receipt tracking. Local test token only.");
}
