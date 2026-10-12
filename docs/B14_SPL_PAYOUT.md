# B14 local SPL payout fixture

The [hand-authored fixture](../src/solana/payout-fixture.ts) executes the reviewed [fee-funded repair model](../fixtures/creator-marketplace/economic-model.fee-funded.v1.json) using the ordinary SPL Token program. It creates a six-decimal test mint and token accounts through real instructions, mints fixture balances, then bundles the platform fee, creator payout and eligible affiliate award into one signed transaction. No custom program, model-to-code generator, wallet connection or deployment is involved.

## Run

With Node 24+:

```sh
npm ci
npm run payout
npm run --silent payout -- --json
```

The default runner uses pinned LiteSVM 1.6.0, with signature verification and blockhash checking enabled. `npm test` includes this execution/parity suite. Setup uses ordinary mint/account instructions, not injected token-account state.

For RPC execution, start a fresh local validator in another terminal (the acceptance run used Agave 3.1.10):

```sh
solana-test-validator --ledger /tmp/boid-b14-local-ledger --bind-address 127.0.0.1 --rpc-port 8899 --faucet-port 9900 --quiet
```

Then run:

```sh
npm run payout -- --validator
npm run --silent payout -- --validator --json
```

The RPC address is fixed to `127.0.0.1:8899`. Actors, mint authority and fee payer are ephemeral fixture keypairs; no keys are saved or read from a wallet. The local faucet funds setup and fees. Stop the validator with Ctrl-C after the run.

## Exact settlement

The independent client arithmetic is deliberately fixed to the reviewed repair: `fee = floor(price / 10)`, `creator = price - fee`, and an eligible first-purchase `award = floor(fee × 4 / 10)`. The creator receives the rounding remainder. The suite separately executes BOID's `step` and compares **every actor's resulting token balance** with decoded SPL accounts. Changing the model to a different mechanism requires another reviewed fixture; this code does not import arbitrary models into executable payouts.

For a 5-token purchase, in six-decimal minor units:

| Account | Before | After | Change |
| --- | ---: | ---: | ---: |
| Buyer | 40,000,000 | 35,000,000 | −5,000,000 |
| Creator | 0 | 4,500,000 | +4,500,000 |
| Platform | 0 | 500,000 | +500,000 |
| Affiliate | 0 | 200,000 | +200,000 |
| Campaign treasury | 10,000,000 | 9,800,000 | −200,000 |

**Funding distinction:** the checked-in repair sizes the award from the collected platform fee but still debits the campaign treasury. This fixture preserves that model exactly. It does not redirect the award from the platform or claim the treasury is untouched.

## Authority and eligibility assumptions

- One allowed mint and five distinct role-bound token accounts are created locally. Each transfer uses `TransferChecked` with that mint and six decimals. Decoded accounts are checked against their expected mint and owner.
- The buyer signs its fee/payout debits. The campaign-treasury owner signs the affiliate debit. A separate local fee payer signs and pays transaction fees; the mint authority only funds setup. These keys are under the fixture's control, representing trusted client settlement rather than protocol-enforced economic rules.
- A trusted service supplies the referral relationship and tracks first-purchase eligibility and receipt IDs in memory. The fixture's buyer and affiliate addresses differ; this does not establish independent human identities or resist Sybils. Without a supplied affiliate, there is no award.
- All payout instructions share one transaction, so an SPL rejection rolls back all token changes. First-purchase counters and receipts advance only after success. Duplicate receipts are rejected by the service before submission and cost zero transaction fees.
- Receipt protection lasts only for this process. SPL Token has no order-ID or referral-policy enforcement; a newly signed transaction can repeat a payment if the trusted service loses its state or authorizes it. Durable storage, concurrent submission handling and crash recovery are outside this prototype.
- SOL setup rent and transaction fees are separate from token balances. Reports show observed settlement fees, including rejected transactions. They do not convert SOL into USDC or establish coalition net profit. This test mint is not issuer-backed USDC.

These choices follow the documented [TransferChecked mint/decimals checks and owner-signature requirement](https://solana.com/docs/tokens/basics/transfer-tokens).

## Evidence and validation

The 33 recorded cases cover 1/9/10/11 minor units; minimum eligibility −1/at/+1; nested fee-share rounding at 5,000,029 units; a 20-token purchase; repeated purchases; duplicate receipts; an absent affiliate; and wrong mint, wrong authority, wrong decimals, insufficient buyer funds and insufficient treasury funds. Each runtime rejection is checked for its specific SPL error, unchanged balances and supply, and a charged SOL fee. Successful payouts preserve supply and match BOID; repeated purchases match BOID without a second affiliate award.

The [LiteSVM bundle](../fixtures/solana-payout/litesvm.v1.json) and [validator bundle](../fixtures/solana-payout/validator.v1.json) record normalized role balances, fees, logs, errors, model hash, runtime version, fixture-source SHA-256 values and package-lock SHA-256. Public keys are deliberately omitted from these economic snapshots because each run creates fresh actors. `economicHash` covers case names, success/rejection, before/after token balances and settlement fees, allowing direct cross-runtime comparison. `evidenceHash` covers the complete bundle except itself; logs and runtime-specific error formatting can make that hash differ between runtimes.

This demonstrates a local realization of the marketplace repair under stated trust assumptions. It does not implement the proposed Solana launch model or establish production settlement enforcement.
