import test from "node:test";
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
