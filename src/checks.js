// Deterministic checks over the account's own transactions. These decide what is true;
// nothing an LLM writes can change a check's result.

import { PLAZAS } from "./data.js";
import { RULES } from "./rules.js";

const minutes = (a, b) => (Date.parse(b) - Date.parse(a)) / 60000;

export function haversineKm(a, b) {
  const R = 6371, rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const tolls = (acc) => acc.transactions
  .filter((x) => x.type === "toll" && x.status === "success")
  .sort((a, b) => Date.parse(a.time) - Date.parse(b.time));

/** Pairs of debits at the same plaza, same amount, within the duplicate window. */
export function findDuplicates(acc) {
  const ts = tolls(acc), out = [];
  for (let i = 0; i < ts.length; i++) {
    for (let j = i + 1; j < ts.length; j++) {
      const gap = minutes(ts[i].time, ts[j].time);
      if (gap > RULES.duplicateWindowMin) break;
      if (ts[i].plazaId === ts[j].plazaId && ts[i].amount === ts[j].amount) {
        out.push({ original: ts[i], duplicate: ts[j], gapMin: Math.round(gap) });
      }
    }
  }
  return out;
}

/**
 * Annual Pass state at a moment: "none", "before_activation", "active", "exhausted", "expired".
 * The pass is NHAI's; this reads the pass record the issuer receives with the tag.
 */
export function passStateAt(acc, iso) {
  const p = acc.annualPass;
  if (!p) return "none";
  const t = Date.parse(iso);
  if (t < Date.parse(p.activatedAt)) return "before_activation";
  if (p.exhaustedAt && t > Date.parse(p.exhaustedAt)) return "exhausted";
  if (t >= Date.parse(p.expiresAt)) return "expired";
  return "active";
}

/** Why a toll was (or wasn't) covered by the Annual Pass. */
export function passVerdict(acc, txn) {
  const state = passStateAt(acc, txn.time);
  const plaza = PLAZAS[txn.plazaId];
  if (state === "none") return { verdict: "no_pass" };
  if (state !== "active") return { verdict: state };
  if (!plaza?.annualPass) return { verdict: "not_covered", operator: plaza?.operator };
  return { verdict: txn.amount > 0 ? "should_be_free" : "covered" };
}

/** Tolls charged at a covered plaza while the Annual Pass was active. */
export function findPassMisses(acc) {
  if (!acc.annualPass) return [];
  return tolls(acc).filter((x) => x.amount > 0 && passVerdict(acc, x).verdict === "should_be_free");
}

/** Tolls the plaza posted long after the tag was read (SMS arrives on a different day). */
export function findLatePostings(acc) {
  return tolls(acc).filter((x) => x.postedTime && minutes(x.time, x.postedTime) > RULES.latePostingMin)
    .map((x) => ({ txn: x, delayHours: Math.round(minutes(x.time, x.postedTime) / 6) / 10 }));
}

/** The tariff this vehicle should have paid for a toll, accounting for return journeys. */
export function expectedTariff(acc, txn) {
  const plaza = PLAZAS[txn.plazaId];
  if (!plaza) return null;
  if (acc.annualPass && plaza.annualPass && passStateAt(acc, txn.time) === "active") {
    return { amount: 0, kind: "annual_pass" };
  }
  const prior = tolls(acc).filter((x) => x.plazaId === txn.plazaId && x.id !== txn.id
    && minutes(x.time, txn.time) > RULES.duplicateWindowMin // a read minutes later is a duplicate, not a return trip
    && minutes(x.time, txn.time) <= RULES.returnJourneyHours * 60);
  const isReturn = prior.length > 0 && prior.at(-1).amount === plaza.tariff[acc.vehicleClass];
  const full = plaza.tariff[acc.vehicleClass];
  return isReturn
    ? { amount: plaza.returnTariff[acc.vehicleClass] - full, kind: "return", returnOf: prior.at(-1).id }
    : { amount: full, kind: "single" };
}

/** Tolls charged above this vehicle's tariff, with which class's rate was actually applied. */
export function findOvercharges(acc) {
  return tolls(acc).flatMap((txn) => {
    const exp = expectedTariff(acc, txn);
    // Pass misses are their own issue (findPassMisses), not a wrong vehicle class.
    if (!exp || exp.kind === "annual_pass" || txn.amount <= exp.amount) return [];
    const plaza = PLAZAS[txn.plazaId];
    const chargedAs = Object.entries(plaza.tariff).find(([, v]) => v === txn.amount)?.[0] ?? null;
    return [{ txn, expected: exp.amount, expectedKind: exp.kind, excess: txn.amount - exp.amount, chargedAs }];
  });
}

/** Consecutive toll reads too far apart to be the same vehicle in the time between them. */
export function findImpossibleTravel(acc) {
  const ts = tolls(acc), out = [];
  for (let i = 1; i < ts.length; i++) {
    const a = ts[i - 1], b = ts[i];
    if (a.plazaId === b.plazaId) continue;
    const km = haversineKm(PLAZAS[a.plazaId], PLAZAS[b.plazaId]);
    const hours = Math.max(minutes(a.time, b.time) / 60, 1 / 60);
    const speed = km / hours;
    if (speed > RULES.maxPlausibleSpeedKmh) {
      out.push({ earlier: a, later: b, km: Math.round(km), hours: Math.round(hours * 10) / 10, speedKmh: Math.round(speed) });
    }
  }
  return out;
}

/** The latest recharge that was paid but not credited, and how long it has been stuck. */
export function pendingRecharge(acc, now) {
  const r = acc.transactions.filter((x) => x.type === "recharge" && x.status === "pending")
    .sort((a, b) => Date.parse(b.time) - Date.parse(a.time))[0];
  return r ? { txn: r, ageMin: Math.round(minutes(r.time, now)) } : null;
}

export function pendingTolls(acc) {
  return acc.transactions.filter((x) => x.type === "toll" && x.status === "pending");
}

export function blacklistStatus(acc) {
  if (acc.status !== "blacklisted") return { blacklisted: false };
  const topUp = acc.blacklistReason === "low_balance"
    ? Math.max(0, acc.minBalance - acc.balance) + RULES.topUpBufferInr : 0;
  const declined = acc.transactions.filter((x) => x.type === "toll" && x.status === "failed");
  return { blacklisted: true, reason: acc.blacklistReason, topUp, declined };
}

export const plazaName = (id) => PLAZAS[id]?.name ?? id;
