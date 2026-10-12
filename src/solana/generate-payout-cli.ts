import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { canonicalJson } from "../economic-model/canonical.ts";
import { generatePayout, payoutConfigurationDiff } from "./payout-generator.ts";

try {
  const [baselinePath, repairPath, bindingsPath, output, ...extra] = process.argv.slice(2);
  if (!baselinePath || !repairPath || !bindingsPath || !output || extra.length) throw new Error(
    "Usage: npm run generate-payout -- <baseline-model.json> <repair-model.json> <reviewed-bindings.json> <output-directory>");
  const read = (path: string) => JSON.parse(readFileSync(path, "utf8"));
  const bindings = read(bindingsPath);
  const baseline = generatePayout(read(baselinePath), bindings);
  const repair = generatePayout(read(repairPath), bindings);
  // Validate both sides before writing any output.
  mkdirSync(output, { recursive: true });
  writeFileSync(join(output, "baseline.v1.json"), canonicalJson(baseline));
  writeFileSync(join(output, "repair.v1.json"), canonicalJson(repair));
  writeFileSync(join(output, "configuration.diff.json"), canonicalJson(payoutConfigurationDiff(baseline, repair)));
  writeFileSync(join(output, "ASSUMPTIONS.md"), "# Reviewed SPL payout assumptions\n\n" + repair.assumptions.map((line) => `- ${line}`).join("\n") + "\n");
  writeFileSync(join(output, "generated.test.mjs"), `import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
const { verifyGeneratedPayout } = await import(pathToFileURL(resolve("src/solana/generated-payout.ts")));
const { liteRuntime, validatorRuntime } = await import(pathToFileURL(resolve("src/solana/local-runtime.ts")));
for (const name of ["baseline", "repair"]) {
  test(name + " generated payout matches BOID under local SPL execution", async () => {
    const artifact = JSON.parse(readFileSync(new URL(name + ".v1.json", import.meta.url), "utf8"));
    const result = await verifyGeneratedPayout(artifact, process.env.BOID_PAYOUT_VALIDATOR === "1" ? validatorRuntime : liteRuntime);
    console.log(JSON.stringify({ name, ...result }));
  });
}
`);
  console.log(`Generated reviewed baseline/repair configs, diff, assumptions and local SPL tests in ${output}.`);
  console.log(`Run from the repo root: node --test ${join(output, "generated.test.mjs")}`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
