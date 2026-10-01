# Boid

Boid is an economic engineering layer for software. It turns repository evidence and developer objectives into a versioned economic model, tests mechanisms for profitable or pathological strategies, and explains findings with their assumptions.

This repository contains a [hackathon plan](docs/PLAN.md), [domain language](CONTEXT.md), a [proposed issue backlog](docs/BACKLOG.md), the [creator marketplace fixture](fixtures/creator-marketplace/README.md), and a [versioned economic model with atomic purchase transitions, replayable coalition scoring, and bounded strategy search](docs/ECONOMIC_MODEL.md).

The first end-to-end milestone is **Repo → Economic Model → Boid → Finding**. An earlier engine gate proves strategy search against a checked-in model. Implementation should begin only after reviewing the plan and issue backlog.

With Node 24 or newer and dependencies installed, persist the fixture search result:

```sh
npm run --silent search -- fixtures/creator-marketplace/economic-model.v1.json fixtures/creator-marketplace/search-input.v1.json > /tmp/boid-search.json
```

The JSON includes ranked positive strategies, their exact replayable traces, assumptions, hashes, and coverage. The best fixture strategy purchases at 5 USDC and earns 0.34 USDC under the declared costs. Repository extraction and the cited, readable finding command are subsequent milestones.
