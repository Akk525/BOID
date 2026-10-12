import test from "node:test";
import { liteRuntime } from "./local-runtime.ts";
import { verifyPayoutFixture } from "./payout-fixture.ts";

test("SPL execution matches reviewed BOID repair, including atomic failure and service receipts", async () => {
  await verifyPayoutFixture(liteRuntime);
});
