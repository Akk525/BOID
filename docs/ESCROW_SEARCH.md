# Second mechanism: pooled escrow

Issue #19 explores whether bounded typed search transfers beyond purchase/referral. Escrow is the default second-family choice after the mechanism-selection question remained unanswered. This is an exploratory synthetic example, not user/customer evidence, a deployed vulnerability, or a launch benchmark implementation. It does not modify the v1 marketplace schema. The launch benchmark freeze prerequisite still applies to launch work.

The family has fixed-price declared orders, distinct buyer/seller accounts, and a pooled escrow account. A buyer may deposit, confirm release to the seller, or cancel for a refund. Timing, disputes and seller authorization are deliberately absent and must not be inferred. The supplied coalition controls buyer and seller, never the escrow authority. Coalition orders start undeposited; preexisting collateral belongs to unrelated pending orders. This prevents counting release of previously owned claims as free profit.

The explicit policy is one settlement per order and full collateralization of pending deposits. The weak configuration rejects a second refund but allows refund after release. The repair requires the order to remain pending. Search enumerates deposit/release/refund for each controlled buyer's declared order, with fixed amounts, one supplied coalition, maximum depth and node budget. It retains prefixes with both positive after-cost profit and a separate policy violation. There is no dominance pruning or arbitrary-code execution. Rejection is atomic, charges the assumed per-attempt external cost, and terminates the strategy.

## Hand oracle and simple inequalities

An unrelated buyer already has 5 USDC reserved. The coalition starts with 5 USDC in its buyer account, zero in its seller account and no funded order.

| Action | Coalition buyer | Coalition seller | Pooled escrow |
| --- | --- | --- | --- |
| Deposit 5 USDC | 0 | 0 | 10 |
| Confirm release | 0 | 5 | 5 |
| Refund released order | 5 | 5 | 0 |

Total balances remain 10 USDC. Coalition ledger gain is 5 USDC; the unrelated pending order has a 5 USDC collateral shortfall. Explicit assumed costs are 0.05 USDC per controlled identity and 0.01 per attempted action: profit = 5 − 2 × 0.05 − 3 × 0.01 = **4.87 USDC**. More generally, this three-action witness is profitable exactly when order amount exceeds two identity costs plus three transaction costs and unrelated collateral can fund the second settlement.

The repaired control permits at most one payout of each deposited amount. For initially unfunded coalition orders, deposit followed by release to a controlled seller only returns coalition capital; refund also only returns capital. Nonnegative external costs cannot turn that into positive profit. Both guards prohibit double settlement, and withdrawals remove exactly the corresponding pending liability, preserving collateralization. This reasoning is limited to the defined fixed-order family; it is not a proof for real escrow systems.

## Reproduction and coverage

`npm run escrow-search` reproduces [the saved weak result](../fixtures/escrow/search-result.v1.json). Use `fixtures/escrow/repaired-input.v1.json` to reproduce the repaired control. [The hand oracle](../fixtures/escrow/hand-oracle.v1.json) is independently written arithmetic, not a human-certified or deployed-program oracle.

Tests compare all hand-ledger balances, supply conservation, atomic failures, costs on rejection, policy/profit separation, replay tampering, and the search against an independent finite-state enumeration. Both weak and repaired models use identical depth-3/node-1000 limits. Coverage reports exact grammar, visited/rejected nodes, omitted findings and truncation. A truncated empty result is not a clean result. Model replay validates full trace equality but is not program execution. The existing purchase/referral regressions remain unchanged.
