# Proposed GitHub issue backlog

These are reviewable proposals, not an implementation commitment. IDs are stable references for dependency edges; GitHub issue numbers will be recorded when published. Milestones: **M1 Finding** proves the technical nucleus; **M2 Evidence** connects a real repository; **M3 Demo** makes the hackathon narrative work; **Later** is post-hackathon. A ticket is complete only when its acceptance criteria hold, not when files merely exist. The implementation may stop after any milestone gate.

## P0 — proves Boid

### B01 — Create the marketplace fixture and hand-checked oracle

**Purpose:** Establish a believable repository and an independent answer for the first discovery experiment.
**Scope:** Small TS/JS creator marketplace with checkout, first-purchase affiliate bonus, campaign treasury, 10% fee, 5 USDC eligibility minimum, and 20 USDC normal order. Include a human-readable payout table and coalition-profit oracle for 5 and 20 USDC orders.
**Implementation notes:** Keep fixture business code distinct from Boid internals. Model a buyer, creator, and affiliate controlled by one coalition without naming an attack in application rules.
**Dependencies:** None.
**Acceptance criteria:** A reviewer can locate each rule in source; at 5 USDC with 0.15 identity and 0.01 transaction cost the oracle yields +0.34; at 20 USDC it yields −1.16; campaign and platform flows reconcile.
**Tests required:** Fixture checkout unit tests and independent hand-calculation fixture assertions.
**Priority:** P0. **Milestone:** M1 Finding. **Labels:** `core`, `testing`, `hackathon-critical`.

### B02 — Validate and version the constrained purchase model

**Purpose:** Give all later calculations one inspectable input.
**Scope:** Runtime schema and TypeScript types for actor identities/roles, USDC balances, purchase action, fixed/percentage transfers, first-purchase and minimum-amount predicates, parameters, evidence references, constraints, and objectives.
**Implementation notes:** Accept integer micro-USDC and decimal strings/rational rates; reject arbitrary expressions, missing evidence, unsupported operators, duplicate IDs, negative rates, and unsupported schema versions. Publish fixture model tied to its source commit/hash.
**Dependencies:** B01.
**Acceptance criteria:** Valid fixture model loads; malformed models return useful diagnostics; serialized model and source hash are stable.
**Tests required:** Boundary/schema tests for valid and invalid cases; round-trip serialization.
**Priority:** P0. **Milestone:** M1 Finding. **Labels:** `economic-ir`, `core`, `hackathon-critical`.

### B03 — Execute purchases through one exact ledger transition

**Purpose:** Make a model executable rather than explanatory prose.
**Scope:** `step(state, purchase, model)` checks preconditions, evaluates rules against pre-action state, posts atomic transfer journal entries, updates first-purchase state, and returns diagnostics.
**Implementation notes:** Define rounding and remainder ownership; prohibit negative balances and partial commits. Use one transition path for honest activity and search.
**Dependencies:** B02.
**Acceptance criteria:** Fixture payouts match oracle at 5 and 20 USDC; second purchase receives no first-purchase bonus; insufficient funds leave state unchanged; every accepted action conserves ledger assets.
**Tests required:** Table tests for thresholds, first/second purchase, rounding, invalid roles, insufficient treasury/buyer funds, and conservation property.
**Priority:** P0. **Milestone:** M1 Finding. **Labels:** `economic-ir`, `simulation`, `hackathon-critical`.

### B04 — Score coalition profit from replayable action traces

**Purpose:** Express boid objectives without mixing hypothetical costs into token transfers.
**Scope:** A strategy trace records controlled identities, actions, predicate evaluations, journal, source state hashes, and external costs. Score net USDC change across coalition accounts minus scenario identity/transaction costs.
**Implementation notes:** Identity ownership is scenario data, not asserted by a wallet address. Keep full ledger and coalition score separate.
**Dependencies:** B03.
**Acceptance criteria:** Replay reproduces the same journal and score; fixture 5 USDC coalition gives +0.34; honest single-role buyer is not scored as a three-role coalition; changing identity cost changes profit without changing ledger entries.
**Tests required:** Replay and arithmetic tests, including cross-role ownership and cost sensitivity.
**Priority:** P0. **Milestone:** M1 Finding. **Labels:** `simulation`, `core`, `hackathon-critical`.

### B05 — Search bounded strategies for profitable purchase loops

