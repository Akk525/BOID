# Economic model v1

The [fixture model](../fixtures/creator-marketplace/economic-model.v1.json) is a manually authored, checked-in interpretation of the B01 marketplace. It is the gold model for later repository extraction; Boid does not yet infer it from code.

The public TypeScript interface is `parseEconomicModel(input: unknown): EconomicModel`. It returns a validated, typed model or throws `EconomicModelValidationError` with path-specific diagnostics. `parseEconomicState` validates balance and purchase-count snapshots, and `parsePurchaseAction` validates a purchase request. `serializeEconomicModel(model)` sorts object keys for repeatable JSON, and `hashEconomicModel(model)` hashes that canonical serialization with SHA-256. Arrays remain ordered because transfer rule order has meaning.

## Representation

- One asset: USDC with six decimals. Money is a nonnegative **integer number of micro-USDC encoded as a decimal string**, so JSON round trips do not lose precision. Rates are exact decimal strings between 0 and 1 or rational `{numerator, denominator}` pairs. The model never asks JavaScript floating point to hold a balance.
- Actors are account identities with one or more roles. Several identities may share a role, which is necessary for later buyer-identity scenarios. Who controls each identity belongs in a scenario, not in the application's economic rules.
- `state` declares USDC balances and buyer purchase counts; initial balances and external costs belong in a later scenario. `actions.purchase.transfers` holds ordered rules. Fixed awards reference a money parameter; shares reference a rate parameter; a remainder rule allocates purchase amount left after an earlier transfer. Eligibility uses only typed predicates for minimum amount, first purchase, affiliate presence, and distinct buyer/affiliate accounts.
- Every rule and numeric parameter points to evidence. Repository evidence is pinned to a commit, file, and line span. The source manifest records SHA-256 for each relevant B01 source file. The model rejects references outside the manifest and point-valued parameters based on unknown or fundamentally uncertain evidence.
- The supported vocabulary is deliberately narrow. Unknown operators, arbitrary code, unsupported schema versions, malformed rates, duplicate identifiers, and missing references fail validation.

The model is an input contract, not an executor. B03 will define atomic transfer execution, rounding, and state transitions against this same contract. A validated model alone does not establish that a repository rule was extracted correctly; the source citations and fixture gold model provide a review target.

## Verify

From the repository root, with Node 24 or newer:

```sh
npm ci
npm run typecheck
npm test
```
