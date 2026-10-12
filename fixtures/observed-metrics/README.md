# Synthetic observed metric example

```
npm run --silent observe -- fixtures/observed-metrics/observations.v1.json fixtures/observed-metrics/prior-ranges.v1.json
```

This reproduces assessment.v1.json. synthetic-counts.csv contains 65 arrival ticks out of 100 eligible ticks, producing 6500 basis points. The independently declared scenario range is 3000–6000, so the observation is highlighted as above-range. The source URI uses example.org and the query explicitly identifies synthetic input; these are not live measurements. The prior is a demonstration assumption associated with the bundled population scenario, not a range inferred from its outputs.

Observation and assumption remain separate in the report. The dataset SHA-256 pins the CSV; regression tests verify it. See [schema semantics and limits](../../docs/OBSERVED_METRICS.md).
