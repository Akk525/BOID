# Boid hackathon plan

Status: proposal for review, 2026-09-27. This plan narrows the product thesis to an experiment. A successful demo is evidence that bounded strategy search can find a useful economic failure; it is not validation of general repository understanding or customer demand.

## 1. Repository assessment

At the start of this assessment, the workspace had no Git history, source code, manifest, application, tests, or configured GitHub remote. It contained only Matt Pocock skill installations and `skills-lock.json`. Consequently there are no reusable product modules, dependencies, or technical debt from an earlier Boid to preserve. Keep the skill configuration locally; it is excluded from the product repository because it is installed tooling. Nothing should be removed or rewritten. Start as a small TypeScript project rather than inventing migration work.

The supplied handoff is the product source of truth. Repository analysis of *other* applications is a future input to Boid; the current empty Boid repository cannot demonstrate extraction. The first target should therefore be a deliberately small, believable marketplace fixture with code for checkout, referral eligibility, and payouts, plus a known-good economic model used to score extraction.

Use the Matt Pocock **domain-modeling** skill for canonical terms in `CONTEXT.md`; **codebase-design** for small, testable module interfaces; **research** for first-party Solana facts; and **to-spec/to-tickets** for the written plan and dependency-aware, reviewable issue slices. The last two skills normally require a configured tracker and a ticket approval quiz. The user directly requested creation of a new tracker and issue backlog for review, so publishing the proposed tickets is already authorized. No implementation, TDD, review, or frontend design skill is needed yet.

## 2. Decision and MVP contract

**Core experiment:** Given a constrained economic model, can a bounded search find a profitable strategy that was not written as a named attack in the mechanism? The first proof must compare the search result with a handwritten exhaustive oracle on a small action/state space. If a few deterministic inequalities find everything useful, keep that simpler method and do not claim agent-based simulation added value.

**Supported input:** One public GitHub URL pinned to a commit, or a local directory, within size/file limits; TypeScript/JavaScript marketplace code only for automated extraction. The provided marketplace fixture must work end to end. The user reviews and edits the extracted model and explicitly supplies objectives and missing costs. Repository text is untrusted input and must never execute as part of analysis.

**Mechanism:** A single-purchase creator marketplace with percentage creator/platform split and a fixed first-purchase affiliate bonus paid by a campaign treasury above a minimum order amount. A configurable alternative pays the affiliate a percentage of collected platform fees. USDC is the accounting asset; fiat and points are described in the IR vocabulary but unsupported by this executable MVP.

**Actors:** buyer, creator, affiliate, platform/treasury. One boid may control a coalition of buyer, creator, and affiliate identities. Honest buyer behavior is a simple exogenous scenario distribution, never a forecast.

**Analyses:** ledger conservation, eligibility and threshold checks, per-transaction coalition profit, treasury cost, bounded parameter search for profitable sequences, and explicit counterexample traces. Compare baseline and modified mechanism under identical inputs.

**Simulation:** bounded discrete steps with seeded order arrivals, honest and opportunistic populations, strategy policies chosen from a small action grammar, capped population/horizon, and aggregate metrics. Sensitivity varies order size, identity cost, and attacker fraction over declared ranges. Deterministic search is the primary finding; stochastic simulation measures conditional impact.

**Attack discovery:** combinations of order amount, first-purchase identity, and role coalition; repeated first-purchase farming while treasury and identity budget permit. Do not hard-code a `selfReferralAttack()` that simply prints the answer. The search may enumerate a constrained grammar, but the resulting profitable trace must be computed by the same transition function as ordinary purchases.

**Solana output:** after the nucleus works, a deterministic, reviewable payout artifact for one SPL-token split family, with a local six-decimal test mint and localnet parity tests. Start with client-constructed transfers if the application already trusts a payment authority; use a constrained Anchor template only if atomic onchain enforcement is essential. The artifact must name who attests first-purchase/referral eligibility. Wallet addresses alone cannot prove distinct people. No autonomous deployment or production key custody.

**User-visible output:** model with source citations and unresolved fields; a strategy trace; profit arithmetic; conditional scenario metrics and sensitivity; recommendation with before/after comparison, provenance, and uncertainty labels; optional Solana patch proposal.

**Out of scope:** arbitrary repositories/languages; general economic DSL; tokens or token price prediction; governance; onchain monitoring; autonomous wallet agents; unconstrained LLM action loops; MEV; realistic identity verification; hosted multi-tenant ingestion; broad mechanism templates; deployment, key custody, audits, and investment/legal advice. A no-token or offchain recommendation remains a valid output.

## 3. Minimum architecture

A single TypeScript package with a CLI and JSON artifacts is enough for the first milestone. Add a small local web view only after the trace is compelling. No microservices or database server. Store model, scenario, results, and source snapshot metadata as schema-versioned JSON files with content hashes. The repository commit SHA, model hash, scenario hash, engine version, and seed identify a run.

