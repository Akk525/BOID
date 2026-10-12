# Independent marketplace extraction check

Run `npm run extraction-check -- --json` offline to reproduce `assessment.v1.json`.
The manifest pins Sharetribe web-template commit 1811b6a188a71e9ee6a41effed3139606cdd9f94 and hashes every copied file. Apache-2.0 attribution is retained in upstream/LICENSE. This bounded slice is not the complete repository. Upstream tests are evidence only and are never executed or imported.

The unchanged B08 extractor captures 0 of 7 source-backed facts; all eight extraction fields remain unresolved. Two facts expose unsupported syntax; five expose gaps in the current economic model. Referral rules are unestablished in this slice and excluded from the score. Provider is not equated with creator, and minimum commission is not equated with referral eligibility.

Gold facts are agent-reviewed transcriptions with independently authored upstream assertions. Human signoff remains pending; issue #16's literal human-gold acceptance requirement is not yet satisfied. See [the source review](../../docs/research/second-marketplace-extraction.md) for citations and oracle provenance.

The demo now states assisted modeling and links its reproducible extraction assessment. Do not claim general marketplace extraction accuracy or generate a payout from this unresolved draft.
