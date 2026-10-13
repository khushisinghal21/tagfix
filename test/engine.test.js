import { test } from "node:test";
import assert from "node:assert/strict";

import { ACCOUNTS, DEMO_NOW, PLAZAS } from "../src/data.js";
import {
  blacklistStatus, expectedTariff, findDuplicates, findImpossibleTravel, findOvercharges, haversineKm, pendingRecharge,
} from "../src/checks.js";
import { detectLanguage, extractAmount, understand } from "../src/intents.js";
import { resolve } from "../src/resolver.js";
import { accountSignals, triageFromAccount } from "../src/triage.js";
import { runAll, summarise } from "../src/metrics.js";
import { HELD_OUT, HELD_OUT_2, TICKETS } from "../src/tickets.js";

const R = (acc, text) => resolve(text, ACCOUNTS[acc], { now: DEMO_NOW });
const cites = (r, id) => r.facts.some((f) => f.text.includes(id) || f.evidence?.includes(id));

test("haversine: Kherki Daula to Khalapur is over 1,000 km", () => {
  const km = haversineKm(PLAZAS.KHERKI, PLAZAS.KHALAPUR);
  assert.ok(km > 1000 && km < 1300, `got ${km}`);
});

test("duplicates: Rohan's two ₹80 reads two minutes apart, nothing for Kabir's return trip", () => {
  const d = findDuplicates(ACCOUNTS.rohan);
  assert.equal(d.length, 1);
  assert.equal(d[0].duplicate.id, "TX-1004");
  assert.equal(findDuplicates(ACCOUNTS.kabir).length, 0);
});

test("tariff: a read minutes after the first is a duplicate, not a discounted return leg", () => {
  const exp = expectedTariff(ACCOUNTS.rohan, ACCOUNTS.rohan.transactions.find((t) => t.id === "TX-1004"));
  assert.equal(exp.kind, "single");
  assert.equal(findOvercharges(ACCOUNTS.rohan).length, 0);
});

test("tariff: Kabir's ₹40 return leg is correct, Arjun's ₹555 is the truck rate", () => {
  assert.equal(findOvercharges(ACCOUNTS.kabir).length, 0);
  const [o] = findOvercharges(ACCOUNTS.arjun);
  assert.equal(o.txn.id, "TX-3002");
  assert.equal(o.chargedAs, "truck");
  assert.ok(o.excess > 0);
});

test("impossible travel: Priya can't be at Khalapur at 07:45 and Kherki at 10:05", () => {
  const [i] = findImpossibleTravel(ACCOUNTS.priya);
  assert.equal(i.later.id, "TX-2003");
  assert.ok(i.speedKmh > 150);
});

test("pending recharge and blacklist", () => {
  assert.equal(pendingRecharge(ACCOUNTS.neha, DEMO_NOW).txn.id, "TX-4002");
  const v = blacklistStatus(ACCOUNTS.vikram);
  assert.equal(v.reason, "low_balance");
  assert.ok(v.topUp > 0);
  assert.equal(blacklistStatus(ACCOUNTS.sana).topUp, 0);
});

test("intents: language and amount detection", () => {
  assert.equal(detectLanguage("आज टोल पर दो बार पैसे कटे"), "hi");
  assert.equal(detectLanguage("bhai paise do baar kat gaye"), "hinglish");
  assert.equal(detectLanguage("charged twice at the toll"), "en");
  assert.equal(extractAmount("charged ₹555 at panipat"), 555);
  assert.equal(understand("charged twice at Kherki").intent, "double_deduction");
});

test("resolver: real duplicate files a dispute citing both transactions", () => {
  const r = R("rohan", "charged twice at Kherki this morning");
  assert.equal(r.decision, "dispute_filed");
  assert.ok(cites(r, "TX-1004"));
  assert.ok(r.actions.some((a) => a.type === "dispute" && a.evidence?.length));
});

test("resolver: a correct return fare is explained, not refunded", () => {
  const r = R("kabir", "charged twice at Kherki today, 80 and then 40");
  assert.equal(r.decision, "auto_resolved");
  assert.ok(!r.actions.some((a) => a.type === "dispute"));
});

test("resolver: answers in the customer's language", () => {
  const r = R("rohan", "bhai toll pe paise do baar kat gaye aaj subah");
  assert.equal(r.language, "hinglish");
  assert.ok(r.reply.length > 0);
});

test("resolver: non-transaction requests go to a human", () => {
  assert.equal(R("meera", "my fastag sticker is damaged, need a new one").decision, "escalated");
});

test("triage: account signals, and stays out of non-money topics", () => {
  const s = accountSignals(ACCOUNTS.kabir, DEMO_NOW);
  assert.deepEqual(s.map((x) => x.intent), ["return_trip"]);
  assert.equal(triageFromAccount("please change my address", ACCOUNTS.rohan, DEMO_NOW), null);
  assert.equal(triageFromAccount("why is my toll so weird", ACCOUNTS.priya, DEMO_NOW).intent, "false_deduction");
});

test("triage: says it guessed from the account", () => {
  const r = R("priya", "unauthorised toll transaction on my fastag");
  assert.equal(r.understoodBy, "account_signal");
  assert.match(r.replies.en, /matched your message/);
});

test("metrics: base set is fully correct", () => {
  const s = summarise(runAll(TICKETS));
  assert.equal(s.intentAccuracy, 100);
  assert.equal(s.decisionAccuracy, 100);
});

test("metrics: on every held-out miss, the copilot hands off instead of filing a wrong dispute", () => {
  for (const set of [HELD_OUT, HELD_OUT_2]) {
    for (const row of runAll(set).filter((r) => !r.decisionOk)) {
      assert.equal(row.result.decision, "escalated", row.text);
    }
  }
});