**Purpose:** Test whether Boid discovers a strategy not hard-coded as an attack.
**Scope:** Enumerate role-control assignments, eligible purchase amounts near rule boundaries, fresh/reused buyer identities, and short sequences under explicit node/depth/account/budget limits. Rank positive coalition returns and report coverage.
**Implementation notes:** Search calls B03's transition and B04's scorer. Use state hashing and dominance pruning; persist the exact profitable trace. Do not implement a named self-referral detector as the result.
**Dependencies:** B04.
**Acceptance criteria:** Search finds the 5 USDC +0.34 strategy within a documented bound; exhaustive oracle on the tiny fixture agrees on best trace; rerun yields identical ranking and coverage; truncation is visible.
**Tests required:** Differential test against brute-force oracle; deterministic replay; budget/truncation tests.
**Priority:** P0. **Milestone:** M1 Finding. **Labels:** `simulation`, `core`, `hackathon-critical`.

### B06 — Print a cited, conditional finding from a single command

**Purpose:** Complete the first demoable vertical slice: repo fixture → model → boid → finding.
**Scope:** CLI command loads the fixture model and scenario, runs search, and prints source-backed rules, action trace, profit arithmetic, external assumptions, search budget, and model/run hashes.
**Implementation notes:** No LLM is needed. Keep output structured JSON plus readable text. A missing cost blocks a point-profit claim and prompts an explicit range.
**Dependencies:** B05.
**Acceptance criteria:** A fresh checkout can run the documented command and see the exact finding; every numeric claim maps to a journal or assumption; identical inputs produce byte-equivalent structured results.
**Tests required:** End-to-end CLI snapshot checked against semantic fields and reproducibility hashes.
**Priority:** P0. **Milestone:** M1 Finding. **Labels:** `core`, `testing`, `hackathon-critical`.

### B07 — Snapshot a bounded public/local repository with source locations

**Purpose:** Move beyond a hand-loaded model while keeping source evidence trustworthy.
**Scope:** Ingest a public GitHub URL pinned to commit or local path; enforce file/byte limits, select relevant TS/JS files, hash content, and expose stable line spans. Never execute repository code or follow secrets.
**Implementation notes:** Exclude generated/vendor files and credentials; document selection rules and unsupported repositories. The fixture should be ingestible by path.
**Dependencies:** B06.
**Acceptance criteria:** Same commit yields same snapshot hash; source span resolves exactly; oversize or unsupported input fails with actionable diagnostics.
**Tests required:** Snapshot fixture tests, limit tests, traversal/symlink tests, and commit pinning test.
**Priority:** P0. **Milestone:** M2 Evidence. **Labels:** `repo-analysis`, `core`, `hackathon-critical`.

### B08 — Extract and review evidence-backed marketplace rules

**Purpose:** Convert repository code into a draft model without trusting a hallucinated fact.
**Scope:** Narrow extraction of fee rate, affiliate bonus, eligibility threshold, first-purchase condition, and payout roles; show a review/edit step for unresolved fields and objectives.
**Implementation notes:** Begin with deterministic fixture extraction; optional LLM nominates facts/spans only. Validate every span and value against pinned source. Unknown but knowable fields cannot silently gain defaults.
**Dependencies:** B07.
**Acceptance criteria:** Fixture draft matches the gold model; each extracted rule cites an exact source span; missing or conflicting rule is surfaced for review; approved draft runs through B06 unchanged.
**Tests required:** Gold-model comparison on fixture and one altered variant; invented-span and conflicting-rule rejection.
**Priority:** P0. **Milestone:** M2 Evidence. **Labels:** `repo-analysis`, `ai`, `economic-ir`, `hackathon-critical`.

## P1 — makes the hackathon demo excellent

### B09 — Compare the fee-funded affiliate repair against baseline

**Purpose:** Show a concrete design improvement and its trade-off.
**Scope:** Add a supported affiliate amount operator bounded to 40% of collected platform fee; run identical search budgets for baseline and modified model.
**Implementation notes:** Generalize parameter and basis, not a one-off patch for the fixture. Preserve separate model versions and identical other assumptions.
**Dependencies:** B06.
**Acceptance criteria:** 5 USDC coalition profit changes from +0.34 to −0.46; 20 USDC honest affiliate award changes from 1.00 to 0.80; no profitable trace within stated search bounds; before/after links to both hashes.
**Tests required:** Transition parity and comparison tests at boundary amounts; verify search finds any deliberately reintroduced profitable variant.
**Priority:** P1. **Milestone:** M3 Demo. **Labels:** `economic-ir`, `simulation`, `hackathon-critical`.

