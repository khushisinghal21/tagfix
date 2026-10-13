// Account-signal triage. Keyword rules miss most real phrasing (measured: 1 of 12 unseen
// messages). But a FASTag account usually shows what's wrong before the customer finishes
// typing: a duplicate pair, a stuck recharge, a blacklist flag. When the message is about
// money or tolls and the account shows exactly one issue, route to that issue and say so
// in the reply, so a wrong guess costs the customer one line, not a wrong refund.

import {
  blacklistStatus, findDuplicates, findImpossibleTravel, findLatePostings, findOvercharges, findPassMisses, pendingRecharge, pendingTolls,
} from "./checks.js";
import { PLAZAS } from "./data.js";
import { RULES } from "./rules.js";

// Known non-transaction topics from Park+'s help centre (replacement, delivery, profile
// updates). These go to an agent; account signals must not hijack them.
// Covers the non-transaction folders of Park+'s FASTag help centre (Delivery, Replacement,
// Profile update, Activation) and Park+'s other products (car wash, challan, parking...).
const NON_TRANSACTION = /(sticker|damaged|lost|replace|replacement|deliver|delivery|courier|order status|phone number|mobile number|change (my )?(number|vehicle|address)|vehicle number|address|close (my )?(fastag|account|tag)|cancel|activat(e|ion) (my |a )?(new )?(fastag|tag)|car ?wash|cleaner|cleaning|challan|parking|valet|insurance|loan|servic(e|ing)|tyre|petrol|fuel|voucher|cashback|wallet refund)/i;

// Is the message about money moving on the tag?
const MONEY_TOPIC = /(toll|charg|deduct|debit|kat|kaat|paise|paisa|money|rupee|\brs\b|₹|\d{2,5}|fastag|\btag\b|balance|recharge|payment|paid|upi|sms|transaction|wallet|barrier|inactive|deactivat|declin|passbook|statement|app shows)/i;

const PRIORITY = ["blacklisted", "recharge_not_reflecting", "double_deduction", "false_deduction", "annual_pass", "wrong_amount", "passbook_missing", "return_trip"];

/** Every issue the account itself shows, one per transaction, most urgent first. */
export function accountSignals(acc, now) {
  const out = [];
  if (blacklistStatus(acc).blacklisted) out.push({ intent: "blacklisted", txnId: null });
  const pr = pendingRecharge(acc, now);
  if (pr) out.push({ intent: "recharge_not_reflecting", txnId: pr.txn.id });
  for (const d of findDuplicates(acc)) out.push({ intent: "double_deduction", txnId: d.duplicate.id });
  for (const i of findImpossibleTravel(acc)) out.push({ intent: "false_deduction", txnId: i.later.id });
  for (const o of findOvercharges(acc)) out.push({ intent: "wrong_amount", txnId: o.txn.id });
  for (const m of findPassMisses(acc)) out.push({ intent: "annual_pass", txnId: m.id });
  // A toll posted long after it was read arrives as a "new" SMS: the likeliest thing a
  // vague message about a charge is asking about. The handler confirms the trip first.
  for (const l of findLatePostings(acc)) {
    if ((Date.parse(now) - Date.parse(l.txn.postedTime)) / 3.6e6 <= 48) out.push({ intent: "false_deduction", txnId: l.txn.id });
  }
  for (const p of pendingTolls(acc)) out.push({ intent: "passbook_missing", txnId: p.id });
  // Benign but commonly mistaken for a double charge: two reads at one plaza within 24h.
  const tolls = acc.transactions.filter((x) => x.type === "toll" && x.status === "success");
  for (let i = 1; i < tolls.length; i++) {
    const a = tolls[i - 1], b = tolls[i];
    if (a.plazaId === b.plazaId && PLAZAS[a.plazaId] && a.amount > 0 && b.amount > 0
      && (Date.parse(b.time) - Date.parse(a.time)) / 3.6e6 <= RULES.returnJourneyHours) {
      out.push({ intent: "return_trip", txnId: b.id });
    }
  }
  // One issue per transaction: keep the most urgent reading of it.
  const seen = new Set(), unique = [];
  for (const s of out.sort((x, y) => PRIORITY.indexOf(x.intent) - PRIORITY.indexOf(y.intent))) {
    if (s.txnId && seen.has(s.txnId)) continue;
    if (s.txnId) seen.add(s.txnId);
    unique.push(s);
  }
  return unique;
}

/**
 * Decide the intent from the account when the message alone wasn't enough.
 * Returns { intent, via } or null when the account doesn't point to one issue.
 */
export function isNonTransaction(text) { return NON_TRANSACTION.test(text); }

export function triageFromAccount(text, acc, now, { exclude } = {}) {
  if (NON_TRANSACTION.test(text) || !MONEY_TOPIC.test(text)) return null;
  const signals = accountSignals(acc, now);
  const real = signals.filter((s) => s.intent !== "return_trip" && s.intent !== exclude);
  if (real.length === 1) return { intent: real[0].intent, txnId: real[0].txnId, via: "account_signal" };
  if (real.length === 0 && signals.length && exclude !== "double_deduction") return { intent: "double_deduction", txnId: signals[0].txnId, via: "account_signal" };
  return null;
}
