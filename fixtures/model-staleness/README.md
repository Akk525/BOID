# Model lifecycle commit-diff fixtures

These offline fixtures use synthetic successor commit IDs (all `1` and all `2`), not published upstream commits. The baseline pin is the reviewed creator-marketplace model. The relevant successor changes PLATFORM_FEE_BPS from 1000 to 2000. The documentation-only successor represents a README edit; README is excluded from the source snapshot, so selected content stays identical. Neither fixture executes repository code.

Reproduce the stale assessment:

```
npm run --silent stale-check -- fixtures/creator-marketplace/economic-model.v1.json fixtures/model-staleness/before.v1.json fixtures/model-staleness/relevant.v1.json fixtures/model-staleness/run-links.v1.json fixtures/creator-marketplace/
```

Replace relevant.v1.json with documentation-only.v1.json to reproduce the current assessment. Run links explicitly identify the saved model hash; labels in this fixture are demonstration identifiers, not new simulation runs.

The checker validates snapshot/content hashes and the model's baseline file hashes. It reports changed evidence spans and conservatively marks any changed or removed model source file stale, including changes outside cited lines. Every supplied dependent run receives the same status. It emits an assessment without overwriting models or results. Local snapshots require matching roots; GitHub snapshots require matching repository and baseline commit. An explicit path prefix maps snapshots taken inside a repository subdirectory.
