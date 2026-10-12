# Conditional CI fixtures

These are synthetic commit packages (repeated-digit commit IDs), not published commits. They retain models, scenario input and actual source hashes for offline reproduction with `checkEconomicCi`.

- Rule change: a user-supplied alternate award of 2 USDC changes the seeded result. Attacker profit changes from +680000 to -170000 micro-USDC; treasury exhaustion changes which purchases succeed. This is a conditional difference, not an adverse finding.
- Documentation-only: same approved input/model/source hashes, different commit; no alert.
- Failed run: scenario buyer missing from candidate actors; failure is explicit and never presented as a clean result.
- Source drift: changed source hash without updated reviewed model; blocked before candidate simulation.

The CLI regression creates actual temporary Git commits for a no-op documentation change, rule change and malformed input. Full saved reports include paired scenario runs and journal/state hashes. No inputs are rewritten by the checker.