### B10 — Run seeded scenario populations through the shared transition

**Purpose:** Estimate conditional impact when honest and adversarial behaviors mix.
**Scope:** Discrete ticks, fixed population and horizon, seeded arrivals/order sizes, honest buyer policy, and bounded attack policy; record revenue, creator payouts, affiliate awards, treasury, attacker profit, and failed actions.
**Implementation notes:** The scenario runner must call B03's `step`; no duplicated payout math. Declare population and distribution assumptions in the result.
**Dependencies:** B06.
**Acceptance criteria:** Same seed/model/scenario yields identical metrics and journal hash; totals reconcile with journal; zero attackers produces zero attacker extraction.
**Tests required:** Seed determinism, accounting reconciliation, zero-attacker and treasury exhaustion cases.
**Priority:** P1. **Milestone:** M3 Demo. **Labels:** `simulation`, `testing`.

### B11 — Show sensitivity and no-exploit countercase

**Purpose:** Prevent scenario numbers from masquerading as forecasts.
**Scope:** Sweep identity cost, purchase amount distribution, and attacker fraction over declared ranges; report break-even region and treasury metrics. Include 0.50 USDC identity-cost control.
**Implementation notes:** Pair runs by seed; do not infer exact future demand. Show which changes flip the profitable finding.
**Dependencies:** B09, B10.
**Acceptance criteria:** Baseline at 0.15 identity cost is profitable; at 0.50 the 5 USDC loop is −0.01 after transaction cost; charts/tables label inputs and confidence limits; same grid reproduces.
**Tests required:** Break-even arithmetic, paired-seed reproducibility, and monotonicity where mathematically expected.
**Priority:** P1. **Milestone:** M3 Demo. **Labels:** `simulation`, `testing`.

### B12 — Produce recommendation claims with evidence lineage

**Purpose:** Explain why a change is suggested without fake precision.
**Scope:** Recommendation artifact references source facts, user costs, search finding, scenario comparison, unknowns, and confidence for each claim. Optional LLM may draft wording from a locked result bundle.
**Implementation notes:** Validate numbers and citations against structured artifacts. Avoid presenting 40% as globally optimal.
**Dependencies:** B09, B11.
**Acceptance criteria:** Every numeric sentence resolves to a run/parameter; deleting an evidence item makes the dependent claim invalid; output distinguishes high confidence in conditional exploit from uncertainty about real identity costs.
**Tests required:** Claim validator tests for fabricated numbers, missing evidence, and conditional wording.
**Priority:** P1. **Milestone:** M3 Demo. **Labels:** `ai`, `core`.

### B13 — Build a minimal inspectable demo view

**Purpose:** Let a reviewer understand the finding in one screen sequence.
**Scope:** Show source-backed model, editable assumptions, animated or stepped action/journal trace, before/after, and sensitivity. Read run artifacts; no browser-side economic calculations.
**Implementation notes:** Prefer a small local app or static artifact to hosted infrastructure. The path to the 5 USDC threshold should be visually obvious.
**Dependencies:** B08, B11, B12.
**Acceptance criteria:** A reviewer can identify where 1 USDC leaves the treasury, why the coalition earns 0.34, and how the repair changes both exploit and honest reward; all displayed values match JSON artifacts.
**Tests required:** One end-to-end interaction test and artifact/display parity checks.
**Priority:** P1. **Milestone:** M3 Demo. **Labels:** `frontend`, `hackathon-critical`.

### B14 — Prototype one local SPL payout artifact with authority assumptions

**Purpose:** Check whether the chosen repair maps credibly to Solana.
**Scope:** Hand-author one fixed-rate SPL token split fixture, define allowed mint, authority, recipient accounts, rounding, eligibility attestation, and local six-decimal test mint.
**Implementation notes:** Use ordinary client transfers if trusted settlement is acceptable; use constrained Anchor logic only if atomic enforcement is required. Research note: [Solana MVP](research/solana-mvp.md). Do not claim wallet identity proves independent users.
**Dependencies:** B09.
**Acceptance criteria:** Authority and referral eligibility trust assumptions are written down; local transfer/settlement matches B03 for edge amounts; no production USDC or mainnet deployment.
**Tests required:** Local validator tests for split, rounding, wrong mint/authority, insufficient funds, duplicate settlement where applicable.
**Priority:** P1. **Milestone:** M3 Demo. **Labels:** `solana`, `research`.

