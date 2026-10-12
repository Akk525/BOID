import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import { ACCOUNT_SIZE, AccountLayout, MINT_SIZE, TOKEN_PROGRAM_ID, createInitializeAccountInstruction,
  createInitializeMintInstruction, createMintToCheckedInstruction, createTransferCheckedInstruction } from "@solana/spl-token";
import { hashCanonical } from "../economic-model/canonical.ts";
import { generatePayout, PAYOUT_ROLES, payoutTransfers, validateGeneratedPayout } from "./payout-generator.ts";
import { liteRuntime } from "./local-runtime.ts";
import type { LocalRuntime } from "./local-runtime.ts";

/** Run emitted tests with explicit, fresh test-account bindings, never real-wallet keys. */
export async function verifyGeneratedPayout(input: unknown, makeRuntime: () => LocalRuntime = liteRuntime) {
  const artifact = validateGeneratedPayout(input);
  const rows = [];
  for (const sample of artifact.cases) {
    const runtime = makeRuntime();
    const payer = Keypair.generate();
    const mint = Keypair.generate();
    const actors = PAYOUT_ROLES.map((role) => ({ role, owner: Keypair.generate(), account: Keypair.generate(),
      id: artifact.configuration.bindings.accounts[role].actor }));
    await runtime.fund(payer.publicKey);
    let sequence = 0;
    async function send(instructions: TransactionInstruction[], signers: Keypair[]) {
      const tx = new Transaction({ feePayer: payer.publicKey, recentBlockhash: await runtime.blockhash() });
      tx.add(...instructions, new TransactionInstruction({ programId: new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"),
        keys: [], data: Buffer.from(`boid-generated-${sequence++}`) }));
      tx.sign(payer, ...signers);
      return runtime.send(tx);
    }
    const mintSetup = await send([
      SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: mint.publicKey,
        lamports: await runtime.rent(MINT_SIZE), space: MINT_SIZE, programId: TOKEN_PROGRAM_ID }),
      createInitializeMintInstruction(mint.publicKey, 6, payer.publicKey, null),
    ], [mint]);
    assert.equal(mintSetup.ok, true, mintSetup.error ?? "mint setup failed");
    for (const actor of actors) {
      const setup = await send([
        SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: actor.account.publicKey,
          lamports: await runtime.rent(ACCOUNT_SIZE), space: ACCOUNT_SIZE, programId: TOKEN_PROGRAM_ID }),
        createInitializeAccountInstruction(actor.account.publicKey, mint.publicKey, actor.owner.publicKey),
        createMintToCheckedInstruction(mint.publicKey, actor.account.publicKey, payer.publicKey,
          BigInt(sample.initialState.balances[actor.id] ?? "0"), 6),
      ], [actor.account]);
      assert.equal(setup.ok, true, setup.error ?? "account setup failed");
    }
    // Test harness supplies real local owners/accounts; the generator never makes keys.
    const bindings = { ...artifact.configuration.bindings, mint: mint.publicKey.toBase58(), feePayer: payer.publicKey.toBase58(),
      eligibilityAuthority: payer.publicKey.toBase58(), accounts: Object.fromEntries(actors.map((actor) =>
        [actor.role, { actor: actor.id, owner: actor.owner.publicKey.toBase58(), tokenAccount: actor.account.publicKey.toBase58() }])),
      review: { reviewer: "local test harness", note: "Fresh test mint and explicit test-role bindings; not deployment bindings." } };
    const bound = generatePayout(artifact.model, bindings);
    const transfers = payoutTransfers(bound, sample.initialState, sample.action);
    if (sample.expected.ok) assert.deepEqual(transfers.map((transfer) => ({ ruleId: transfer.ruleId,
      from: bound.configuration.bindings.accounts[transfer.from].actor,
      to: bound.configuration.bindings.accounts[transfer.to].actor, amountMicros: transfer.amountMicros })),
    sample.expected.journal.map(({ ruleId, from, to, amountMicros }) => ({ ruleId, from, to, amountMicros })));
    const instructions = transfers.map((transfer) => createTransferCheckedInstruction(
      new PublicKey(bound.configuration.bindings.accounts[transfer.from].tokenAccount), new PublicKey(bindings.mint),
      new PublicKey(bound.configuration.bindings.accounts[transfer.to].tokenAccount),
      new PublicKey(bound.configuration.bindings.accounts[transfer.from].owner), BigInt(transfer.amountMicros), 6));
    const debitedRoles = new Set(transfers.map((transfer) => transfer.from));
    const feeBefore = await runtime.balance(payer.publicKey);
    const result = await send(instructions, actors.filter((actor) => debitedRoles.has(actor.role)).map((actor) => actor.owner));
    assert.equal(result.ok, sample.expected.ok, `${sample.name}: ${result.error}`);
    const balances = Object.fromEntries(await Promise.all(actors.map(async (actor) => {
      const account = AccountLayout.decode(await runtime.data(actor.account.publicKey));
      assert.ok(account.mint.equals(mint.publicKey));
      assert.ok(account.owner.equals(actor.owner.publicKey));
      return [actor.id, account.amount.toString()];
    })));
    assert.deepEqual(balances, sample.expected.ok ? sample.expected.state.balances : sample.initialState.balances);
    rows.push({ case: sample.name, ok: result.ok, balances,
      feeLamports: (feeBefore - await runtime.balance(payer.publicKey)).toString() });
  }
  const runtime = makeRuntime();
  const sourceHashes = Object.fromEntries(["src/solana/payout-generator.ts", "src/solana/generated-payout.ts", "src/solana/local-runtime.ts", "package-lock.json"]
    .map((path) => [path, createHash("sha256").update(readFileSync(path)).digest("hex")]));
  const evidence = { artifactHash: artifact.artifactHash, runtime: runtime.name, runtimeVersion: await runtime.version(),
    sourceHashes, rows, economicHash: hashCanonical(rows) };
  return { ...evidence, evidenceHash: hashCanonical(evidence) };
}
