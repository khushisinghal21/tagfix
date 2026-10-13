// Turns (customer message, account) into a decision, the facts behind it, the actions to
// take, and a reply in the customer's language. Facts come only from checks.js; the reply
// is assembled from those facts, so every number in it can be traced to a transaction.

import { CHANNELS, RULES } from "./rules.js";
import { understand } from "./intents.js";
import { triageFromAccount } from "./triage.js";
import {
  blacklistStatus, expectedTariff, findDuplicates, findImpossibleTravel, findOvercharges,
  pendingRecharge, pendingTolls, plazaName,
} from "./checks.js";

export const DECISIONS = {
  auto_resolved: "Resolved in chat",
  dispute_filed: "Dispute filed with evidence",
  escalated: "Escalated to an agent",
  needs_info: "Asked the customer for one detail",
};

const inr = (n) => `₹${n}`;
const hhmm = (iso) => iso.slice(11, 16);
const day = (iso) => {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${d} ${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"].at(m - 1)}`;
};
const when = (iso) => `${day(iso)}, ${hhmm(iso)}`;

function fact(text, evidence = []) { return { text, evidence }; }

// Each handler returns { decision, facts, actions, reply: { en, hinglish } }.
const HANDLERS = {
  double_deduction(acc) {
    const dups = findDuplicates(acc);
    if (dups.length) {
      const { original: o, duplicate: d, gapMin } = dups.at(-1);
      const place = plazaName(d.plazaId);
      return {
        decision: "dispute_filed",
        facts: [
          fact(`${inr(o.amount)} was debited twice at ${place}, ${gapMin} minutes apart (${hhmm(o.time)} and ${hhmm(d.time)}).`, [o.id, d.id]),
          fact(`Same plaza, same amount, within ${RULES.duplicateWindowMin} minutes: treated as a duplicate read.`, [d.id]),
        ],
        actions: [{ type: "dispute", channel: CHANNELS.issuerDispute, txnId: d.id, amount: d.amount, reason: "duplicate_read",
          evidence: [o.id, d.id] }],
        reply: {
          en: `You're right. ${inr(d.amount)} was charged twice at ${place} on ${day(d.time)}, at ${hhmm(o.time)} and ${hhmm(d.time)}. I've raised a refund for the duplicate (${d.id}) of ${inr(d.amount)} with the issuing bank, with both transactions attached as proof. You'll get an update here as soon as the bank responds.`,
          hinglish: `Aap sahi hain. ${place} par ${day(d.time)} ko ${inr(d.amount)} do baar kata, ${hhmm(o.time)} aur ${hhmm(d.time)} par. Maine duplicate transaction (${d.id}) ke ${inr(d.amount)} ka refund bank ke saath raise kar diya hai, dono transactions proof ke saath. Bank ka jawab aate hi aapko yahin update milega.`,
        },
      };
    }
    // No duplicate: explain what the "second" charge actually was.
    const ts = acc.transactions.filter((x) => x.type === "toll" && x.status === "success");
    const last = ts.at(-1);
    const exp = last ? expectedTariff(acc, last) : null;
    if (last && exp?.kind === "return" && last.amount === exp.amount) {
      const place = plazaName(last.plazaId);
      return {
        decision: "auto_resolved",
        facts: [
          fact(`${last.id} (${inr(last.amount)}) is the return leg of ${exp.returnOf} at ${place}, within ${RULES.returnJourneyHours} hours.`, [exp.returnOf, last.id]),
          fact(`A return leg is charged the round-trip fare minus the single fare already paid, so ${inr(last.amount)} is correct.`, [last.id]),
        ],
        actions: [],
        reply: {
          en: `I checked both charges at ${place}. The second one (${inr(last.amount)}, ${hhmm(last.time)}) isn't a duplicate. It's your return trip within ${RULES.returnJourneyHours} hours, so you were charged the discounted return fare. Together the two come to the round-trip price, which is cheaper than two single trips. Nothing was overcharged.`,
          hinglish: `Maine ${place} ke dono charges check kiye. Doosra charge (${inr(last.amount)}, ${hhmm(last.time)}) duplicate nahi hai. Ye ${RULES.returnJourneyHours} ghante ke andar aapki return trip hai, isliye discounted return fare laga. Dono milakar round-trip price banta hai, jo do single trip se sasta hai. Koi extra charge nahi hua.`,
        },
      };
    }
    return escalate(acc, "double_deduction", "No duplicate pair found in the last transactions; the customer may be looking at a different charge.");
  },

  false_deduction(acc, msg) {
    const imp = findImpossibleTravel(acc);
    const over = findOvercharges(acc);
    if (imp.length) {
      const { earlier: e, later: l, km, hours, speedKmh } = imp.at(-1);
      const classHit = over.find((o) => o.txn.id === l.id && o.chargedAs && o.chargedAs !== acc.vehicleClass);
      const facts = [
        fact(`${l.id}: ${inr(l.amount)} at ${plazaName(l.plazaId)} on ${when(l.time)}.`, [l.id]),
        fact(`${hours} hours earlier the same tag was read at ${plazaName(e.plazaId)}, ${km} km away. That needs ${speedKmh} km/h, above the ${RULES.maxPlausibleSpeedKmh} km/h limit for a plausible trip.`, [e.id, l.id]),
      ];
      if (classHit) facts.push(fact(`The amount matches the ${classHit.chargedAs} rate, but this tag is registered to a ${acc.vehicleClass}. Likely another vehicle was read as this tag.`, [l.id]));
      return {
        decision: "dispute_filed",
        facts,
        actions: [{ type: "dispute", channel: `${CHANNELS.issuerDispute}; ${CHANNELS.nhaiEmail}`, txnId: l.id, amount: l.amount,
          reason: "deduction_without_crossing", evidence: [e.id, l.id] }],
        reply: {
          en: `This charge doesn't add up, and your own records show it. ${inr(l.amount)} was deducted at ${plazaName(l.plazaId)} at ${hhmm(l.time)}, but your tag was read at ${plazaName(e.plazaId)} only ${hours} hours earlier, ${km} km away.${classHit ? ` The amount is also the ${classHit.chargedAs} rate, not the ${acc.vehicleClass} rate.` : ""} I've filed a dispute for ${inr(l.amount)} (${l.id}) with this evidence attached. You don't need to call anyone; I'll update you here.`,
          hinglish: `Ye charge galat lag raha hai, aur aapke records khud ye dikhate hain. ${plazaName(l.plazaId)} par ${hhmm(l.time)} baje ${inr(l.amount)} kata, lekin sirf ${hours} ghante pehle aapka tag ${km} km door ${plazaName(e.plazaId)} par read hua tha.${classHit ? ` Amount bhi ${classHit.chargedAs} wala rate hai, ${acc.vehicleClass} ka nahi.` : ""} Maine ${inr(l.amount)} (${l.id}) ka dispute is proof ke saath file kar diya hai. Aapko kahin call karne ki zaroorat nahi, update yahin milega.`,
        },
      };
    }
    // No proof in the data: ask for the one thing that identifies the charge.
    const recent = acc.transactions.filter((x) => x.type === "toll" && x.status === "success").slice(-3);
    return {
      decision: "needs_info",
      facts: [fact("No impossible-travel or wrong-class signal in recent tolls, so the account data alone can't prove this charge is wrong.", recent.map((x) => x.id))],
      actions: [{ type: "ask", field: "which_transaction", options: recent.map((x) => x.id) }],
      reply: {
        en: `I want to get this right before raising a dispute. Which of these charges wasn't you? ${recent.map((x) => `${inr(x.amount)} at ${plazaName(x.plazaId)} (${when(x.time)})`).join("; ")}.`,
        hinglish: `Dispute raise karne se pehle confirm kar lete hain. Inme se kaunsa charge aapka nahi tha? ${recent.map((x) => `${inr(x.amount)}, ${plazaName(x.plazaId)} (${when(x.time)})`).join("; ")}.`,
      },
    };
  },

  wrong_amount(acc) {
    const over = findOvercharges(acc);
    if (!over.length) return escalate(acc, "wrong_amount", "All recent tolls match the tariff for this vehicle class; needs a human to check which charge the customer means.");
    const o = over.at(-1);
    const place = plazaName(o.txn.plazaId);
    const as = o.chargedAs && o.chargedAs !== acc.vehicleClass ? ` (the ${o.chargedAs} rate)` : "";
    return {
      decision: "dispute_filed",
      facts: [
        fact(`${o.txn.id}: charged ${inr(o.txn.amount)} at ${place}${as}.`, [o.txn.id]),
        fact(`The ${acc.vehicleClass} ${o.expectedKind === "return" ? "return-leg" : "single"} fare there is ${inr(o.expected)}, so ${inr(o.excess)} was charged extra.`, [o.txn.id]),
      ],
      actions: [{ type: "dispute", channel: CHANNELS.issuerDispute, txnId: o.txn.id, amount: o.excess, reason: "vehicle_class_mismatch",
        evidence: [o.txn.id] }],
      reply: {
        en: `You were overcharged. At ${place} on ${day(o.txn.time)} you paid ${inr(o.txn.amount)}${as}, but the fare for your ${acc.vehicleClass} is ${inr(o.expected)}. I've raised a refund of the extra ${inr(o.excess)} (${o.txn.id}) with the bank, and flagged the class mismatch so it doesn't repeat.`,
        hinglish: `Aapse zyada charge hua hai. ${place} par ${day(o.txn.time)} ko ${inr(o.txn.amount)} kata${as}, jabki aapki ${acc.vehicleClass} ka fare ${inr(o.expected)} hai. Maine extra ${inr(o.excess)} (${o.txn.id}) ka refund bank ke saath raise kar diya hai, aur class mismatch flag kar diya hai taaki dobara na ho.`,
      },
    };
  },

  recharge_not_reflecting(acc, msg, now) {
    const p = pendingRecharge(acc, now);
    if (!p) {
      return {
        decision: "auto_resolved",
        facts: [fact(`No pending recharge on this tag. Current balance ${inr(acc.balance)}.`)],
        actions: [],
        reply: {
          en: `I don't see any recharge stuck on this tag. All recharges have been credited, and your balance is ${inr(acc.balance)}. If you paid from a different app or for a different vehicle, share the UPI reference and I'll trace it.`,
          hinglish: `Is tag par koi recharge atka hua nahi dikh raha. Saare recharge credit ho chuke hain, aur balance ${inr(acc.balance)} hai. Agar payment kisi aur app se ya doosri gaadi ke liye kiya tha, to UPI reference bhejiye, main trace kar dungi.`,
        },
      };
    }
    const { txn: r, ageMin } = p;
    const hours = Math.floor(ageMin / 60), mins = ageMin % 60;
    const age = hours ? `${hours}h ${mins}m` : `${mins} minutes`;
    if (ageMin < RULES.rechargeSettleMin) {
      return {
        decision: "auto_resolved",
        facts: [fact(`Recharge ${r.id} of ${inr(r.amount)} is pending for ${age}, inside the normal ${RULES.rechargeSettleMin}-minute settlement window.`, [r.id])],
        actions: [{ type: "recheck", txnId: r.id, afterMin: RULES.rechargeSettleMin - ageMin }],
        reply: {
          en: `Your ${inr(r.amount)} recharge (${r.paymentRef ?? r.id}) went through ${age} ago and is still settling with the bank. This usually completes within ${RULES.rechargeSettleMin} minutes. I'll recheck it automatically and message you once it's credited.`,
          hinglish: `Aapka ${inr(r.amount)} ka recharge (${r.paymentRef ?? r.id}) ${age} pehle hua hai aur bank ke saath settle ho raha hai. Ye aam taur par ${RULES.rechargeSettleMin} minute mein ho jaata hai. Main khud recheck karke credit hote hi aapko message kar dungi.`,
        },
      };
    }
    const refund = ageMin >= RULES.rechargeRefundAfterHours * 60;
    const lowNow = acc.balance < acc.minBalance;
    return {
      decision: refund ? "dispute_filed" : "escalated",
      facts: [
        fact(`Recharge ${r.id} of ${inr(r.amount)} (${r.paymentRef ?? "no payment ref"}) was paid ${age} ago and is still not credited.`, [r.id]),
        fact(refund ? `Older than ${RULES.rechargeRefundAfterHours} hours: refund to the source account.` : `Past the ${RULES.rechargeSettleMin}-minute settlement window: needs a manual credit with the issuer.`, [r.id]),
        ...(lowNow ? [fact(`Balance is ${inr(acc.balance)}, below the ${inr(acc.minBalance)} minimum, so the tag risks blacklisting until this is credited.`)] : []),
      ],
      actions: [refund
        ? { type: "refund", txnId: r.id, amount: r.amount, paymentRef: r.paymentRef }
        : { type: "priority_ticket", queue: "issuer_credit", txnId: r.id, amount: r.amount, paymentRef: r.paymentRef, priority: lowNow ? "high" : "normal" }],
      reply: {
        en: refund
          ? `Your ${inr(r.amount)} recharge (${r.paymentRef}) has been stuck for ${age}, so I've started a refund to your original payment method instead of waiting longer.`
          : `Your ${inr(r.amount)} payment (${r.paymentRef}) reached us ${age} ago but hasn't been credited to the tag yet. I've sent it to our team to credit manually${lowNow ? `, marked high priority because your balance (${inr(acc.balance)}) is below the minimum and the tag could get blacklisted` : ""}. You won't be charged again.`,
        hinglish: refund
          ? `Aapka ${inr(r.amount)} ka recharge (${r.paymentRef}) ${age} se atka hai, isliye maine aur intezaar karne ke bajay original payment method par refund shuru kar diya hai.`
          : `Aapka ${inr(r.amount)} ka payment (${r.paymentRef}) ${age} pehle humein mil gaya, par abhi tag mein credit nahi hua. Maine team ko manually credit karne bhej diya hai${lowNow ? `, high priority par, kyunki balance (${inr(acc.balance)}) minimum se kam hai aur tag blacklist ho sakta hai` : ""}. Aapse dobara paise nahi katenge.`,
      },
    };
  },

  blacklisted(acc) {
    const b = blacklistStatus(acc);
    if (!b.blacklisted) {
      return {
        decision: "auto_resolved",
        facts: [fact(`Tag ${acc.tagId} is active. Balance ${inr(acc.balance)}.`)],
        actions: [],
        reply: {
          en: `Your tag isn't blacklisted. It's active with ${inr(acc.balance)}. If a toll declined it today, tell me which plaza and I'll check that read.`,
          hinglish: `Aapka tag blacklisted nahi hai. Ye active hai, balance ${inr(acc.balance)}. Agar aaj kisi toll par decline hua, to plaza ka naam bataiye, main check karti hoon.`,
        },
      };
    }
    const declined = b.declined.at(-1);
    if (b.reason === "low_balance") {
      return {
        decision: "auto_resolved",
        facts: [
          fact(`Blacklisted for low balance: ${inr(acc.balance)} against a ${inr(acc.minBalance)} minimum.`),
          ...(declined ? [fact(`${declined.id} at ${plazaName(declined.plazaId)} was declined (code ${declined.failureCode}).`, [declined.id])] : []),
        ],
        actions: [{ type: "recharge_link", amount: b.topUp }],
        reply: {
          en: `Your tag was blacklisted because the balance (${inr(acc.balance)}) dropped below the ${inr(acc.minBalance)} minimum${declined ? `, which is why ${plazaName(declined.plazaId)} declined it at ${hhmm(declined.time)}` : ""}. A recharge of ${inr(b.topUp)} clears it. Here's a one-tap link. Recharge before you leave: a tag still blacklisted when you reach the toll gets declined and you may pay double.`,
          hinglish: `Aapka tag isliye blacklist hua kyunki balance (${inr(acc.balance)}) minimum ${inr(acc.minBalance)} se kam ho gaya${declined ? `, isi wajah se ${plazaName(declined.plazaId)} par ${hhmm(declined.time)} baje decline hua` : ""}. ${inr(b.topUp)} ka recharge karte hi ye hat jaayega. Ye raha one-tap link. Nikalne se pehle recharge kar lijiye: toll par tag blacklisted mila to decline hoga aur double toll lag sakta hai.`,
        },
      };
    }
    return {
      decision: "auto_resolved",
      facts: [fact(`Blacklisted because KYC is ${acc.kyc}; balance (${inr(acc.balance)}) is not the issue.`)],
      actions: [{ type: "kyc_link" }],
      reply: {
        en: `Your balance is fine (${inr(acc.balance)}). The tag is blacklisted because your KYC isn't complete. It takes about two minutes: upload your RC and a photo ID using this link, and the tag is reactivated once KYC is approved.`,
        hinglish: `Aapka balance theek hai (${inr(acc.balance)}). Tag isliye blacklist hai kyunki KYC complete nahi hua. Isme lagbhag do minute lagte hain: is link par RC aur photo ID upload kijiye, KYC approve hote hi tag phir se active ho jaayega.`,
      },
    };
  },

  passbook_missing(acc) {
    const p = pendingTolls(acc);
    if (!p.length) return escalate(acc, "passbook_missing", "No pending toll reads on the account; the missing entry may be on another tag.");
    const x = p.at(-1);
    return {
      decision: "auto_resolved",
      facts: [fact(`${x.id}: ${inr(x.amount)} at ${plazaName(x.plazaId)} on ${when(x.time)} is still pending from the toll plaza.`, [x.id])],
      actions: [{ type: "recheck", txnId: x.id }],
      reply: {
        en: `Found it. Your ${inr(x.amount)} toll at ${plazaName(x.plazaId)} on ${when(x.time)} has been read but the plaza hasn't settled it yet, so it isn't in the passbook. It hasn't been deducted twice. I'll recheck and let you know when it posts.`,
        hinglish: `Mil gaya. ${plazaName(x.plazaId)} par ${when(x.time)} ka ${inr(x.amount)} ka toll read ho gaya hai, lekin plaza ne abhi settle nahi kiya, isliye passbook mein nahi dikh raha. Ye do baar nahi katega. Main recheck karke post hote hi bata dungi.`,
      },
    };
  },

  other(acc, msg) {
    return escalate(acc, "other", "Message didn't match a FASTag issue the copilot handles.");
  },
};

function escalate(acc, intent, why) {
  const recent = acc.transactions.slice(-3).map((x) => x.id);
  return {
    decision: "escalated",
    facts: [fact(why, recent)],
    actions: [{ type: "handoff", intent, summary: why, recent }],
    reply: {
      en: `I want to make sure this is handled properly, so I'm passing it to a support specialist with your recent transactions attached. You won't need to repeat anything.`,
      hinglish: `Ye sahi tarah se handle ho, isliye main ise support specialist ko aapke recent transactions ke saath bhej rahi hoon. Aapko kuch dobara batana nahi padega.`,
    },
  };
}

/**
 * Resolve one customer message against one account.
 * @param {string} message
 * @param {object} account
 * @param {{now?: string, understanding?: object, noTriage?: boolean}} opts  pass `understanding` to use an LLM's reading;
 *   `noTriage` turns off account-signal triage (used to measure the keyword rules alone)
 */
export function resolve(message, account, opts = {}) {
  const now = opts.now ?? new Date().toISOString();
  let u = opts.understanding ?? understand(message);
  // The message alone wasn't clear: let the account's own data point to the issue.
  if (u.intent === "other" && !opts.noTriage) {
    const t = triageFromAccount(message, account, now);
    if (t) u = { ...u, intent: t.intent, source: t.via };
  }
  const handler = HANDLERS[u.intent] ?? HANDLERS.other;
  const out = handler(account, message, now);
  const lang = u.language === "en" ? "en" : "hinglish";
  // When we inferred the issue from the account, say so: a wrong guess costs one line.
  if (u.source === "account_signal" && out.decision !== "escalated") {
    out.reply = {
      en: `${out.reply.en} (I matched your message to this from your account. If you meant something else, just tell me.)`,
      hinglish: `${out.reply.hinglish} (Maine aapke account se ye issue samjha. Agar aapka sawaal kuch aur tha, to bata dijiye.)`,
    };
  }
  return {
    intent: u.intent,
    language: u.language,
    understoodBy: u.source,
    decision: out.decision,
    decisionLabel: DECISIONS[out.decision],
    facts: out.facts,
    actions: out.actions,
    reply: out.reply[lang],
    replies: out.reply,
  };
}
