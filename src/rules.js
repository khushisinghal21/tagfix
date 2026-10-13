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
  // read, and still blacklisted 10 minutes after it, is declined.
  blacklistBeforeReadMin: 60,
  blacklistAfterReadMin: 10,
  // Suggested top-up on top of the minimum balance, so the tag doesn't fall straight back.
  topUpBufferInr: 200,
  // Return journey at the same plaza within this window gets the return tariff.
  returnJourneyHours: 24,
};

// (public) Escalation channels for deductions without crossing a toll, as published by
// NHAI / IHMCL: helpline 1033 and falsededuction@ihmcl.com.
export const CHANNELS = {
  issuerDispute: "Issuer bank dispute (raised by Park+ ops)",
  nhaiHelpline: "NHAI helpline 1033",
  nhaiEmail: "falsededuction@ihmcl.com",
};
