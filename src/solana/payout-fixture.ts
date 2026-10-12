import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import {
  ACCOUNT_SIZE, AccountLayout, MINT_SIZE, MintLayout, TOKEN_PROGRAM_ID,
  createInitializeAccountInstruction, createInitializeMintInstruction,
  createMintToCheckedInstruction, createTransferCheckedInstruction,
} from "@solana/spl-token";
import { parseEconomicModel } from "../economic-model/model.ts";
import type { EconomicState, PurchaseAction } from "../economic-model/model.ts";
import { step } from "../economic-model/step.ts";
import { hashCanonical } from "../economic-model/canonical.ts";
import type { LocalRuntime } from "./local-runtime.ts";

const ids = ["buyer-1", "creator-1", "affiliate-1", "platform", "campaignTreasury"] as const;
type Actor = typeof ids[number];
type Fault = "wrong-mint" | "wrong-authority" | "wrong-decimals";
const initial = (buyer = "40000000", treasury = "10000000"): EconomicState => ({
  balances: { "buyer-1": buyer, "creator-1": "0", "affiliate-1": "0", platform: "0", campaignTreasury: treasury },
  completedPurchases: {}, tick: 0,
});

/** Hand-authored B14 fixture, not a model-to-code generator. */
export async function createPayoutFixture(runtime: LocalRuntime, before = initial()) {
  const payer = Keypair.generate();
  const mint = Keypair.generate();
  const otherMint = Keypair.generate();
  const owners = Object.fromEntries(ids.map((id) => [id, Keypair.generate()])) as Record<Actor, Keypair>;
  const accounts = Object.fromEntries(ids.map((id) => [id, Keypair.generate()])) as Record<Actor, Keypair>;
  await runtime.fund(payer.publicKey);
  let sequence = 0;
  async function send(instructions: TransactionInstruction[], signers: Keypair[] = []) {
    const tx = new Transaction({ feePayer: payer.publicKey, recentBlockhash: await runtime.blockhash() });
    tx.add(...instructions);
    // Distinct orders can have identical payouts within one validator blockhash.
    tx.add(new TransactionInstruction({ programId: new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"),
      keys: [], data: Buffer.from(`boid-local-${sequence++}`) }));
    tx.sign(payer, ...signers);
    return runtime.send(tx);
  }
  for (const tokenMint of [mint, otherMint]) {
    const result = await send([
      SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: tokenMint.publicKey,
        space: MINT_SIZE, lamports: await runtime.rent(MINT_SIZE), programId: TOKEN_PROGRAM_ID }),
      createInitializeMintInstruction(tokenMint.publicKey, 6, payer.publicKey, null),
    ], [tokenMint]);
    assert.equal(result.ok, true, result.error ?? "mint setup failed");
  }
  for (const id of ids) {
    const result = await send([
      SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: accounts[id].publicKey,
        space: ACCOUNT_SIZE, lamports: await runtime.rent(ACCOUNT_SIZE), programId: TOKEN_PROGRAM_ID }),
      createInitializeAccountInstruction(accounts[id].publicKey, mint.publicKey, owners[id].publicKey),
      createMintToCheckedInstruction(mint.publicKey, accounts[id].publicKey, payer.publicKey,
        BigInt(before.balances[id] ?? "0"), 6),
    ], [accounts[id]]);
    assert.equal(result.ok, true, result.error ?? "token account setup failed");
  }
  let state = structuredClone(before);
  // In-memory trusted-service receipt table; no persistent or onchain replay protection.
  const receipts = new Set<string>();
  async function balances() {
    return Object.fromEntries(await Promise.all(ids.map(async (id) => {
      const account = AccountLayout.decode(await runtime.data(accounts[id].publicKey));
      assert.ok(account.mint.equals(mint.publicKey));
      assert.ok(account.owner.equals(owners[id].publicKey));
      return [id, account.amount.toString()];
    })));
  }
  const supply = async () => MintLayout.decode(await runtime.data(mint.publicKey)).supply.toString();
  return {
    balances, supply,
    async settle(receipt: string, amountMicros: string, options: { affiliate?: boolean; fault?: Fault } = {}) {
      const snapshot = await balances();
      const feeBefore = await runtime.balance(payer.publicKey);
      if (receipts.has(receipt)) return { ok: false, error: "duplicate settlement receipt", logs: [], feeLamports: "0", before: snapshot, after: snapshot };
      const price = BigInt(amountMicros);
      assert.ok(price > 0n && price <= 18_446_744_073_709_551_615n);
      const fee = price / 10n;
      const eligible = options.affiliate !== false && (state.completedPurchases["buyer-1"] ?? 0) === 0 && price >= 5_000_000n;
      const award = eligible ? fee * 4n / 10n : 0n;
      const transfer = (from: Actor, to: Actor, amount: bigint, faulty = false) =>
        createTransferCheckedInstruction(accounts[from].publicKey,
          faulty && options.fault === "wrong-mint" ? otherMint.publicKey : mint.publicKey,
          accounts[to].publicKey,
          faulty && options.fault === "wrong-authority" ? payer.publicKey : owners[from].publicKey,
          amount, faulty && options.fault === "wrong-decimals" ? 5 : 6);
      const instructions = [transfer("buyer-1", "platform", fee), transfer("buyer-1", "creator-1", price - fee)];
      if (eligible) instructions.push(transfer("campaignTreasury", "affiliate-1", award, true));
      const signers = [owners["buyer-1"], ...(eligible && options.fault !== "wrong-authority" ? [owners.campaignTreasury] : [])];
      const result = await send(instructions, signers);
      if (result.ok) {
        receipts.add(receipt);
        state.completedPurchases["buyer-1"] = (state.completedPurchases["buyer-1"] ?? 0) + 1;
        state.tick++;
      }
      return { ...result, feeLamports: (feeBefore - await runtime.balance(payer.publicKey)).toString(),
        before: snapshot, after: await balances() };
    },
  };
}

