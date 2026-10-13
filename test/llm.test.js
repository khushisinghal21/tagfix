import { test } from "node:test";
import assert from "node:assert/strict";

import { keepsLockedTokens, lockedTokens, polishWithLLM, understandWithLLM } from "../src/llm.js";

// A fake fetch that returns whatever text we want Gemini to "say".
const fakeGemini = (text, ok = true) => async () => ({
  ok, status: ok ? 200 : 500,
  json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }),
});

const opts = (text, ok) => ({ apiKey: "test", fetchImpl: fakeGemini(text, ok) });

test("no key: rules reader is used", async () => {
  const u = await understandWithLLM("charged twice at Kherki", {});
  assert.equal(u.source, "rules");
});

test("valid LLM intent is accepted", async () => {
  const u = await understandWithLLM("gaadi ghar pe thi, toll kat gaya", opts('{"intent":"false_deduction","language":"hinglish"}'));
  assert.equal(u.intent, "false_deduction");
  assert.equal(u.source, "llm");
});

test("made-up intent from the LLM falls back to rules", async () => {
  const u = await understandWithLLM("charged twice at Kherki", opts('{"intent":"refund_now","language":"en"}'));
  assert.equal(u.source, "rules");
  assert.equal(u.intent, "double_deduction");
});

test("broken JSON or HTTP error falls back to rules", async () => {
  assert.equal((await understandWithLLM("charged twice", opts("not json"))).source, "rules");
  assert.equal((await understandWithLLM("charged twice", opts("{}", false))).source, "rules");
});

test("locked tokens: IDs, UPI refs, rupee amounts, times", () => {
  const t = lockedTokens("TX-1004 for ₹80 at 09:16, ref UPI-88213409");
  assert.deepEqual(t.sort(), ["09:16", "TX-1004", "UPI-88213409", "₹80"].sort());
});

test("polish: a rewrite that keeps every token is used", async () => {
  const draft = "We've disputed TX-1004 for ₹80.";
  const out = await polishWithLLM(draft, "en", opts("Sorry about that! We've raised a dispute for TX-1004 (₹80)."));
  assert.equal(out.polished, true);
});

test("polish: a rewrite that changes an amount is rejected", async () => {
  const draft = "We've disputed TX-1004 for ₹80.";
  const out = await polishWithLLM(draft, "en", opts("We've refunded ₹160 for TX-1004."));
  assert.equal(out.polished, false);
  assert.equal(out.rejected, true);
  assert.equal(out.text, draft);
  assert.equal(keepsLockedTokens(draft, "TX-1004 only"), false);
});
