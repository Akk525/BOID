(() => {
  "use strict";

  const data = JSON.parse(document.getElementById("boid-data").textContent);
  const finding = data.finding;
  const best = finding.best;
  const comparison = data.comparison;
  const sensitivity = data.sensitivity;

  const byId = (id) => document.getElementById(id);
  const setText = (id, value) => { byId(id).textContent = String(value); };
  const money = (micros, signed = false) => {
    const raw = String(micros);
    const negative = raw.startsWith("-");
    const digits = (negative ? raw.slice(1) : raw).padStart(7, "0");
    const whole = digits.slice(0, -6).replace(/^0+(?=\d)/, "");
    const fraction = digits.slice(-6);
    return `${negative ? "−" : signed && raw !== "0" ? "+" : ""}${whole}.${fraction} USDC`;
  };
  const shortHash = (hash) => `${hash.slice(0, 12)}…`;
  const setHash = (id, hash) => { setText(id, shortHash(hash)); byId(id).title = hash; };
  const element = (tag, className, content) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (content !== undefined) node.textContent = String(content);
    return node;
  };

  const award = finding.parameters.find((item) => item.id === "affiliateBonus");
  const threshold = finding.parameters.find((item) => item.id === "minimumEligiblePurchase");
  if (!best || !award || !threshold || !comparison.witness) throw new Error("Demo artifacts lack required fixture fields");

  setText("hero-profit", money(best.profitMicros, true));
  setText("hero-treasury", money(best.treasuryDrainMicros));
  setText("hero-threshold", money(threshold.value));
  setText("source-threshold", money(threshold.value));
  setText("source-award", money(award.value));
  setHash("source-model-hash", finding.modelHash);

  const sourceList = byId("source-evidence");
  for (const item of [award, threshold]) {
    const row = element("div", "evidence-row");
    row.append(element("span", "evidence-name", item.id), element("strong", "evidence-value", money(item.value)));
    const source = item.evidence.detail.source;
    const citation = source.type === "repo"
      ? `${source.path}:${source.startLine}–${source.endLine} · ${source.commit.slice(0, 10)}`
      : source.type;
    row.append(element("code", "evidence-citation", citation));
    sourceList.append(row);
  }
  const affiliateRule = finding.rules.find((rule) => rule.id === "affiliateBonus");
  const firstEvidence = affiliateRule?.evidence.find((item) => item.id === "firstPurchaseSource");
  if (firstEvidence?.detail.source.type === "repo") {
    const row = element("div", "evidence-row");
    row.append(element("span", "evidence-name", "First-purchase condition"),
      element("strong", "evidence-value", "buyer.completedPurchases = 0"));
    const source = firstEvidence.detail.source;
    row.append(element("code", "evidence-citation",
      `${source.path}:${source.startLine}–${source.endLine} · ${source.commit.slice(0, 10)}`));
    sourceList.append(row);
  }

  setHash("trace-hash", best.traceHash);
  setText("trace-profit", money(best.profitMicros, true));
  setText("trace-drain", money(best.treasuryDrainMicros));
  const identityTerm = best.terms.find((term) => term.kind === "identityCost" && term.amountMicros !== "0");
  const transactionTerm = best.terms.find((term) => term.kind === "transactionCost");
  setText("trace-costs", `${identityTerm ? money(identityTerm.amountMicros.replace("-", "")) : "—"} identity / ${transactionTerm ? money(transactionTerm.amountMicros.replace("-", "")) : "—"} action`);

  const stages = [];
  for (const action of best.actionTrace) {
    stages.push({ kind: "PURCHASE", headline: `${money(action.action.amountMicros)} purchase submitted`,
      detail: `${action.action.buyer} buys from ${action.action.creator}; affiliate ${action.action.affiliate ?? "none"}. The action is ${action.status}.`,
      from: action.action.buyer, to: action.action.creator, amount: money(action.action.amountMicros) });
    for (const entry of action.journal) {
      stages.push({ kind: "LEDGER TRANSFER", headline: entry.ruleId === "affiliateBonus" ? "Treasury reward leaves the campaign" : `${entry.ruleId} posts to the ledger`,
        detail: `${entry.from} transfers ${money(entry.amountMicros)} to ${entry.to}. Rule: ${entry.ruleId}.`,
        from: entry.from, to: entry.to, amount: money(entry.amountMicros) });
    }
  }
  for (const term of best.terms.filter((item) => item.kind !== "journal" && item.amountMicros !== "0")) {
    stages.push({ kind: "EXTERNAL COST", headline: term.kind === "identityCost" ? "Identity assumption" : "Transaction assumption",
      detail: `${money(term.amountMicros)} is charged outside the ledger. ${term.source}.`,
      from: "Coalition", to: "Outside ledger", amount: money(term.amountMicros) });
  }
  stages.push({ kind: "RESULT", headline: `${money(best.profitMicros, true)} coalition return`,
    detail: `The accepted journal and explicit costs reconcile to the saved trace. Treasury drain: ${money(best.treasuryDrainMicros)}.`,
    from: "Replayable trace", to: "Coalition return", amount: money(best.profitMicros, true) });
  let currentStage = 0;
  const dots = byId("trace-dots");
  stages.forEach((_, index) => {
    const dot = element("button", "trace-dot", String(index + 1));
    dot.type = "button";
    dot.setAttribute("aria-label", `Show trace step ${index + 1}`);
    dot.addEventListener("click", () => showStage(index));
    dots.append(dot);
  });
  function showStage(index) {
    currentStage = index;
    const stage = stages[index];
    setText("trace-position", `${String(index + 1).padStart(2, "0")} / ${String(stages.length).padStart(2, "0")}`);
    setText("trace-kind", stage.kind);
    setText("trace-headline", stage.headline);
    setText("trace-detail", stage.detail);
    setText("flow-from", stage.from);
    setText("flow-to", stage.to);
    setText("flow-amount", stage.amount);
    byId("trace-progress-fill").style.width = `${((index + 1) / stages.length) * 100}%`;
    byId("trace-prev").disabled = index === 0;
    byId("trace-next").disabled = index === stages.length - 1;
    [...dots.children].forEach((dot, dotIndex) => dot.classList.toggle("active", dotIndex === index));
  }
  byId("trace-prev").addEventListener("click", () => showStage(Math.max(0, currentStage - 1)));
  byId("trace-next").addEventListener("click", () => showStage(Math.min(stages.length - 1, currentStage + 1)));
  showStage(0);

  setText("repair-before-profit", money(comparison.witness.baselineProfitMicros, true));
  setText("repair-after-profit", money(comparison.witness.repairProfitMicros, true));
  setText("repair-before-award", money(comparison.referencePurchase.baselineAffiliateAwardMicros));
  setText("repair-after-award", money(comparison.referencePurchase.repairAffiliateAwardMicros));
  setText("repair-rule", comparison.affiliateRules.repair.join("; "));
  setText("repair-coverage", comparison.noPositiveRepairWithinBudget
    ? "No positive repair trace found within the declared search budget."
    : "Repair search is conditional on its stated coverage.");

  const grid = sensitivity.grid;
  const choices = [
    ["select-cost", grid.identityCostsMicros.map((value) => [value, money(value)])],
    ["select-distribution", grid.honestOrderDistributions.map((item) => [item.id,
      `${item.id} · ${item.orderAmountsMicros.map((value) => money(value)).join(" / ")}`])],
    ["select-share", grid.attackerFractionsBps.map((value) => [String(value), `${value / 100}% of arrivals`])],
    ["select-order", grid.attackerOrderAmountsMicros.map((value) => [value, money(value)])],
    ["select-seed", grid.seeds.map((value) => [String(value), `Seed ${value}`])],
  ];
  for (const [id, options] of choices) {
    const select = byId(id);
    for (const [value, label] of options) {
      const option = element("option", "", label);
      option.value = value;
      select.append(option);
    }
  }
  byId("select-distribution").value = grid.honestOrderDistributions.find((item) => item.id === "small-and-normal")?.id
    ?? grid.honestOrderDistributions[0].id;
  byId("select-share").value = grid.attackerFractionsBps.includes(5000) ? "5000" : String(grid.attackerFractionsBps[0]);
  byId("select-order").value = grid.attackerOrderAmountsMicros.includes("5000000") ? "5000000" : grid.attackerOrderAmountsMicros[0];
  function showScenario() {
    const cost = byId("select-cost").value;
    const distribution = byId("select-distribution").value;
    const share = Number(byId("select-share").value);
    const order = byId("select-order").value;
    const seed = Number(byId("select-seed").value);
    const cell = sensitivity.cells.find((item) => item.identityCostMicros === cost &&
      item.honestOrderDistribution.id === distribution && item.attackerFractionBps === share &&
      item.attackerOrderAmountMicros === order);
    const run = cell?.seedRuns.find((item) => item.seed === seed);
    if (!cell || !run) throw new Error("Selected combination is outside the saved sensitivity grid");
    setText("scenario-profit", money(run.metrics.attackerProfitMicros, true));
    setText("scenario-revenue", money(run.metrics.platformRevenueMicros));
    setText("scenario-treasury", money(run.metrics.treasurySpentMicros));
    setText("scenario-affiliate", money(run.metrics.affiliatePayoutMicros));
    setText("scenario-failed", run.metrics.failedActions);
    setText("scenario-region", cell.summary.region);
    setText("scenario-range", `Selected-seed profit range: ${cell.summary.attackerProfitRangeMicros.map((value) => money(value)).join(" to ")}`);
    setHash("scenario-run-hash", run.runHash);
    byId("scenario-profit").classList.toggle("loss", run.metrics.attackerProfitMicros.startsWith("-"));
  }
  byId("assumption-controls").addEventListener("change", showScenario);
  byId("cost-control").addEventListener("click", () => {
    if (grid.identityCostsMicros.includes("500000")) {
      byId("select-cost").value = "500000";
      showScenario();
    }
  });
  showScenario();

  const claimList = byId("claim-list");
  for (const claim of data.recommendation.claims) {
    const details = element("details", "claim-card");
    const summary = element("summary", "claim-summary");
    summary.append(element("span", "claim-name", claim.id.replaceAll("-", " ")),
      element("span", "claim-confidence", claim.confidence.replaceAll("_", " ")));
    details.append(summary, element("p", "claim-text", claim.text));
    const refs = element("ul", "claim-refs");
    for (const ref of claim.references) refs.append(element("li", "", `${ref.artifact}.${ref.path} · ${shortHash(ref.valueHash)}`));
    details.append(refs);
    claimList.append(details);
  }
  setHash("data-hash", data.dataHash);
})();
