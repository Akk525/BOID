import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import { address, getTransactionDecoder, lamports } from "@solana/kit";
import { FailedTransactionMetadata, LiteSVM } from "litesvm";

export type LocalRuntime = {
  name: string;
  version(): Promise<string>;
  rent(size: number): Promise<number>;
  fund(key: PublicKey): Promise<void>;
  blockhash(): Promise<string>;
  balance(key: PublicKey): Promise<bigint>;
  data(key: PublicKey): Promise<Buffer>;
  send(tx: Transaction): Promise<{ ok: boolean; error: string | null; logs: string[] }>;
};

/** No network or account injection: setup and settlement both execute instructions. */
export function liteRuntime(): LocalRuntime {
  const svm = new LiteSVM();
  return {
    name: "LiteSVM 1.6.0",
    version: async () => "litesvm@1.6.0",
    rent: async (size) => Number(svm.minimumBalanceForRentExemption(BigInt(size))),
    fund: async (key) => {
      const result = svm.airdrop(address(key.toBase58()), lamports(2_000_000_000n));
      if (result instanceof FailedTransactionMetadata) throw new Error(String(result.err()));
    },
    blockhash: async () => {
      svm.expireBlockhash();
      return svm.latestBlockhash();
    },
    balance: async (key) => svm.getBalance(address(key.toBase58())) ?? 0n,
    data: async (key) => {
      const account = svm.getAccount(address(key.toBase58()));
      if (!account.exists) throw new Error(`Missing account ${key.toBase58()}`);
      return Buffer.from(account.data);
    },
    send: async (tx) => {
      const result = svm.sendTransaction(getTransactionDecoder().decode(tx.serialize()));
      return result instanceof FailedTransactionMetadata
        ? { ok: false, error: String(result.err()), logs: result.meta().logs() }
        : { ok: true, error: null, logs: result.logs() };
    },
  };
}

/** Fixed loopback endpoint; this fixture cannot be pointed at a public cluster. */
export function validatorRuntime(): LocalRuntime {
  const connection = new Connection("http://127.0.0.1:8899", "confirmed");
  return {
    name: "solana-test-validator (127.0.0.1:8899)",
    version: async () => (await connection.getVersion())["solana-core"],
    rent: (size) => connection.getMinimumBalanceForRentExemption(size),
    fund: async (key) => {
      const signature = await connection.requestAirdrop(key, 2_000_000_000);
      const result = await connection.confirmTransaction(signature, "confirmed");
      if (result.value.err) throw new Error(JSON.stringify(result.value.err));
    },
    blockhash: async () => (await connection.getLatestBlockhash()).blockhash,
    balance: async (key) => BigInt(await connection.getBalance(key)),
    data: async (key) => {
      const account = await connection.getAccountInfo(key);
      if (!account) throw new Error(`Missing account ${key.toBase58()}`);
      return account.data;
    },
    send: async (tx) => {
      const signature = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
      const result = await connection.confirmTransaction(signature, "confirmed");
      const details = await connection.getTransaction(signature, { commitment: "confirmed" });
      return { ok: result.value.err === null, error: result.value.err === null
        ? null : JSON.stringify(result.value.err), logs: details?.meta?.logMessages ?? [] };
    },
  };
}