| Module | Why it exists | Interface and input → output | Deterministic / LLM |
| --- | --- | --- | --- |
| Repository intake | Bound and pin untrusted source | `snapshot(input, limits) → {commit, files, hashes}` | Deterministic; no LLM |
| Evidence extraction | Turn relevant code into reviewable claims | `extract(snapshot) → evidence-backed model draft + unresolved fields` | LLM may nominate facts and source spans; validation is deterministic |
| Model compiler | Keep one executable meaning | `compile(model) → validated transition function or diagnostics` | Deterministic |
| Ledger/transition | Execute permitted actions and transfers | `step(state, action, context) → nextState + journal + errors` | Deterministic, exact integer units |
| Strategy search | Discover profitable action traces | `search(compiled, grammar, budget) → ranked traces + coverage` | Deterministic enumeration/beam search, no LLM arithmetic |
| Scenario runner | Quantify conditional behavior | `run(model, scenario, policies) → metrics + traces` | Seeded pseudorandom process |
| Interpretation | Explain what happened and suggest changes | `explain(finding, evidence, comparison) → claims + citations` | LLM may draft prose; numeric claims validated against run artifacts |
| Solana artifact adapter | Express selected payout rule in implementation | `generatePayout(approvedModel, target) → diff/config + tests + authority assumptions` | Deterministic template and arithmetic; LLM may explain integration, but cannot invent settlement rules |
| Presentation | Let developer inspect causality | `render(runBundle) → model, trace, assumptions, comparison` | No numeric computation |

The model compiler and transition function should be deep modules: their small interfaces hide validation, eligibility, accounting, and event handling. The scenario runner must call the same `step` interface as search; two separately implemented economies would invalidate the comparison. An LLM must not decide action legality, balances, transfer amounts, or numerical results.

## 4. Constrained economic IR

The IR is a discriminated, schema-versioned JSON object validated at runtime. It is a constrained state-transition language for purchases, not a general-purpose programmable DSL. Money is integer minor units of USDC (six decimals) or exact rational rates; never binary floats for ledger balances. Every numeric parameter has an evidence reference. Source spans are optional for user-supplied assumptions but required for extracted repository claims.

```ts
type EvidenceKind =
  | "known" | "observed" | "user_supplied" | "estimated"
  | "inferred" | "unknown_knowable" | "fundamentally_uncertain";
type Evidence<T> = {
  id: string; kind: EvidenceKind; value?: T;
  source: { type: "repo" | "chain" | "user" | "external" | "calculation";
            uri?: string; commit?: string; path?: string;
            startLine?: number; endLine?: number; observedAt?: string };
  method?: string; range?: { min: T; max: T };
  notes?: string;
};
type Asset = { id: "USDC"; decimals: 6 };
type Role = "buyer" | "creator" | "affiliate" | "platform";
type Account = { id: string; roles: Role[]; controlledBy?: string };
type State = {
  balances: Record<string, bigint>; // account:asset → minor units
  completedPurchases: Record<string, number>; // buyer identity → count
  campaignSpent: bigint;
  tick: number;
};
type Predicate =
  | { op: "gte"; left: "purchase.amount"; right: { parameter: string } }
  | { op: "eq"; left: "buyer.completedPurchases"; right: 0 }
  | { op: "and"; all: Predicate[] };
type Amount =
  | { op: "fixed"; parameter: string }
  | { op: "share"; basis: "purchase.amount" | "platformFee"; rate: string };
type TransferRule = {
  from: "buyer" | "platform" | "campaignTreasury";
  to: "creator" | "platform" | "affiliate";
  amount: Amount; when?: Predicate; evidence: string[];
};
type Purchase = { type: "purchase"; buyer: string; creator: string;
  affiliate?: string; amount: bigint };
type Model = { schemaVersion: 1; sourceCommit: string; actors: Account[];
  assets: Asset[]; parameters: Record<string, Evidence<string>>;
  actions: { purchase: { minAmount: string; transfers: TransferRule[] } };
  constraints: { noNegativeBalances: true; requireDistinctRoles?: boolean };
  objectives: { id: string; metric: string; direction: "min" | "max";
                threshold?: string; evidence: string }[];
};
```

Illustrative model, with `$10` shown for readability and stored as integer micro-USDC:

