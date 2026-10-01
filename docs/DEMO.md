# Local inspectable demo

Run `npm run demo` from the repository root, then open `demo-output/index.html` in a browser. The command writes a standalone `index.html` and five JSON artifacts to the ignored `demo-output/` directory: `finding`, `comparison`, `sensitivity`, `recommendation`, and the linked `data` bundle. To choose another output directory, run `npm run demo -- /path/to/output`.

The page presents one sequence:

1. **Source rule:** the 5 USDC eligibility threshold and 1 USDC campaign award, with pinned repository spans.
2. **Action trace:** step through the purchase, each journal transfer, external costs, and the +0.34 USDC coalition return. The treasury-to-affiliate transfer is visible as its own step.
3. **Repair trade-off:** the same trace changes to −0.46 USDC under the tested fee-funded rule; the honest 20 USDC reference award changes from 1.00 to 0.80 USDC.
4. **Assumptions:** select identity cost, honest order distribution, attacker share, attacker order amount, and paired seed. Each choice looks up a saved sensitivity run and shows its profit, revenue, treasury spending, affiliate payout, failed actions, and run hash.

The browser script only navigates the trace, formats values, and selects precomputed cells. Economic transitions and scores run in Node through the shared engine while building the artifacts. The bundle links the finding, comparison, sensitivity, and recommendation hashes; generation fails if their run links disagree. The page is a conditional fixture demonstration, not a forecast or proof of actual identity control. The 40% fee-funded rate is one tested candidate, not an optimality claim.

The end-to-end test generates the page in a temporary directory, loads it into a DOM, clicks through to the treasury transfer, changes the cost control, and checks displayed values against the saved JSON. `npm test` runs it with the rest of the repository checks.
