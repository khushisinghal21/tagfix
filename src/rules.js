// Policy constants. Every number a reply or decision depends on lives here, so ops can
// tune them without touching logic. Values marked (public) come from published FASTag
// rules; the rest are conservative product defaults to be set from Park+'s own data.

export const RULES = {
  // Two debits at the same plaza, same amount, this close together = a duplicate read.
  duplicateWindowMin: 30,
  // Faster than this between two plaza reads means one of them can't be this vehicle.
  maxPlausibleSpeedKmh: 150,
  // A recharge paid but not credited: wait this long before treating it as stuck.
  rechargeSettleMin: 30,
  // After this long, stop waiting and start a refund.
  rechargeRefundAfterHours: 24,
  // (public) Since 17 Feb 2025: a tag blacklisted for more than 60 minutes before a toll
  // read, and still blacklisted 10 minutes after it, is declined (reason code 176).
  blacklistBeforeReadMin: 60,
  blacklistAfterReadMin: 10,
  // (public) Since 15 Nov 2025, a vehicle without a valid, working FASTag pays 2x the fee
  // in cash or 1.25x by UPI.
  noTagCashMultiplier: 2,
  noTagUpiMultiplier: 1.25,
  // Suggested top-up on top of the minimum balance, so the tag doesn't fall straight back.
  topUpBufferInr: 200,
  // Return journey at the same plaza within this window gets the return tariff.
  returnJourneyHours: 24,
  // A toll posted this long after the tag was read is "late": the SMS arrives on a
  // different day from the trip and looks like a charge the customer didn't make.
  latePostingMin: 60,
  // (public) FASTag Annual Pass: one year or 200 crossings, whichever comes first.
  // NH and National Expressway plazas only. Round trips at a point-based plaza count as two.
  annualPassTrips: 200,
  annualPassFeeInr: 3075,
  // What to tell customers about dispute timelines. Public reports put bank resolution at
  // 25–30 days; replace with Park+'s measured median.
  disputeExpectation: "These usually take 2 to 4 weeks to resolve",
  disputeExpectationHinglish: "Isme aam taur par 2 se 4 hafte lagte hain",
};

// (public) Escalation channels for deductions without crossing a toll, as published by
// NHAI / IHMCL: helpline 1033 and falsededuction@ihmcl.com. Annual Pass is sold and run
// by NHAI through the Rajmargyatra app.
export const CHANNELS = {
  issuerDispute: "Issuer bank dispute (raised by Park+ ops)",
  nhaiHelpline: "NHAI helpline 1033",
  nhaiEmail: "falsededuction@ihmcl.com",
  annualPass: "NHAI Annual Pass grievance (Rajmargyatra / 1033)",
};
