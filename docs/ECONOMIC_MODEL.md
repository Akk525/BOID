# Economic model v1

The [fixture model](../fixtures/creator-marketplace/economic-model.v1.json) is a manually authored, checked-in interpretation of the B01 marketplace. It is the gold model for later repository extraction; Boid does not yet infer it from code.

The public TypeScript interface is `parseEconomicModel(input: unknown): EconomicModel`. It returns a validated, typed model or throws `EconomicModelValidationError` with path-specific diagnostics. `parseEconomicState` validates balance and purchase-count snapshots, and `parsePurchaseAction` validates a purchase request. `serializeEconomicModel(model)` sorts object keys for repeatable JSON, and `hashEconomicModel(model)` hashes that canonical serialization with SHA-256. Arrays remain ordered because transfer rule order has meaning.

## Representation

- One asset: USDC with six decimals. Money is a nonnegative **integer number of micro-USDC encoded as a decimal string**, so JSON round trips do not lose precision. Rates are exact decimal strings between 0 and 1 or rational `{numerator, denominator}` pairs. The model never asks JavaScript floating point to hold a balance.
- Actors are account identities with one or more roles. Several identities may share a role, which is necessary for later buyer-identity scenarios. Who controls each identity belongs in a scenario, not in the application's economic rules.
- `state` declares USDC balances and buyer purchase counts; initial balances and external costs belong in a later scenario. `actions.purchase.transfers` holds ordered rules. Fixed awards reference a money parameter; shares reference a rate parameter. The purchase split requires one unconditional buyer-to-platform share followed by a buyer-to-creator remainder that subtracts that share. Eligibility uses only typed predicates for minimum amount, first purchase, affiliate presence, and distinct buyer/affiliate accounts.
- Every rule and numeric parameter points to evidence. Repository evidence is pinned to a commit, file, and line span. The source manifest records SHA-256 for each relevant B01 source file. The model rejects references outside the manifest and point-valued parameters based on unknown or fundamentally uncertain evidence.
- The supported vocabulary is deliberately narrow. Unknown operators, arbitrary code, unsupported schema versions, malformed rates, duplicate identifiers, and missing references fail validation.

The model is an input contract. A validated model alone does not establish that a repository rule was extracted correctly; the source citations and fixture gold model provide a review target.

## Purchase transitions

`step(state, purchase, model)` in [step.ts](../src/economic-model/step.ts) validates the three inputs, checks account roles and funds, and applies the model's rules to a private tentative ledger. It never mutates its inputs.

- Success returns `{ok: true, state, journal, evaluations}`. Each journal entry identifies the rule, asset, resolved source and destination account, integer micro-USDC amount, and evidence IDs. The new state increments the buyer's purchase count and tick once. Here a tick counts accepted purchases; it is not elapsed real-world time.
- Failure returns `{ok: false, diagnostics, journal: [], evaluations}`. It returns no tentative state. Counters and balances remain unchanged, including when a later rule runs out of treasury funds.
- Buyer, creator, and optional affiliate IDs must have the corresponding model roles and balances. Platform and campaign treasury roles must each resolve to one account. A buyer cannot purchase from the same creator identity.
- All predicates read pre-action state. Every child of an `and` predicate is evaluated for an inspectable trace. An absent affiliate or same buyer/affiliate account does not qualify for the fixture's bonus.
- Share arithmetic uses `bigint` ratios and rounds down to whole micro-USDC. The creator remainder receives every remaining micro-unit of the purchase. No floating point arithmetic enters the ledger.
- Transfers follow model order. Earlier credits may fund a later transfer, but no source may become negative during execution. The whole purchase commits together. Eligible zero-valued transfers remain in the journal; ineligible rules appear only in evaluations.

This is the shared execution path for future honest policies, search, and scenarios. Strategy selection and external identity/transaction costs are not part of `step`.

## Verify

From the repository root, with Node 24 or newer:

```sh
npm ci
npm run typecheck
npm test
```
