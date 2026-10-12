# B15 reviewed payout generation

`generate-payout` maps a validated economic model into the fixed `spl-purchase.v1` client-settlement template. It accepts the marketplace baseline's fixed treasury bonus and the repair's share of the collected platform fee. Rates, threshold, rule IDs, evidence and recipients come from the model; mint, token accounts and signing owners must come from a separate reviewed bindings file.

## Generate and test

From the repository root:

```sh
npm run generate-payout -- \
  fixtures/creator-marketplace/economic-model.v1.json \
  fixtures/creator-marketplace/economic-model.fee-funded.v1.json \
  fixtures/solana-payout/reviewed-bindings.v1.json \
  /tmp/boid-generated-payout
node --test /tmp/boid-generated-payout/generated.test.mjs
```

The output contains `baseline.v1.json`, `repair.v1.json`, `configuration.diff.json`, `ASSUMPTIONS.md`, and runnable `generated.test.mjs`. The JSON bundles contain the complete input model, reviewed configuration, model-derived expected cases, assumptions and artifact hash. The [checked-in gold artifacts](../fixtures/solana-payout/generated) make the emitted changes inspectable. Generation does not deploy, sign, create accounts, or run the tests automatically.

The [example bindings](../fixtures/solana-payout/reviewed-bindings.v1.json) are public-key declarations for reviewing the output shape. They do not identify deployed accounts and no corresponding private keys are retained. Replace them with reviewed integration bindings before using a configuration outside this experiment. The generator does not make up authority addresses, PDA seeds or eligibility rules.

The emitted tests explicitly create a fresh local mint and role accounts, supply their actual public bindings to the generator, then sign with test-only keys. They preserve the input model and its rates, recipients, threshold and policy. This tests the template's actual transfers with reachable token-program setup; it does **not** establish ownership or existence of the example bindings.

For validator execution, start a fresh loopback validator as in [B14](B14_SPL_PAYOUT.md), then run:

```sh
BOID_PAYOUT_VALIDATOR=1 node --test /tmp/boid-generated-payout/generated.test.mjs
```

## Reviewable result

| Five-token first purchase | Baseline | Repair |
| --- | ---: | ---: |
| Platform fee | 0.5 | 0.5 |
| Creator payout | 4.5 | 4.5 |
| Treasury-funded affiliate award | 1 | 0.2 |

The configuration diff changes the affiliate award from a fixed `1000000` minor units to a `40/100` share of the already-rounded fee, along with its model hash and evidence. The fee itself is `10/100` of the purchase amount, and the creator gets the exact remainder. The award remains treasury-funded, preserving the model's funding source.

## Supported family and refusals

The generator requires exactly five single-role actors with distinct token accounts, an ordinary six-decimal SPL mint, signing owners, an explicit fee payer, a named offchain eligibility authority, and a reviewer/note. It accepts exactly these ordered transfers: unconditional buyer-to-platform purchase share; unconditional buyer-to-creator remainder; treasury-to-affiliate fixed bonus or collected-fee share. Eligibility must be the conjunction of affiliate present, buyer/affiliate accounts different, first purchase and the model's minimum purchase threshold. Rates use exact integer ratios and amounts must fit SPL `u64`.

Anything else refuses executable payout generation: extra rules, altered/missing eligibility, another funding source, unsupported arithmetic, Token-2022, wrong decimals, missing owners or eligibility authority, and PDA signing authorities. Both models and their bindings are validated **before any output directory is created**. Artifact validation regenerates the entire bundle and expected cases, so tampered rates, assumptions or tests fail even if someone refreshes the artifact hash.

`payoutTransfers` validates its bundle, state and action before emitting the fixed template's ordered transfer plan. The execution harness constructs `TransferChecked` instructions from those exact reviewed bindings and amounts; it does not use BOID's journal to construct transfers. It compares decoded account balances and the transfer plan with the independently executed BOID transition.

This remains trusted client settlement. The named service supplies first-purchase state and referral attestation; the Token program does not enforce those policies or receipt IDs. Account declarations do not prove identity, common-control separation or signing-key possession. Human review and application integration remain required; see [B14's trust assumptions](B14_SPL_PAYOUT.md).

## Validation evidence

The emitted baseline and repair tests each exercise nine cases: tiny amounts, threshold −1/at/+1, nested rounding, a normal purchase, repeat-purchase exclusion and absent-affiliate exclusion. The repository suite additionally verifies deterministic gold output, configuration diff, missing/invalid authority refusals, unsupported mechanism refusals, artifact tampering and no output on a rejected CLI run.

The [LiteSVM results](../fixtures/solana-payout/generated/litesvm-results.v1.json) and [Agave validator results](../fixtures/solana-payout/generated/validator-results.v1.json) record each case's decoded balances and settlement fees. Per-arm `economicHash` values can be compared across runtimes. The bundles also record generated-artifact hashes, runtime versions, generator/runner/runtime source hashes, package-lock hash and full evidence hashes. Local-validator execution used Agave 3.1.10; the default runner uses LiteSVM 1.6.0.
