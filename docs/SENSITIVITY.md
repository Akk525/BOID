# Sensitivity sweep v1

The sensitivity sweep varies declared costs and purchase behavior around a fixed economic model, population, initial ledger, and horizon. Each grid cell reruns the [seeded scenario](SCENARIO.md); it does not estimate future demand. The checked-in grid uses three paired seeds, 8 ticks, a 75% arrival probability, two identity costs (0.15 and 0.50 USDC), two uniform honest order-size distributions, three attacker shares, and two attacker order amounts.

From the repository root:

```sh
npm run --silent sensitivity -- fixtures/creator-marketplace/economic-model.population.v1.json fixtures/creator-marketplace/population-input.v1.json fixtures/creator-marketplace/sensitivity-grid.v1.json
npm run --silent sensitivity -- fixtures/creator-marketplace/economic-model.population.v1.json fixtures/creator-marketplace/population-input.v1.json fixtures/creator-marketplace/sensitivity-grid.v1.json --json > /tmp/boid-sensitivity.json
```

The table labels all varied inputs and shows the minimum and maximum attacker profit, platform revenue, and treasury spending across the selected seeds. Its `positive seeds` column counts runs with positive attacker profit; `region` is positive when every selected seed is positive, nonpositive when none is positive, and mixed otherwise. The structured JSON retains each seed's scenario, journal, and run hashes plus all scenario metrics, including failed actions, creator earnings, and affiliate payout. Grid size is capped at 256 runs. Runs pair the same seeds and pseudorandom draw schedule across variants, although the selected policies and resulting states may differ.

The first-purchase probe sends one fresh attacker purchase through the shared scenario runner with zero identity cost, retaining the declared transaction cost. The resulting net profit is the break-even identity cost for that isolated purchase. At 5 USDC, it is 0.49 USDC: the checked-in control yields +0.34 USDC with a 0.15 cost and −0.01 USDC with a 0.50 cost. At 10 USDC, the probe's signed threshold is −0.01 USDC, so no nonnegative identity cost makes that isolated purchase profitable. Realized multi-tick results can differ because buyer identities, balances, and the campaign treasury are finite.

Identity cost overrides are explicitly tagged as grid assumptions. The sweep keeps the model and initial ledger fixed; it only changes scenario inputs. The seed range describes variation across these three deterministic runs. It is not a statistical confidence interval, and the grid does not supply confidence limits for actual arrival rates, order sizes, or identity costs. Those inputs need observed data and provenance before Boid can make a broader claim.
