# Marketplace rule extraction v1

`extractMarketplace(snapshot)` recognizes one narrow checkout/referral implementation shape. It reads source text from the B07 snapshot and produces a deterministic draft. It does not execute repository code or ask an LLM to invent rules. The draft includes values, exact line spans, file hashes, and a status for every required claim. `known` means one supported candidate was found; `unresolved` means a rule or supporting calculation was missing; `conflict` means more than one candidate was found. Only an entirely known draft can be approved.

## Review and run the fixture

```sh
npm run --silent extract -- fixtures/creator-marketplace > /tmp/boid-draft.json
npm run --silent extract -- fixtures/creator-marketplace --review fixtures/creator-marketplace/extraction-review.v1.json > /tmp/boid-model.json
npm run --silent search -- /tmp/boid-model.json fixtures/creator-marketplace/search-input.v1.json
```

The first command is the review step. Inspect each candidate and its source span. The review JSON explicitly records the accepted value and exact path, line range, and file hash for all eight claims. It also supplies actor identities, an objective, objective notes, a repository name, and a source pin. Edit that file if the code or product objective changes; approval rejects a value or citation that no longer matches the extracted source. A missing rule cannot acquire a silent default. Fix or narrow the source and take a new snapshot before approving a conflicting or unresolved draft.

The checked-in fixture review reproduces the [gold economic model](../fixtures/creator-marketplace/economic-model.v1.json) exactly. The approved model goes through the existing B06 search command with the same scenario; its top trace still earns 0.34 USDC under the declared external costs.

For GitHub input, the review repository and full commit SHA must match the pinned snapshot URL. For a local directory inside a Git worktree, a 40-character source commit is verified by comparing every cited file with that commit's Git blob. A local directory outside Git can use its 64-character snapshot hash as a content pin. Local content can change between the draft and review commands; approval checks every citation against the new snapshot.

## Supported pattern

This extractor recognizes the fixture's `src/config.mjs`, `src/referrals.mjs`, and `src/checkout.mjs` structure: a basis-point fee and denominator, fixed affiliate bonus, minimum eligible price, first-purchase and distinct-affiliate guards, buyer/creator distinction, remainder payout, and buyer/platform/creator/treasury/affiliate ledger roles. It checks the named calculations and transfer statements together before reporting a numeric fact. Comment and string text cannot become a candidate. Different file layouts, renamed identifiers, refunds, caps, or other payout formulas remain unresolved until a typed extractor is added and tested. This narrow pattern is evidence extraction for the fixture, not general JavaScript interpretation.

Each approved source claim resolves to the exact snapshot lines and is checked against its file hash. The model's source manifest and evidence cite those reviewed files. Objective evidence is marked `user_supplied`; the extractor does not infer product goals or external identity and transaction costs from code. The latter remain scenario inputs for B06.
