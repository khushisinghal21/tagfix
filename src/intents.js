// Rules-based understanding of a customer's message: what the problem is, what language
// they wrote in, and any amount or plaza they mentioned. Works offline and is the fallback
// when no LLM is configured or the LLM's answer doesn't validate.

import { PLAZAS } from "./data.js";

export const INTENTS = [
  "annual_pass",
  "paid_at_booth",
  "double_deduction",
  "false_deduction",
  "wrong_amount",
  "recharge_not_reflecting",
  "blacklisted",
  "passbook_missing",
  "other",
];

// Order matters: the first intent whose patterns match wins. More specific problems come
// before broader ones ("recharge kiya, balance nahi aaya" is a recharge issue, not a
// generic deduction complaint).
const PATTERNS = [
  // Annual Pass first: "pass hai phir bhi kata" is about the pass, not a generic deduction.
  ["annual_pass", [
    /annual\s*(pass|plan|toll pass|fastag)/i, /(yearly|annual)\s*(fastag\s*|toll\s*)?(pass|plan)/i, /(saal|saala|saalana|salana|sal)\s*(ka|wala|bhar ka)?\s*pass/i,
    /\b3,?0[0-9]{2}\s*(wala|rs|₹|rupees?|ka)?\s*pass/i, /trips?\s*(left|remaining|bache|bachi|khatam|used up|over|finish)/i,
    /\bpass\b.*\b(active|activated|trips?|khatam|expired?|kaam nahi|stopped|not working|liya|li thi|hone ke baad|hai phir bhi|ke bawajood)\b/i,
    /(my|mera|meri)\s+pass\b/i, /वार्षिक पास|सालाना पास|एनुअल पास/, /rajmarg\s*yatra/i,
  ]],
  // Paid at the booth (cash/UPI/QR) and the tag was charged too.
  ["paid_at_booth", [
    /(paid|pay kiya|pay kar|diya|de diya|gave).{0,40}(booth|counter|cash|upi|qr|gpay|phonepe|paytm)\b.{0,60}(tag|fastag|also|bhi)/i,
    /(cash|counter|booth|upi)\s*(pe|par|at)?\s*(bhi|also).{0,40}(tag|fastag)/i,
    /(cash|upi|counter|booth).{0,30}\b(and|aur|plus)\b.{0,30}(tag|fastag).{0,20}(bhi|also|too|deduct|kat|charge)/i,
    /once (at|from) (the )?(counter|booth|cash)/i, /(tag|fastag) (didn'?t|did not|nahi|nahin) (scan|read|chala|work).{0,60}(paid|diya|cash|upi)/i,
  ]],
  ["recharge_not_reflecting", [
    /recharge.*(not|nahi|nahin|na).*(reflect|credit|update|aaya|aya|dikh|show)/i,
    /(paid|payment|pay kiya|paise kat|deducted from (my )?bank|upi).*(balance|wallet).*(not|nahi|same|still)/i,
    /recharge.*(pending|stuck|atak)/i,
    /रिचार्ज.*(नहीं|नही)/,
    /balance (not|nahi) (updated|aaya|badha)/i,
  ]],
  ["blacklisted", [
    /black\s*-?\s*list/i, /hot\s*-?\s*list/i, /ब्लैकलिस्ट/, /kyc (pending|incomplete|nahi hua)/i,
    /(tag|fastag)\s*(is |got |has been )?(blocked|band|inactive|deactivated|suspended)/i,
    /(tag|fastag).*(declined|not working|nahi chal|nahi chala|reject)/i,
    /toll (pe|par) (tag )?(nahi|nahin) (chala|chal raha)/i,
  ]],
  ["double_deduction", [
    /\btwice\b/i, /\bdouble\b/i, /\bduplicate\b/i, /(do|2|two) (baar|bar|times)/i, /दो बार/,
    /charged (two|2) times/i,
  ]],
  ["false_deduction", [
    /without (crossing|passing|going)/i, /never (crossed|went|passed|travel)/i,
    /(car|gaadi|gadi|vehicle).*(at home|ghar (pe|par|mein)|parked|garage)/i,
    /(gaya|gayi|gaye) (hi )?(nahi|nahin)/i, /not my (car|vehicle)/i, /wrong vehicle/i,
    /गया ही नहीं|घर पर/, /wasn'?t (even )?there/i, /(was|were) in [a-z]+ (city|that day)/i,
    /\bin (pune|mumbai|bangalore|bengaluru|chennai|hyderabad|kolkata)\b/i,
  ]],
  ["wrong_amount", [
    /(extra|more than|zyada|jyada|jada|ज़्यादा|ज्यादा)/i, /overcharg/i, /wrong amount/i,
    /(truck|bus|commercial|heavy) (rate|price|charge|toll)/i, /charged ₹?\s?\d+.*(should|instead|normally|usually)/i,
  ]],
  ["passbook_missing", [
    /passbook/i, /statement/i, /(not|nahi) (showing|dikh)/i, /history/i, /transaction (missing|not visible)/i,
  ]],
];

export function detectIntent(text) {
  for (const [intent, regs] of PATTERNS) {
    if (regs.some((r) => r.test(text))) return intent;
  }
  return "other";
}

const HINGLISH = /\b(hai|hain|nahi|nahin|kya|mera|meri|mere|mujhe|baar|kiya|kar|gaya|gayi|hua|tha|thi|paise|gaadi|gadi|ghar|kyun|kab|abhi|bhi|se|pe|par)\b/i;

export function detectLanguage(text) {
  if (/[ऀ-ॿ]/.test(text)) return "hi";
  const hits = (text.match(new RegExp(HINGLISH.source, "gi")) || []).length;
  return hits >= 2 ? "hinglish" : "en";
}

export function extractAmount(text) {
  const m = text.match(/(?:₹|rs\.?|inr)\s?(\d{2,5})/i) || text.match(/\b(\d{2,5})\s?(?:rs|rupees|rupaye|₹)/i);
  return m ? Number(m[1]) : null;
}

export function extractPlaza(text) {
  const lower = text.toLowerCase();
  for (const p of Object.values(PLAZAS)) {
    const firstWord = p.name.split(/[ ,]/)[0].toLowerCase();
    if (lower.includes(firstWord)) return p.id;
  }
  return null;
}

export function understand(text) {
  return {
    intent: detectIntent(text),
    language: detectLanguage(text),
    amount: extractAmount(text),
    plazaId: extractPlaza(text),
    source: "rules",
  };
}