export async function verifyPayoutFixture(makeRuntime: () => LocalRuntime) {
  const model = parseEconomicModel(JSON.parse(readFileSync("fixtures/creator-marketplace/economic-model.fee-funded.v1.json", "utf8")));
  const rows = [];
  for (const amount of ["1", "9", "10", "11", "4999999", "5000000", "5000001", "5000029", "20000000"]) {
    const runtime = makeRuntime();
    const fixture = await createPayoutFixture(runtime);
    const action: PurchaseAction = { type: "purchase", buyer: "buyer-1", creator: "creator-1", affiliate: "affiliate-1", amountMicros: amount };
    const expected = step(initial(), action, model);
    assert.ok(expected.ok);
    const supply = await fixture.supply();
    const actual = await fixture.settle("order-1", amount);
    assert.equal(actual.ok, true, actual.error ?? "settlement failed");
    assert.deepEqual(actual.after, expected.state.balances);
    assert.equal(await fixture.supply(), supply);
    rows.push({ case: `purchase-${amount}`, ...actual });
    const duplicate = await fixture.settle("order-1", amount);
    assert.equal(duplicate.ok, false);
    assert.deepEqual(duplicate.after, actual.after);
    assert.equal(duplicate.feeLamports, "0");
    rows.push({ case: `duplicate-${amount}`, ...duplicate });
    // New receipt still cannot collect a second first-purchase award.
    const repeatedExpected = step(expected.state, action, model);
    assert.ok(repeatedExpected.ok);
    const repeated = await fixture.settle("order-2", amount);
    assert.equal(repeated.ok, true, repeated.error ?? "repeat settlement failed");
    assert.deepEqual(repeated.after, repeatedExpected.state.balances);
    rows.push({ case: `repeat-${amount}`, ...repeated });
  }
  const absent = await createPayoutFixture(makeRuntime());
  const absentExpected = step(initial(), { type: "purchase", buyer: "buyer-1", creator: "creator-1", amountMicros: "5000000" }, model);
  assert.ok(absentExpected.ok);
  const absentResult = await absent.settle("no-referral", "5000000", { affiliate: false });
  assert.equal(absentResult.ok, true);
  assert.deepEqual(absentResult.after, absentExpected.state.balances);
  rows.push({ case: "absent-affiliate", ...absentResult });
  for (const fault of ["wrong-mint", "wrong-authority", "wrong-decimals", "buyer-funds", "treasury-funds"] as const) {
    const fixture = await createPayoutFixture(makeRuntime(), initial(fault === "buyer-funds" ? "4999999" : "40000000", fault === "treasury-funds" ? "199999" : "10000000"));
    const supply = await fixture.supply();
    const actual = await fixture.settle("order-1", "5000000", fault === "buyer-funds" || fault === "treasury-funds" ? {} : { fault });
    assert.equal(actual.ok, false, `Expected rejection for ${fault}`);
    const code = { "wrong-mint": 3, "wrong-authority": 4, "wrong-decimals": 18,
      "buyer-funds": 1, "treasury-funds": 1 }[fault];
    assert.ok(actual.logs.some((line) => line.includes(`custom program error: 0x${code.toString(16)}`)),
      `Expected SPL error ${code} for ${fault}: ${actual.error}`);
    assert.deepEqual(actual.after, actual.before, `Partial payout for ${fault}`);
    assert.equal(await fixture.supply(), supply);
    assert.ok(BigInt(actual.feeLamports) > 0n, "failed transaction must charge SOL fees");
    rows.push({ case: fault, ...actual });
  }
  const economicHash = hashCanonical(rows.map(({ case: name, ok, before, after, feeLamports }) =>
    ({ case: name, ok, before, after, feeLamports })));
  const runtime = makeRuntime();
  const sourceHashes = Object.fromEntries(["src/solana/payout-fixture.ts", "src/solana/local-runtime.ts", "package-lock.json"]
    .map((path) => [path, createHash("sha256").update(readFileSync(path)).digest("hex")]));
  const evidence = { schemaVersion: 1, runtime: runtime.name, runtimeVersion: await runtime.version(),
    sourceHashes, modelHash: hashCanonical(model), economicHash,
    asset: "local six-decimal SPL test token (not issuer-backed USDC)", rows };
  return { ...evidence, evidenceHash: hashCanonical(evidence) };
}
