# Boid

Boid is an economic engineering layer for software. It turns repository evidence and developer objectives into a versioned economic model, tests mechanisms for profitable or pathological strategies, and explains findings with their assumptions.

This repository contains a [hackathon plan](docs/PLAN.md), [domain language](CONTEXT.md), a [proposed issue backlog](docs/BACKLOG.md), the [creator marketplace fixture](fixtures/creator-marketplace/README.md), a [bounded repository snapshot command](docs/REPOSITORY_SNAPSHOT.md), [reviewed marketplace rule extraction](docs/EXTRACTION.md), a [seeded population scenario](docs/SCENARIO.md), a [sensitivity sweep](docs/SENSITIVITY.md), and a [versioned economic model with atomic purchase transitions, replayable coalition scoring, and bounded strategy search](docs/ECONOMIC_MODEL.md).

The first end-to-end milestone is **Repo → Economic Model → Boid → Finding**. An earlier engine gate proves strategy search against a checked-in model. Implementation should begin only after reviewing the plan and issue backlog.

With Node 24 or newer and dependencies installed (`npm ci`), print the fixture finding:

```sh
npm run --silent search -- fixtures/creator-marketplace/economic-model.v1.json fixtures/creator-marketplace/search-input.v1.json
```

The cited finding shows the 5 USDC purchase, 0.34 USDC conditional profit, journal and cost arithmetic, search budget, and reproducibility hashes. Add `--json` for the structured finding or `--raw` for the complete ranked search result and replayable traces. The [fee funded repair comparison](docs/B09_COMPARISON.md) runs the baseline and proposed mechanism under identical search inputs.
