import { test } from "node:test";
import assert from "node:assert/strict";

import { ACCOUNTS, DEMO_NOW } from "../src/data.js";
import { findLatePostings, findOvercharges, findPassMisses, passStateAt, passVerdict } from "../src/checks.js";
import { resolve } from "../src/resolver.js";
import { runAll } from "../src/metrics.js";
import { HELD_OUT_3 } from "../src/tickets.js";
import { lockedTokens } from "../src/llm.js";

const R = (acc, text) => resolve(text, ACCOUNTS[acc], { now: DEMO_NOW });
const txn = (acc, id) => ACCOUNTS[acc].transactions.find((x) => x.id === id);

test("annual pass: state over time", () => {
  assert.equal(passStateAt(ACCOUNTS.dev, DEMO_NOW), "active");
  assert.equal(passStateAt(ACCOUNTS.farhan, DEMO_NOW), "exhausted");
  assert.equal(passStateAt(ACCOUNTS.dev, "2026-08-01T10:00:00+05:30"), "before_activation");
  assert.equal(passStateAt(ACCOUNTS.rohan, DEMO_NOW), "none");
});

test("annual pass: covered NH charge is a miss; state expressway and exhausted pass are not", () => {
  assert.deepEqual(findPassMisses(ACCOUNTS.dev).map((x) => x.id), ["TX-9003"]);
  assert.equal(passVerdict(ACCOUNTS.aditi, txn("aditi", "TX-9103")).verdict, "not_covered");
  assert.equal(passVerdict(ACCOUNTS.farhan, txn("farhan", "TX-9203")).verdict, "exhausted");
  assert.equal(findPassMisses(ACCOUNTS.aditi).length, 0);
});

test("annual pass: a pass miss is not double-reported as a wrong vehicle class", () => {
  assert.equal(findOvercharges(ACCOUNTS.dev).length, 0);
});

test("annual pass: dispute goes to NHAI's pass channel, not the bank", () => {
  const r = R("dev", "annual pass hai phir bhi toll kat gaya");
  assert.equal(r.decision, "dispute_filed");
  assert.match(r.actions[0].channel, /Annual Pass/);
  assert.ok(r.facts.some((f) => f.evidence.includes("TX-9003")));
});

test("annual pass: state expressway charge is explained, not disputed", () => {
  const r = R("aditi", "I have the annual pass, why was I charged at Khalapur?");
  assert.equal(r.decision, "auto_resolved");
  assert.match(r.replies.en, /National Highway/);
});

test("annual pass: used-up pass explains round trips count twice and offers renewal", () => {
  const r = R("farhan", "my annual pass is not working");
  assert.equal(r.decision, "auto_resolved");
  assert.match(r.replies.en, /two trips/);
  assert.ok(r.actions.some((a) => a.type === "renew_pass_link"));
});

test("booth payment: asks for the receipt before disputing", () => {
  const r = R("isha", "paid cash at the counter and the fastag also deducted");
  assert.equal(r.intent, "paid_at_booth");
  assert.equal(r.decision, "needs_info");
  assert.equal(r.actions[0].field, "booth_receipt");
  assert.equal(r.actions[0].then.txnId, "TX-9302");
});

test("late posting: detected from read vs posted time, and confirmed before any dispute", () => {
  assert.deepEqual(findLatePostings(ACCOUNTS.tanvi).map((l) => l.txn.id), ["TX-9402"]);
  assert.equal(findLatePostings(ACCOUNTS.isha).length, 0); // 12 minutes is normal
  const r = R("tanvi", "toll deducted today but I never crossed any toll today");
  assert.equal(r.decision, "needs_info");
  assert.equal(r.actions[0].field, "confirm_trip");
  assert.match(r.replies.en, /10 Oct/);
});

test("blacklisted: quotes the current penalty (2x cash, 1.25x UPI)", () => {
  const r = R("vikram", "my fastag is blacklisted");
  assert.match(r.replies.en, /1\.25x/);
  assert.match(r.replies.en, /2x/);
});

test("unsupported claim + one clear account problem → answers that problem and says so", () => {
  const r = R("rohan", "mera fastag se extra kat gaya");
  assert.equal(r.intent, "double_deduction");
  assert.equal(r.understoodBy, "account_signal");
  assert.match(r.replies.hinglish, /account se/);
});

test("non-FASTag Park+ topics go to an agent even when the account has an issue", () => {
  assert.equal(R("neha", "challan payment pending for 5 days").decision, "escalated");
  assert.equal(R("kabir", "how do I close my fastag and get balance back").decision, "escalated");
  assert.equal(R("sana", "parking booking refund not received").decision, "escalated");
});

test("no reply overpromises a fix the copilot can't make", () => {
  const r = R("arjun", "charged truck rate at panipat");
  assert.doesNotMatch(r.replies.en, /doesn't repeat/);
  assert.match(r.replies.en, /2 to 4 weeks/);
});

test("Held-out 3: never a confident wrong action", () => {
  for (const row of runAll(HELD_OUT_3).filter((r) => !r.decisionOk)) {
    assert.equal(row.result.decision, "escalated", row.text);
  }
});

test("locked tokens handle Indian digit grouping", () => {
  assert.ok(lockedTokens("pass costs ₹3,075").includes("₹3,075"));
});
