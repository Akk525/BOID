# B09 fee funded affiliate repair

The [baseline model](../fixtures/creator-marketplace/economic-model.v1.json) pays a fixed 1 USDC first-purchase affiliate bonus from the campaign treasury. The separate [repair model](../fixtures/creator-marketplace/economic-model.fee-funded.v1.json) pays 40% of the platform fee actually collected on the qualifying order. Its rate is a user-supplied proposal; the repository source citations and other rules remain tied to the same fixture commit.

`share` amounts can now use either `purchase.amount` or an earlier transfer rule as their basis. The fee basis must reference an unconditional buyer-to-platform share. The transition computes that transfer first, rounds it down to micro-USDC, then applies the affiliate rate to the collected amount. The existing fixed amount and purchase-price share operators retain their behavior. A missing, later, or non-fee basis fails model validation.

Run the comparison from the repository root:

```sh
npm run --silent compare -- fixtures/creator-marketplace/economic-model.v1.json fixtures/creator-marketplace/economic-model.fee-funded.v1.json fixtures/creator-marketplace/search-input.v1.json fixtures/creator-marketplace/reference-purchase.v1.json
```

Add `--json` for a byte-stable structured artifact. It includes both model hashes, search hashes, run hashes, the identical search budget and initial-state hash, the baseline strategy replayed against the repair, both witness trace hashes, the reference purchase journals, coverage, and a comparison hash. The reference purchase assumes unrelated buyer, creator, and affiliate identities; account names alone do not prove this.

With the checked-in scenario, the baseline's 5 USDC coalition earns **+0.34 USDC**. Replaying that same action and costs against the repair yields **−0.46 USDC**: 0.50 USDC platform fee, 0.20 USDC affiliate award, and 0.16 USDC external costs. A first 20 USDC reference purchase pays the affiliate **1.00 USDC** before and **0.80 USDC** after. The repaired search retains no positive trace after exhausting the declared 5,000-node, depth-two, three-account, 40 USDC volume budget and sampled amount grammar. This is a bounded conditional finding, not a claim that every possible strategy is unprofitable.

Tests check threshold-adjacent amounts, exact fee-first rounding, unchanged buyer/creator split, first-purchase eligibility, invalid basis references, deterministic hashes, and a deliberately added treasury bonus that makes search find a positive strategy again.
