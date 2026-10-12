# Offline observed metrics

Issue #18 adds `npm run observe -- <observations.json> <prior-ranges.json>` to import measurements and compare them with explicit scenario assumptions. The output retains both inputs, their canonical hashes, per-observation comparison status, and an assessment hash. It never changes economic models, source-code facts, or scenario inputs.

Each observation requires a metric, units, statistic, integer value, population description, UTC start/end window, positive sample size, collection timestamp, source kind (application/onchain), source URI, query, and SHA-256 of the source dataset. Windows are half-open [start, end); collection must occur at or after the end. Source queries should define inclusion filters, denominators, aggregation and rounding. Offline imports record provenance rather than verify the query, dataset or measurements.

Supported metrics:

| Metric | Units | Statistic | Sample definition |
| --- | --- | --- | --- |
| arrivalBps | basis-points | rate | Eligible ticks; numerator is ticks with arrivals |
| attackerArrivalBps | basis-points | rate | Arrivals; numerator is attacker arrivals |
| honestOrderAmountMicros | micro-USDC | mean | Honest orders |
| identityCostMicros | micro-USDC | mean | Identities with measured acquisition cost |

Basis-point rates are integers from 0 through 10000; monetary values are nonnegative integer strings, compared with BigInt. Exporters must state their integer rounding in the query. The API accepts aggregated values, not raw event streams or distribution estimates. In particular, an observed mean does not replace a scenario's order distribution. Attacker classification and identity cost require evidence outside this importer.

Prior ranges carry `kind: scenario-assumption`, a scenario hash, the same metric/units/statistic/population/window fields, and inclusive minimum/maximum. Observations carry `kind: observed`. Matching requires all comparison fields to agree; otherwise status is `not-comparable`. Multiple matching priors are rejected. `below-range` and `above-range` set `outOfRange: true`; exact boundaries are within range. Sample size is retained without implying statistical confidence or causal inference.

The example under [fixtures/observed-metrics](../fixtures/observed-metrics/README.md) is synthetic, not production telemetry. Live indexers, credentials, automatic calibration and model updates are outside this implementation.
