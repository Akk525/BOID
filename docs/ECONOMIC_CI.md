# Conditional economic CI prototype

Issue #20 reruns the reviewed marketplace population scenario on a baseline and candidate commit. Run locally:

```
npm run economic-ci -- <40-character-base-sha> <40-character-head-sha> /private/tmp/economic-ci-output
```

Both models run through the same checked-out engine version. This prototype compares model/scenario behavior; it does not compare historical engine implementations. Tests handle engine regressions. The fixed inputs are `fixtures/creator-marketplace/economic-model.population.v1.json` and `population-input.v1.json`. Only committed JSON and declared source blobs are read using `git show`; repository source is not executed during simulation. Both commits must use the same approved scenario input. Changing that input requires a separate review; the checker reports failure instead of making a misleading comparison.

Declared source file hashes must match the reviewed model on each commit. A source edit with an unchanged model produces an explicit stale-model failure. This validates source pin integrity, not the truth of every modeled rule; manually approved model semantics and source spans remain necessary. Source-code extraction and observed metrics are not automatically used to recalibrate parameters.

Reports retain linked commit SHAs, package/input hashes, full before/after run artifacts, metrics, journals, coverage limitation and report hash. A changed metric or event trace produces an alert. A documentation-only or no-op change produces no alert. A model-only provenance change without scenario behavior differences produces no alert and remains visible in model hashes. Failed runs and invalid inputs produce failure evidence rather than a successful empty finding.

Exit status is 0 for unchanged, 1 for changed or failed. Alerts request review; they do not claim a safety violation. Coverage is one seeded marketplace population scenario, not exhaustive search or a program replay. [Regression fixtures](../fixtures/economic-ci/README.md) cover changed rules, documentation-only changes, source drift and failed runs.

The GitHub workflow runs on pull requests and manual dispatch with read-only repository permissions. It tests the implementation, publishes a job summary and uploads the evidence bundle even if the economic comparison fails. It never posts comments, changes model parameters, or merges changes. Official action documentation: [checkout](https://github.com/actions/checkout), [setup-node](https://github.com/actions/setup-node), [upload-artifact](https://github.com/actions/upload-artifact).
