import { canonicalJson, hashCanonical } from "../economic-model/canonical.ts";
import type { MechanismComparison } from "../economic-model/compare.ts";
import type { FindingReport } from "../economic-model/finding.ts";
import type { RecommendationArtifact } from "../economic-model/recommendation.ts";
import type { SensitivityResult } from "../economic-model/sensitivity.ts";

export type DemoData = {
  schemaVersion: 1;
  finding: FindingReport;
  comparison: MechanismComparison;
  sensitivity: SensitivityResult;
  recommendation: RecommendationArtifact;
  dataHash: string;
};

/** The page receives only validated, precomputed run artifacts. */
export function buildDemoData(
  finding: FindingReport, comparison: MechanismComparison,
  sensitivity: SensitivityResult, recommendation: RecommendationArtifact,
): DemoData {
  if (!finding.best || !comparison.witness) throw new Error("Demo requires a positive finding and comparison witness");
  const { comparisonHash, ...comparisonCore } = comparison;
  const { sweepHash, ...sweepCore } = sensitivity;
  const { recommendationHash, ...recommendationCore } = recommendation;
  if (comparisonHash !== hashCanonical(comparisonCore) || sweepHash !== hashCanonical(sweepCore) ||
    recommendationHash !== hashCanonical(recommendationCore)) {
    throw new Error("Demo input artifact hash is invalid");
  }
  if (finding.modelHash !== comparison.baseline.modelHash || finding.runHash !== comparison.baseline.runHash ||
    finding.best.traceHash !== comparison.witness.baselineTraceHash ||
    recommendation.baselineModelHash !== finding.modelHash ||
    recommendation.repairModelHash !== comparison.repair.modelHash ||
    recommendation.searchRunHash !== finding.runHash ||
    recommendation.comparisonHash !== comparisonHash || recommendation.sensitivityHash !== sweepHash) {
    throw new Error("Demo artifacts do not describe the same linked runs");
  }
  const core = { schemaVersion: 1 as const, finding, comparison, sensitivity, recommendation };
  return { ...core, dataHash: hashCanonical(core) };
}

