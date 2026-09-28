# B05 mechanism-mutation gate

The same `purchase-search.v1` engine discovers materially different optima from two economic models. No search code, action template, identity, initial balance, cost, or amount candidate changes between runs. The mutation is a hypothetical user-supplied mechanism override, explicitly distinguished from the baseline repository evidence.

| Mechanism | Best strategy in the declared grammar | Coalition ledger gain | External costs | Profit | Treasury drain |
| --- | --- | --- | --- | --- | --- |
| Baseline: fixed 1 USDC affiliate reward on the buyer's first eligible purchase | One 5 USDC purchase | 0.50 USDC | 0.16 USDC | **0.34 USDC** | 1 USDC |
| Mutation: affiliate receives 20% of every eligible purchase | Two 20 USDC purchases by the same buyer | 4 USDC | 0.17 USDC | **3.83 USDC** | 8 USDC |

The coalition controls buyer, creator and affiliate. The creator and affiliate are existing identities; acquiring the buyer costs 0.15 USDC once. Each purchase attempt costs 0.01 USDC. At 20 USDC, the mutated mechanism pays 18 to the creator, 2 to the platform and 4 from treasury to the affiliate. Two purchases spend 40 and return 44 to controlled accounts, producing `44 − 40 − 0.15 − 0.02 = 3.83`. The treasury starts at 10 USDC and ends at 2 USDC. Initial balances and external costs are assumptions, not extracted facts.

Both runs allow three controlled accounts, depth two, 5,000 evaluated nodes, 40 USDC cumulative gross purchase volume, and the same five amounts: one micro-USDC, 4.999999, 5, 5.000001 and 20 USDC. The gate retains up to 1,000 findings to avoid losing outcomes to the reporting limit; only 4 baseline and 15 mutated representatives are positive. Both runs exhaust the configured grammar after 367 nodes (7 coalition roots and 360 attempted extensions). Dominance pruning skips 220 baseline and 188 mutated equivalent states. Neither run truncates or omits findings.

## Reproduce

```sh
node --test --test-name-pattern='mechanism mutation' src/economic-model/search.test.ts
npm run --silent search -- fixtures/creator-marketplace/economic-model.v1.json fixtures/creator-marketplace/search-input.v1.json > /tmp/boid-baseline.json
npm run --silent search -- fixtures/creator-marketplace/economic-model.recurring-reward.v1.json fixtures/creator-marketplace/search-input.v1.json > /tmp/boid-recurring.json
```

The CLI commands retain the fixture's top ten findings; the recurring report therefore counts five omitted positive representatives, while preserving the same winner and search coverage. The test raises the reporting limit identically for both models and compares all profitable outcomes.

| Input or witness | Canonical SHA-256 |
| --- | --- |
| Baseline model | `846ae0b554a5414fd56aab4c3b298a3a576aabb141c54284c2439f8aa1285876` |
| Recurring-reward model | `fe484ec6f73f41ea1f5b0c2cf9dcde97ba24242cebcdc1c1ed2b718d0293ed89` |
| Baseline winning trace | `7d98fd145e98edce5527e2572c0cbc8701cce7b0b8b0d9b2010623cb93b1c592` |
| Recurring-reward winning trace | `11d1a966850127d23516bf8e880f4f57a2a6fe3998eacd9fecba126e88ce2a8c` |

Each complete witness survives a JSON round trip and passes deterministic replay against its model. Cross-model replay fails. Model hashes differ; initial-state and winning-scenario hashes match. Repeated runs produce byte-equivalent reports.

## What the oracle and pruning establish

The test oracle independently enumerates every control subset and every sequence in an explicitly declared five-amount grammar. It does not use the production candidate generator or dominance table, and it expands every accepted permutation. It shares the transition/scorer so this comparison tests search correctness; separate integer arithmetic checks verify the two winning profit calculations.

The oracle agrees on both winning action sequences and profits. With all positive representatives retained, it also agrees on **every profitable coalition/final-state pair and that pair's minimum cumulative purchase volume**. This exercises pruning while checking much more than the winner.

Pruning is sound for economic reachability and the maximum profit objective in this grammar because:

1. The dominance table is separate for each fixed coalition and cost scenario.
2. Identical state includes all balances, purchase counters and tick. Future eligibility and funding depend only on that state and the fixed model.
3. Every accepted purchase increments tick once. Two prefixes with equal state therefore have equal depth, remaining depth, and transaction costs. Identity costs are fixed up front.
4. Equal final balances imply equal coalition ledger gain and treasury drain.
5. Keeping the lower cumulative purchase volume leaves at least as much remaining spending budget. Every continuation feasible from a discarded prefix is feasible from the retained prefix with the same resulting economic state and objective.

This establishes objective completeness over the configured finite grammar, assuming SHA-256 state hashes do not collide. It does not preserve every syntactically different witness, nor does it guarantee the globally smallest hash among equivalent witnesses. Rankings are over retained representatives. It makes no claim about unsampled amounts, undeclared identities, greater depth, other mechanism operators, or real-world identity costs.

The bounded milestone is **Economic Model → Search → Previously unspecified profitable strategy**. Repository extraction and B06's cited, readable finding remain subsequent work.
