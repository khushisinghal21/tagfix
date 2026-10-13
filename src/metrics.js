// Runs every labelled ticket through the resolver and reports what a support lead cares
// about: how much was handled without an agent, how much was disputed with evidence, and
// where the copilot got it wrong.

import { ACCOUNTS, DEMO_NOW } from "./data.js";
import { resolve } from "./resolver.js";
import { TICKETS } from "./tickets.js";

export function runAll(tickets = TICKETS, opts = {}) {
  return tickets.map((t, i) => {
    const r = resolve(t.text, ACCOUNTS[t.account], { now: DEMO_NOW, ...opts });
    return { i, ...t, result: r,
      intentOk: r.intent === t.gold.intent, decisionOk: r.decision === t.gold.decision };
  });
}

export function summarise(rows) {
  const n = rows.length;
  const count = (f) => rows.filter(f).length;
  const pct = (k) => Math.round((k / n) * 100);
  const byDecision = {};
  for (const r of rows) byDecision[r.result.decision] = (byDecision[r.result.decision] ?? 0) + 1;
  const withoutAgent = count((r) => ["auto_resolved", "dispute_filed", "needs_info"].includes(r.result.decision));
  return {
    tickets: n,
    intentAccuracy: pct(count((r) => r.intentOk)),
    decisionAccuracy: pct(count((r) => r.decisionOk)),
    handledWithoutAgentPct: pct(withoutAgent),
    disputesWithEvidence: count((r) => r.result.decision === "dispute_filed"
      && r.result.actions.some((a) => a.type === "dispute" && a.evidence?.length)),
    byDecision,
    misses: rows.filter((r) => !r.intentOk || !r.decisionOk).map((r) => ({
      text: r.text, expected: r.gold, got: { intent: r.result.intent, decision: r.result.decision } })),
  };
}