export function renderDemoHtml(data: DemoData, css: string, clientScript: string): string {
  const { dataHash, ...core } = data;
  if (dataHash !== hashCanonical(core)) throw new Error("Demo data hash is invalid");
  const embedded = canonicalJson(data).replaceAll("<", "\\u003c");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Boid · Marketplace finding</title>
  <style>${css}</style>
</head>
<body>
  <header class="topbar">
    <a class="brand" href="#overview" aria-label="Boid overview"><span class="brand-mark">B</span><span>boid<span class="brand-dot">.</span></span></a>
    <span class="topbar-note">ECONOMIC MODEL / REVIEW 01</span>
    <a class="topbar-link" href="#evidence">View evidence <span aria-hidden="true">↗</span></a>
  </header>

  <main id="overview">
    <section class="hero" aria-labelledby="hero-title">
      <div class="hero-copy">
        <p class="eyebrow"><span class="signal-dot"></span> CONDITIONAL FINDING <span class="eyebrow-line"></span> CREATOR MARKETPLACE</p>
        <h1 id="hero-title">A small purchase.<br><em>A costly reward.</em></h1>
        <p class="hero-description">A threshold purchase can trigger a treasury-funded affiliate award. Follow the source rule, every transfer, and the proposed repair.</p>
        <div class="hero-actions"><a class="button button-lime" href="#trace">Follow the money <span aria-hidden="true">↗</span></a><a class="text-link" href="#source">Start at the rule <span aria-hidden="true">↓</span></a></div>
      </div>
      <div class="hero-visual" aria-label="Finding summary">
        <div class="hero-visual-label">ONE REPLAYED PURCHASE</div>
        <div class="hero-number" id="hero-profit">—</div>
        <div class="hero-number-caption">coalition return</div>
        <div class="hero-rule"></div>
        <div class="hero-visual-row"><span>Campaign treasury</span><strong id="hero-treasury">—</strong></div>
        <div class="hero-visual-row"><span>Purchase threshold</span><strong id="hero-threshold">—</strong></div>
        <div class="hero-visual-foot">Derived from a replayable ledger trace <span aria-hidden="true">↗</span></div>
      </div>
    </section>

    <nav class="section-nav" aria-label="Demo sections"><a href="#source">01 / Source rule</a><a href="#trace">02 / Action trace</a><a href="#repair">03 / Repair trade-off</a><a href="#sensitivity">04 / Assumptions</a></nav>

    <section class="content-section source-section" id="source" aria-labelledby="source-title">
      <div class="section-intro"><span class="section-index">01 / SOURCE RULE</span><h2 id="source-title">The rule in the repository</h2><p>The economic model records the source span for each value. The award is paid from the campaign treasury when a first purchase meets the threshold.</p></div>
      <div class="source-layout">
        <div class="rule-spotlight"><span class="mini-label">FIRST PURCHASE THRESHOLD</span><div class="threshold-number" id="source-threshold">—</div><div class="threshold-description">A qualifying purchase activates the affiliate rule.</div><div class="rule-spotlight-bottom"><span>CAMPAIGN TREASURY → AFFILIATE</span><strong id="source-award">—</strong></div></div>
        <div class="evidence-card"><div class="card-header"><h3>Pinned source evidence</h3><span class="tag">SOURCE BACKED</span></div><div id="source-evidence" class="evidence-list"></div><div class="hash-row">Model <code id="source-model-hash"></code></div></div>
      </div>
    </section>

    <section class="content-section trace-section" id="trace" aria-labelledby="trace-title">
      <div class="section-intro"><span class="section-index">02 / ACTION TRACE</span><h2 id="trace-title">Follow every transfer</h2><p>Step through the accepted purchase, ledger entries, and external costs. The displayed return comes from the saved trace.</p></div>
      <div class="trace-shell"><div class="trace-topline"><span class="mini-label">REPLAYED STRATEGY</span><code id="trace-hash"></code></div><div class="trace-progress"><span id="trace-position">—</span><div class="progress-track"><div id="trace-progress-fill"></div></div></div><div class="trace-main"><div class="trace-description"><span id="trace-kind" class="trace-kind">—</span><h3 id="trace-headline">—</h3><p id="trace-detail">—</p></div><div class="flow-panel"><div class="flow-label">VALUE FLOW</div><div class="flow-from" id="flow-from">—</div><div class="flow-arrow">↓</div><div class="flow-to" id="flow-to">—</div><div class="flow-amount" id="flow-amount">—</div></div></div><div class="trace-controls"><button id="trace-prev" type="button" aria-label="Previous trace step">← Previous</button><div id="trace-dots" class="trace-dots" aria-label="Trace steps"></div><button id="trace-next" type="button" aria-label="Next trace step">Next →</button></div></div>
      <div class="trace-outcome"><div><span class="mini-label">FINAL COALITION RETURN</span><strong id="trace-profit">—</strong></div><div><span class="mini-label">TREASURY SPENT</span><strong id="trace-drain">—</strong></div><div><span class="mini-label">COST ASSUMPTIONS</span><strong id="trace-costs">—</strong></div></div>
    </section>

    <section class="content-section repair-section" id="repair" aria-labelledby="repair-title">
      <div class="section-intro"><span class="section-index">03 / REPAIR TRADE-OFF</span><h2 id="repair-title">Fund the award from fees</h2><p>The tested change ties the affiliate award to the fee actually collected. It reduces the measured coalition return and the honest reference award.</p></div>
      <div class="repair-grid"><article class="compare-card baseline-card"><span class="mini-label">BASELINE / TREASURY FUNDED</span><div class="compare-value positive" id="repair-before-profit">—</div><p>Coalition return on the same trace</p><div class="compare-divider"></div><div class="compare-small"><span>Honest reference award</span><strong id="repair-before-award">—</strong></div></article><div class="comparison-arrow" aria-hidden="true">→</div><article class="compare-card fixed-card"><span class="mini-label">TESTED / FEE FUNDED</span><div class="compare-value" id="repair-after-profit">—</div><p>Coalition return on the same trace</p><div class="compare-divider"></div><div class="compare-small"><span>Honest reference award</span><strong id="repair-after-award">—</strong></div></article></div>
      <div class="repair-note"><span class="note-symbol">i</span><span id="repair-rule">—</span><span id="repair-coverage">—</span></div>
    </section>

    <section class="content-section sensitivity-section" id="sensitivity" aria-labelledby="sensitivity-title">
      <div class="section-intro"><span class="section-index">04 / ASSUMPTIONS</span><h2 id="sensitivity-title">Change the inputs.<br>See the conditional result.</h2><p>Choose among precomputed scenarios. Each selection points to a saved seed run; the page does not recalculate payouts.</p></div>
      <div class="sensitivity-layout"><form class="assumption-controls" id="assumption-controls"><div class="controls-head"><h3>Scenario inputs</h3><span class="tag">PRECOMPUTED GRID</span></div><label>Identity cost <select id="select-cost" name="identityCost"></select></label><label>Honest order sizes <select id="select-distribution" name="honestOrders"></select></label><label>Attacker share <select id="select-share" name="attackerShare"></select></label><label>Attacker order <select id="select-order" name="attackerOrder"></select></label><label>Paired seed <select id="select-seed" name="seed"></select></label><button id="cost-control" type="button" class="control-shortcut">Try the 0.50 USDC cost control ↗</button></form><div class="scenario-result"><div class="scenario-result-top"><span class="mini-label">SELECTED RUN / NOT A FORECAST</span><span id="scenario-region" class="region-pill">—</span></div><div class="scenario-profit" id="scenario-profit">—</div><div class="scenario-profit-caption">attacker profit for this seed</div><div class="scenario-metrics"><div><span>Platform revenue</span><strong id="scenario-revenue">—</strong></div><div><span>Treasury spent</span><strong id="scenario-treasury">—</strong></div><div><span>Affiliate payout</span><strong id="scenario-affiliate">—</strong></div><div><span>Failed actions</span><strong id="scenario-failed">—</strong></div></div><div class="scenario-foot"><span id="scenario-range">—</span><code id="scenario-run-hash"></code></div></div></div>
      <p class="limitation">The seed range is variation across selected deterministic runs, not a confidence interval for future demand. Identity cost and common control remain assumptions.</p>
    </section>

    <section class="content-section evidence-section" id="evidence" aria-labelledby="evidence-title"><div class="section-intro"><span class="section-index">EVIDENCE / LIMITS</span><h2 id="evidence-title">What supports the recommendation</h2><p>Each statement links to an artifact path and carries a confidence label. Expand a claim to inspect its lineage.</p></div><div id="claim-list" class="claim-list"></div><div class="artifact-hashes"><span>ARTIFACT BUNDLE</span><code id="data-hash"></code></div></section>
  </main>
  <footer><span>BOID / CONDITIONAL ECONOMIC REVIEW</span><span>Built from pinned model and replayable run artifacts</span></footer>
  <script id="boid-data" type="application/json">${embedded}</script>
  <script>${clientScript}</script>
</body>
</html>\n`;
}
