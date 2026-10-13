// Optional LLM layer (Gemini). It does two narrow jobs:
//   1. understand(): read a messy message (any language, typos, voice-note transcripts)
//      into one of the known intents. The result is validated; anything off-list falls
//      back to the rules reader.
//   2. polish(): rephrase the drafted reply more naturally in the customer's language.
//      Every number and transaction ID in the draft must survive unchanged, otherwise
//      the draft is used as-is.
// The LLM never sees a decision it can change: checks.js decides what is true.

import { INTENTS, understand as rulesUnderstand } from "./intents.js";

// gemini-2.0-flash was shut down; any current model id works. The Python agent is the maintained LLM path.
const DEFAULT_MODEL = "gemini-3.8-flash";
const URL = (key, model = DEFAULT_MODEL) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;

async function callGemini(prompt, { apiKey, model, fetchImpl = globalThis.fetch, json = false }) {
  const res = await fetchImpl(URL(apiKey, model), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0, ...(json ? { responseMimeType: "application/json" } : {}) },
    }),
  });
  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);
  const body = await res.json();
  return body?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
}

export async function understandWithLLM(message, opts) {
  const fallback = rulesUnderstand(message);
  if (!opts?.apiKey) return fallback;
  const prompt = `You triage FASTag support messages for an Indian car-services app.
Classify the customer's message into exactly one intent from this list:
${INTENTS.join(", ")}
Also return the language: "en", "hinglish" (Hindi in Roman script) or "hi" (Devanagari).
Respond with JSON only: {"intent": "...", "language": "..."}

Message: """${message}"""`;
  try {
    const parsed = JSON.parse(await callGemini(prompt, { ...opts, json: true }));
    if (!INTENTS.includes(parsed.intent) || !["en", "hinglish", "hi"].includes(parsed.language)) return fallback;
    return { ...fallback, intent: parsed.intent, language: parsed.language, source: "llm" };
  } catch {
    return fallback;
  }
}

/** Numbers, ₹ amounts and transaction IDs that must appear unchanged in any rewrite. */
export function lockedTokens(text) {
  return [...new Set([
    ...(text.match(/TX-\d+/g) ?? []),
    ...(text.match(/UPI-\d+/g) ?? []),
    ...(text.match(/₹[\d,]+\d/g) ?? []),
    ...(text.match(/\b\d{1,2}:\d{2}\b/g) ?? []),
  ])];
}

export function keepsLockedTokens(draft, rewrite) {
  return lockedTokens(draft).every((tok) => rewrite.includes(tok));
}

export async function polishWithLLM(draft, language, opts) {
  if (!opts?.apiKey) return { text: draft, polished: false };
  const lang = language === "en" ? "English" : language === "hi" ? "Hindi (Devanagari)" : "Hinglish (Hindi in Roman script)";
  const prompt = `Rewrite this support reply to sound warm and natural in ${lang}. Keep it short.
Do not change, add or remove any amount, time, or ID. Copy these exactly: ${lockedTokens(draft).join(", ")}
Do not promise anything the original doesn't promise. Return only the rewritten reply.

Reply: """${draft}"""`;
  try {
    const out = (await callGemini(prompt, opts)).trim();
    return out && keepsLockedTokens(draft, out) ? { text: out, polished: true } : { text: draft, polished: false, rejected: true };
  } catch {
    return { text: draft, polished: false };
  }
}
