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

## Strategy traces and coalition scoring

`runStrategy(initialState, actions, model, scenario)` in [strategy.ts](../src/economic-model/strategy.ts) calls `step` for each action and returns a versioned `StrategyTrace`. It validates inputs without mutating them. The scenario explicitly names controlled identities; account roles or wallet addresses do not establish common control.

Each controlled identity has an acquisition cost, and the scenario has a transaction cost per attempted action. Each cost is an integer micro-USDC amount with either user-supplied evidence or an external estimate, plus explanatory notes. Existing identities can have a documented zero acquisition cost. Costs cannot silently default to zero.

- Acquisition costs are charged once per distinct controlled identity at the start of the strategy, even for an empty action sequence. Transaction costs are charged per attempt, including rejected purchases. Invalid input produces validation diagnostics before execution.
- The runner stops at the first rejected action. The trace retains all requested actions, the attempted steps, the accepted prefix's final ledger, and the rejection diagnostics. A positive score on a rejected trace is not a completed strategy.
- Each attempted step records its action, predicates, journal, attempt cost, and before/after state hashes. Hashes cover balances, purchase counts, and tick. A rejected step has identical before/after hashes and an empty journal.
- `score` reports the sum of controlled balances before and after execution, their signed net change, identity costs, transaction costs, and signed profit. **Profit = controlled balance change − external costs.** Costs never become transfers or modify the application ledger. Buyer-only financial scoring is not a model of buyer utility.
- The trace includes the model hash, scenario hash, initial/final states, and execution version. It can be persisted as JSON without losing precision.

`replayStrategy(trace, model)` re-executes the recorded inputs through the shared transition, checks the model and engine version, and compares the entire supplied trace with the reproduced result. Altered journals, evaluations, state hashes, cost totals, scores, or extra fields fail verification. It returns a verified trace or path-specific diagnostics.

Replay checks internal reproducibility. It does not prove real identity ownership, actual external costs, or correct repository extraction. A self-consistent trace under different assumptions represents a different scenario; hashes are not signatures.

## Verify

From the repository root, with Node 24 or newer:

```sh
npm ci
npm run typecheck
npm test
```