```json
{
  "schemaVersion": 1,
  "parameters": {
    "platformFeeRate": {"kind":"known","value":"0.10","source":{"type":"repo","commit":"abc123","path":"src/checkout.ts","startLine":40}},
    "affiliateBonus": {"kind":"known","value":"1.000000","source":{"type":"repo","commit":"abc123","path":"src/referrals.ts","startLine":18}},
    "minimumEligiblePurchase": {"kind":"known","value":"5.000000","source":{"type":"repo","commit":"abc123","path":"src/referrals.ts","startLine":22}},
    "identityCost": {"kind":"user_supplied","value":"0.150000","range":{"min":"0.050000","max":"0.500000"},"source":{"type":"user"}}
  },
  "actions": {
    "purchase": {
      "minAmount":"5.000000",
      "transfers":[
        {"from":"buyer","to":"creator","amount":{"op":"share","basis":"purchase.amount","rate":"0.90"},"evidence":["platformFeeRate"]},
        {"from":"buyer","to":"platform","amount":{"op":"share","basis":"purchase.amount","rate":"0.10"},"evidence":["platformFeeRate"]},
        {"from":"campaignTreasury","to":"affiliate","amount":{"op":"fixed","parameter":"affiliateBonus"},"when":{"op":"and","all":[{"op":"gte","left":"purchase.amount","right":{"parameter":"minimumEligiblePurchase"}},{"op":"eq","left":"buyer.completedPurchases","right":0}]},"evidence":["affiliateBonus","minimumEligiblePurchase"]}
      ]
    }
  }
}
```

The published JSON fixture will contain the full required fields omitted from this shortened example. A purchase first checks preconditions, evaluates eligibility against pre-action state, computes rounded transfer amounts with a declared remainder rule, applies all transfers atomically, then increments the buyer's completed-purchase count. A trace records the evaluated predicates and each journal entry. An invalid or incomplete extracted model cannot run silently.

Costs such as identity creation are **scenario costs**, not ledger transfers unless they are actual product payments. The boid objective counts controlled accounts' net balance changes minus scenario costs. This separation prevents a hypothetical Sybil cost from contaminating conservation accounting.

The IR deliberately excludes arbitrary expressions and loops. Adding a new mechanism should require a new typed operator plus tests and a migration, not an LLM-generated JavaScript expression. Model versions must remain tied to source commits; changes invalidate prior results until recompiled and rerun.

## 5. Search, simulation, and claims

**Deterministic analysis:** verify invariants; calculate honest purchase payouts; enumerate purchase amount boundaries (minimum, adjacent units, chosen samples), coalition role assignments, identity reuse/new identity, and short action sequences. Rank by coalition net gain and treasury drain. A trace is valid only if replay through `step` produces exactly the reported balances. State hashing and dominance pruning bound repeated states; time, depth, account count, amount range, and node count are explicit budgets. Report explored states and coverage limitations.

**Stochastic scenario:** discrete purchase ticks. Honest buyers sample from a declared order-size distribution; adversarial boids select from candidate strategies or a bounded policy. A seeded PRNG controls arrivals and draws. Scenarios declare population, fraction adversarial, treasury, initial balances, identity cost distribution, horizon, and seed. Metrics include platform revenue, creator earnings, affiliate payout, treasury runway, attacker profit/extraction, payout concentration, and failed/blocked actions. Run a small grid or one-at-a-time sensitivity over order size, identity cost, and attacker share; label all outputs conditional.

**LLM hypotheses:** an optional model may suggest action grammar expansions or code-relevant constraints with evidence. Every hypothesis is translated into typed operators and validated; the LLM never produces an accepted profit number. The first milestone should work with no LLM by loading a fixture model. This isolates the hard hypothesis from extraction quality.

Reproducibility requires same result for identical model hash, scenario hash, engine version, seed, and search budget. A distributional result needs both the seed and a clearly named set of seeds; never imply that one run predicts the future.

## 6. Epistemic and provenance rules

| Category | Meaning | MVP treatment |
| --- | --- | --- |
| Known | Directly read from pinned source/config or exact ledger value | Cite commit, path, lines, extraction method |
| Observed | Measured behavior in a named period | Cite dataset/query, window, count |
| User supplied | Developer entered objective or assumption | Cite user input and timestamp |
| Estimated | Approximation from external evidence | Cite source and range |
| Inferred | Derived or interpreted from other evidence | Cite parent evidence IDs and method |
| Unknown but knowable | Could be measured later | No point value; block run or require explicit scenario assumption |
| Fundamentally uncertain | Future behavior/demand/price | Scenario variable or narrative uncertainty; never a fact |

Every executable parameter points to evidence; every recommendation points to a finding, comparison, and assumptions. Confidence is claim-specific: vulnerability existence can be high under a stated identity-cost bound while the exact optimal referral rate remains uncertain. A missing cost is surfaced as unresolved and can be swept across a range. Provenance cannot be supplied by an LLM without checking the cited source span.

## 7. One end-to-end demo

Target repository: a small existing creator marketplace with checkout, referral campaign, and USDC-oriented payout code. Its normal order is about 20 USDC. Checkout takes a 10% platform fee; creators receive 90%. To drive acquisition, campaign treasury pays a fixed 1 USDC affiliate bonus on a buyer's first order of at least 5 USDC. Typical 20 USDC purchases look safe against self-dealing: a coalition loses 2 USDC in fees to receive 1 USDC in bonus.

