# Recommendation claims with evidence lineage

`buildRecommendation(bundle)` produces a versioned, deterministic recommendation from the pinned marketplace model, a replayable search finding, the fee-funded repair comparison, and the paired sensitivity sweep. It does not ask an LLM to supply numbers or citations. Each claim carries a confidence category, typed numeric facts in integer micro-USDC, references to exact artifact paths and value hashes, and the unknowns that limit its use.

Run the checked-in example from the repository root:

```sh
npm run --silent recommend -- fixtures/creator-marketplace/economic-model.v1.json fixtures/creator-marketplace/economic-model.fee-funded.v1.json fixtures/creator-marketplace/search-input.v1.json fixtures/creator-marketplace/reference-purchase.v1.json fixtures/creator-marketplace/economic-model.population.v1.json fixtures/creator-marketplace/population-input.v1.json fixtures/creator-marketplace/sensitivity-grid.v1.json
npm run --silent recommend -- fixtures/creator-marketplace/economic-model.v1.json fixtures/creator-marketplace/economic-model.fee-funded.v1.json fixtures/creator-marketplace/search-input.v1.json fixtures/creator-marketplace/reference-purchase.v1.json fixtures/creator-marketplace/economic-model.population.v1.json fixtures/creator-marketplace/population-input.v1.json fixtures/creator-marketplace/sensitivity-grid.v1.json --json > /tmp/boid-recommendation.json
```

The same command accepts `--validate /tmp/boid-recommendation.json` to check a saved artifact. The validator reruns search, the repair comparison, and the sensitivity grid from the supplied models and inputs. It replays the finding trace and reference purchase, checks model and result hashes, and regenerates claim text and references. A changed number, missing model evidence item, detached claim reference, or stronger unconditional wording fails validation.

The fixture's pinned rule gives a 1 USDC treasury award on the first eligible affiliate purchase of at least 5 USDC. The bounded search finds a +0.34 USDC coalition return under a 0.15 USDC identity cost. The tested fee-funded repair changes that trace to −0.46 USDC and reduces the 20 USDC reference purchase's affiliate award from 1.00 to 0.80 USDC. An isolated first-purchase probe has a 0.49 USDC break-even identity cost; the 0.50 USDC control gives −0.01 USDC. These are conditional run results, not estimates of actual identity costs or demand.

`pinned_source` means the claim cites model evidence tied to a source commit. `replayed_conditional` means the arithmetic and action trace replay under declared inputs. `scenario_conditional` marks sensitivity calculations over declared seeds and assumptions. `unknown_real_world` marks the limits of cost, demand, and common-control evidence. The proposed fee share is one tested candidate, not a globally optimal rate. Hashes detect changes within the result bundle; they are not signatures or proof of real-world assumptions.
