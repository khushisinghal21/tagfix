// Prints the scorecard for every ticket set, with and without account-signal triage.
import { runAll, summarise } from "../src/metrics.js";
import { HELD_OUT, HELD_OUT_2, TICKETS } from "../src/tickets.js";

const sets = { base: TICKETS, held_out_1: HELD_OUT, held_out_2: HELD_OUT_2 };
for (const [name, set] of Object.entries(sets)) {
  for (const [mode, opts] of [["rules only", { noTriage: true }], ["rules + account triage", {}]]) {
    const s = summarise(runAll(set, opts));
    console.log(`${name.padEnd(11)} ${mode.padEnd(23)} n=${s.tickets}  intent ${s.intentAccuracy}%  decision ${s.decisionAccuracy}%  no-agent ${s.handledWithoutAgentPct}%  disputes ${s.disputesWithEvidence}`);
  }
}