Boid extracts those rules and asks the developer for identity and transaction costs. Set identity cost to 0.15 USDC and transaction cost to 0.01 USDC, with ranges visible. Its search controls creator, affiliate, and a fresh buyer identity, creates a 5 USDC listing/order, and executes one first purchase. The coalition receives 4.50 creator revenue and 1.00 affiliate bonus after spending 5.00, then pays 0.15 + 0.01 in external costs: **0.34 USDC profit** per fresh buyer. The search found the minimum eligible order, not merely a generic self-referral flag. The trace shows a 1 USDC treasury loss and 0.50 USDC platform receipt per iteration; the campaign subsidizes a controlled coalition.

The proposed repair makes the affiliate award at most 40% of the platform fee collected on the qualifying order. On a 5 USDC order the award becomes 0.20 USDC; coalition net is **−0.46 USDC** after the same costs. Boid reruns the same search and scenario, reports any remaining profitable traces, and shows that honest affiliate rewards at 20 USDC become 0.80 USDC instead of 1.00. This is a real trade-off, not an assertion of a universally optimal 40%. The output offers a constrained Solana payout artifact with local tests and a manual review gate. Eligibility remains the responsibility of an explicitly named application authority.

The demonstration should include a control case with identity cost 0.50 USDC: the original 5 USDC loop is then unprofitable (−0.01 after transaction cost). This proves the finding is conditional and that Boid exposes the assumption instead of claiming an exploit exists in all worlds.

## 8. Risks and cheapest falsification tests

| Risk | Cheapest test and stop signal |
| --- | --- |
| Arbitrary repository extraction is unreliable | Compare extracted facts/spans from two small real marketplace repos with a human gold model. If key rules or provenance are repeatedly missed, constrain input to assisted model entry for the hackathon. |
| Hallucinated code understanding | Require every extracted claim to resolve to pinned lines and pass a reviewer checklist. One invented payout rule is a failure of autonomous extraction. |
| IR misses important semantics | Model the demo and one variant with refunds or caps on paper. If correctness needs arbitrary code execution, narrow the supported mechanism rather than widening the DSL. |
| Search space explodes | Enumerate the bounded fixture space with state hashing; record time/nodes/coverage. If a short search cannot find the threshold loop within a fixed budget, simplify action grammar and use exact arithmetic optimization. |
| Agent simulation adds no value | Compare search with a spreadsheet inequality and a brute-force oracle. If simulation only repeats the inequality, keep deterministic search and make stochastic simulation a P1 impact view. |
| LLM agents are irreproducible | Keep LLM outside execution. Replaying an action trace with a fixed seed must produce identical journal and metric hashes. |
| Simulation is mistaken for prediction | Show at least two identity-cost and attacker-share scenarios with clearly different outcomes. If copy cannot stay conditional, omit runway estimates. |
| Solana generation is unsafe or too large | Test one deterministic payout template and its authority assumptions against a local validator. If eligibility or custody cannot be expressed honestly, deliver a transaction plan and tests without claiming onchain enforcement. |
| Product demand is unproven | Put the trace and before/after in front of several developers with referral mechanisms. Ask whether they would have changed a design decision; do not infer demand from demo applause. |

## 9. Ordered phases and gates

1. **Define a trustworthy target.** Fixture repository, expected model, numeric oracle, and explicit input assumptions. Gate: a reviewer can verify the 5 USDC loop by hand.
2. **Prove the nucleus.** Typed model, compiler/transition, bounded strategy search, replayable finding. Gate: `Repo fixture → Economic Model → Boid → Finding` from one CLI command; finding matches exhaustive oracle and reports coverage. This is the first milestone.
3. **Earn repository input.** Safe snapshot, evidence-backed extraction, validation/review step. Gate: source lines for every extracted rule, and errors for missing economics. The nucleus still runs without an LLM.
4. **Quantify and repair.** Seeded scenario, sensitivity, alternative mechanism, before/after. Gate: identical seeds and initial conditions; arithmetic and metrics reconcile with journals.
5. **Demo implementation.** Minimal visual trace, reviewed Solana payout diff, local validator test. Gate: demo can show mechanism, profitable action sequence, repair, and tested patch without deploying funds.

Do not start phase 5 before phase 2 proves the core hypothesis. Stop or cut scope at each gate rather than building a dashboard around an invalid model.

## 10. Critical path

Backlog IDs B01 → B02 → B03 → B04 → B05 → B06 are the shortest path to the first milestone. B07 adds fixture-to-model extraction only after the executable nucleus is credible. B08–B15 improve the hackathon demonstration; B16–B19 are explicitly post-hackathon. See [BACKLOG.md](BACKLOG.md) for independently reviewable issue definitions.
