# Seeded population scenario v1

`runPopulationScenario(initialState, model, scenario)` measures conditional marketplace activity over a fixed number of discrete ticks. It selects actions with a seeded policy and sends every purchase through the same `step` transition used by strategy search. It never implements a second payout calculation.

Run the checked-in mixed population from the repository root:

```sh
npm run --silent scenario -- fixtures/creator-marketplace/economic-model.population.v1.json fixtures/creator-marketplace/population-input.v1.json --summary
npm run --silent scenario -- fixtures/creator-marketplace/economic-model.population.v1.json fixtures/creator-marketplace/population-input.v1.json > /tmp/boid-population-run.json
```

The input declares the initial ledger, seed, horizon, per-tick arrival probability in basis points, attacker share of arrivals, fixed honest and attacker identities, uniform honest order-size choices, the attack order size, maximum attack attempts, explicit identity and transaction costs, and narrative assumptions. The fixture uses 12 ticks, seed 42, one arrival per tick, a 50% attacker arrival choice, 5 or 20 USDC honest orders, and two pre-funded fresh attacker buyers. This is a deliberately small scenario, not a demand estimate.

Each tick consumes four pseudorandom draws for arrival, policy, honest buyer, and honest order size, even when the tick is idle. The honest policy samples its declared buyer and order amount. The attacker policy uses the first available fresh buyer for a 5 USDC order while its attempt budget remains. A rejected attempt still uses the transaction cost, and a buyer's identity cost is charged once when first attempted. The policy does not create identities, refill balances, or change the mechanism. `state.tick` counts accepted purchases; scenario event ticks count every horizon step.

The result includes every attempted action, rejection diagnostics, the transfer journal, state hashes, metrics, and model/scenario/journal/run hashes. Platform revenue, creator earnings, affiliate payout, treasury spending, and attacker extraction are reconstructed from accepted journal entries. The runner reconciles every account's final balance against the journal before returning. Attacker profit is controlled-account ledger change minus activated identity and attempted transaction costs. Honest and attacker accounts must be disjoint so honest sales cannot be counted as attacker profit. A null attacker population with zero attacker arrival share yields zero attacker extraction and profit.

Identical model, initial state, scenario, and seed yield byte-equivalent JSON. Different seeds can produce different outcomes. Treasury rejection is atomic and contributes no journal transfers. The result is conditional on the declared population and distributions; a single seeded run is not a forecast.