### B15 — Generate the reviewed payout change from validated parameters

**Purpose:** Demonstrate implementation assistance without free-form security-critical code generation.
**Scope:** Map approved IR rates and recipients into B14's fixed template or transaction plan; emit diff/config, assumptions, and matching local tests.
**Implementation notes:** Generator must not invent authorities, PDA seeds, eligibility rules, or arithmetic. Unsupported models fail closed. Human reviews output.
**Dependencies:** B12, B14.
**Acceptance criteria:** Baseline and repaired model generate distinct, expected payouts; generated tests pass locally; unsupported eligibility or missing authority yields an explicit refusal to generate executable payout code.
**Tests required:** Golden artifact tests, model-to-localnet parity, rejection tests for unsupported rules.
**Priority:** P1. **Milestone:** M3 Demo. **Labels:** `solana`, `economic-ir`, `hackathon-critical`.

### B16 — Test extraction against a second real marketplace repository

**Purpose:** Check whether repo understanding generalizes beyond the fixture.
**Scope:** Select a small permissively licensed TS/JS repository with payment/referral logic; create human gold facts; run B08 extraction and record misses.
**Implementation notes:** If material rules are missed, narrow MVP claim to assisted modeling and display the limitation in demo.
**Dependencies:** B08.
**Acceptance criteria:** Gold facts and extraction diff are published; failures are categorized; scope decision is documented before demo claims generality.
**Tests required:** Repeatable extraction regression fixture with pinned commit.
**Priority:** P1. **Milestone:** M3 Demo. **Labels:** `repo-analysis`, `research`, `testing`.

## P2 — post-hackathon

### B17 — Detect stale economic models after repository changes

**Purpose:** Establish the first lifecycle loop.
**Scope:** Compare pinned snapshots; identify changed evidence spans and invalidate affected models/results.
**Implementation notes:** No continuous monitoring daemon initially.
**Dependencies:** B08.
**Acceptance criteria:** Relevant rule change marks dependent runs stale; unrelated doc change does not.
**Tests required:** Commit-diff fixtures for relevant and irrelevant changes.
**Priority:** P2. **Milestone:** Later. **Labels:** `repo-analysis`, `post-hackathon`.

### B18 — Ingest observed application/onchain metrics with provenance

**Purpose:** Replace scenario assumptions with measured behavior when available.
**Scope:** Define observed metric import with time window, source query, units, and sample size; compare observations to prior scenario ranges.
**Implementation notes:** Begin with offline import, not live indexers.
**Dependencies:** B10.
**Acceptance criteria:** Imported observations remain distinct from source-code facts and assumptions; out-of-range observation is highlighted.
**Tests required:** Unit/window validation and comparison tests.
**Priority:** P2. **Milestone:** Later. **Labels:** `core`, `post-hackathon`.

### B19 — Expand strategy grammar beyond purchase/referral

**Purpose:** Explore whether the search approach transfers to another mechanism.
**Scope:** One additional mechanism family chosen after user evidence, such as escrow or creator royalties; add typed actions and strategy grammar.
**Implementation notes:** Do not add generic arbitrary-code execution. Compare against a hand oracle and simple inequalities first.
**Dependencies:** B05.
**Acceptance criteria:** Finds a meaningful counterexample on a second mechanism under a bounded search and explains coverage.
**Tests required:** New mechanism oracle, replay, invariant, and regression tests.
**Priority:** P2. **Milestone:** Later. **Labels:** `simulation`, `economic-ir`, `post-hackathon`.

### B20 — Evaluate continuous economic checks in CI

**Purpose:** Learn whether model drift and strategy regressions can be reported on code changes.
**Scope:** Prototype a CI job that reruns approved scenarios on changed models and reports evidence-backed differences.
**Implementation notes:** Add only after extraction and observation provenance are credible; avoid automatic parameter changes.
**Dependencies:** B17, B18.
**Acceptance criteria:** A rule change produces a reproducible before/after finding with linked commits; a no-op change produces no alert.
**Tests required:** CI fixture covering relevant change, irrelevant change, and failed run.
**Priority:** P2. **Milestone:** Later. **Labels:** `core`, `post-hackathon`.

## Critical path

`B01 → B02 → B03 → B04 → B05 → B06` is the shortest proof. The first six issues should be implemented in order. B07–B08 turn that proof into actual repository ingestion. B09, B10, and B14 can then proceed independently; B11–B13 and B15 complete the demo. P2 issues should stay out of the hackathon build.
