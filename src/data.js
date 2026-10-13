// Demo data. Plaza names and locations are real toll plazas so distances are realistic;
// tariffs, accounts and transactions are made up for the prototype.
// tariff = single journey; returnTariff = round trip within 24h. On a return leg the tag
// is charged returnTariff minus the single fare already paid.
// annualPass = whether NHAI's FASTag Annual Pass applies. It covers National Highway and
// National Expressway plazas only; state expressways and state highways charge as normal.

export const PLAZAS = {
  KHERKI: { id: "KHERKI", operator: "NHAI", annualPass: true, name: "Kherki Daula, NH-48 (Gurugram)", lat: 28.3946, lon: 76.9813,
    tariff: { car: 80, lcv: 130, truck: 270 }, returnTariff: { car: 120, lcv: 195, truck: 405 } },
  SHAHJ: { id: "SHAHJ", operator: "NHAI", annualPass: true, name: "Shahjahanpur, NH-48 (Rajasthan)", lat: 27.9996, lon: 76.4295,
    tariff: { car: 140, lcv: 225, truck: 470 }, returnTariff: { car: 210, lcv: 340, truck: 705 } },
  PANIPAT: { id: "PANIPAT", operator: "NHAI", annualPass: true, name: "Panipat, NH-44 (Haryana)", lat: 29.3909, lon: 76.9635,
    tariff: { car: 165, lcv: 265, truck: 555 }, returnTariff: { car: 250, lcv: 400, truck: 830 } },
  KHALAPUR: { id: "KHALAPUR", operator: "MSRDC (state)", annualPass: false, name: "Khalapur, Mumbai–Pune Expressway", lat: 18.8327, lon: 73.2862,
    tariff: { car: 320, lcv: 495, truck: 940 }, returnTariff: { car: 480, lcv: 745, truck: 1410 } },
};

// "Now" for the demo, so every relative time in the scenarios is stable.
export const DEMO_NOW = "2026-10-13T12:00:00+05:30";

const t = (iso) => `2026-10-${iso}+05:30`;

export const ACCOUNTS = {
  rohan: {
    key: "rohan", owner: "Rohan", vehicleNo: "HR26 DK 4417", vehicleClass: "car",
    tagId: "TAG-7781", balance: 640, minBalance: 100, status: "active", kyc: "full",
    persona: "Charged twice at Kherki Daula this morning",
    transactions: [
      { id: "TX-1001", type: "recharge", time: t("11T19:02:00"), amount: 1000, status: "success" },
      { id: "TX-1002", type: "toll", time: t("10T18:40:00"), amount: 80, plazaId: "KHERKI", status: "success" },
      { id: "TX-1003", type: "toll", time: t("13T09:14:00"), amount: 80, plazaId: "KHERKI", status: "success" },
      { id: "TX-1004", type: "toll", time: t("13T09:16:00"), amount: 80, plazaId: "KHERKI", status: "success" },
    ],
  },
  priya: {
    key: "priya", owner: "Priya", vehicleNo: "MH12 PQ 2290", vehicleClass: "car",
    tagId: "TAG-5512", balance: 410, minBalance: 100, status: "active", kyc: "full",
    persona: "Deducted at a Delhi-area toll while the car was in Pune",
    transactions: [
      { id: "TX-2001", type: "recharge", time: t("10T10:00:00"), amount: 1000, status: "success" },
      { id: "TX-2002", type: "toll", time: t("12T07:45:00"), amount: 320, plazaId: "KHALAPUR", status: "success" },
      { id: "TX-2003", type: "toll", time: t("12T10:05:00"), amount: 270, plazaId: "KHERKI", status: "success" },
    ],
  },
  arjun: {
    key: "arjun", owner: "Arjun", vehicleNo: "DL8C AB 1043", vehicleClass: "car",
    tagId: "TAG-3308", balance: 520, minBalance: 100, status: "active", kyc: "full",
    persona: "Charged a truck rate at Panipat",
    transactions: [
      { id: "TX-3001", type: "recharge", time: t("09T09:30:00"), amount: 1500, status: "success" },
      { id: "TX-3002", type: "toll", time: t("12T16:20:00"), amount: 555, plazaId: "PANIPAT", status: "success" },
      { id: "TX-3003", type: "toll", time: t("13T08:10:00"), amount: 80, plazaId: "KHERKI", status: "success" },
    ],
  },
  neha: {
    key: "neha", owner: "Neha", vehicleNo: "RJ14 CF 7731", vehicleClass: "car",
    tagId: "TAG-9120", balance: 35, minBalance: 100, status: "active", kyc: "full",
    persona: "Paid ₹500 by UPI two hours ago, balance still ₹35",
    transactions: [
      { id: "TX-4001", type: "toll", time: t("12T20:15:00"), amount: 140, plazaId: "SHAHJ", status: "success" },
      { id: "TX-4002", type: "recharge", time: t("13T09:55:00"), amount: 500, status: "pending", paymentRef: "UPI-88213409" },
    ],
  },
  vikram: {
    key: "vikram", owner: "Vikram", vehicleNo: "HR55 AL 9086", vehicleClass: "car",
    tagId: "TAG-6644", balance: 40, minBalance: 100, status: "blacklisted", blacklistReason: "low_balance", kyc: "full",
    persona: "Tag blacklisted, declined at the toll",
    transactions: [
      { id: "TX-5001", type: "toll", time: t("12T21:30:00"), amount: 80, plazaId: "KHERKI", status: "success" },
      { id: "TX-5002", type: "toll", time: t("13T08:40:00"), amount: 165, plazaId: "PANIPAT", status: "failed", failureCode: "176" },
    ],
  },
  sana: {
    key: "sana", owner: "Sana", vehicleNo: "UP16 BX 3321", vehicleClass: "car",
    tagId: "TAG-2287", balance: 760, minBalance: 100, status: "blacklisted", blacklistReason: "kyc_pending", kyc: "pending",
    persona: "Tag blacklisted though balance is fine (KYC pending)",
    transactions: [
      { id: "TX-6001", type: "recharge", time: t("08T12:00:00"), amount: 1000, status: "success" },
      { id: "TX-6002", type: "toll", time: t("11T17:45:00"), amount: 80, plazaId: "KHERKI", status: "success" },
    ],
  },
  kabir: {
    key: "kabir", owner: "Kabir", vehicleNo: "HR26 EZ 5502", vehicleClass: "car",
    tagId: "TAG-4410", balance: 900, minBalance: 100, status: "active", kyc: "full",
    persona: "Says he was charged twice, but it was a return trip",
    transactions: [
      { id: "TX-7001", type: "recharge", time: t("10T08:00:00"), amount: 1200, status: "success" },
      { id: "TX-7002", type: "toll", time: t("13T08:05:00"), amount: 80, plazaId: "KHERKI", status: "success" },
      { id: "TX-7003", type: "toll", time: t("13T10:30:00"), amount: 40, plazaId: "KHERKI", status: "success" },
    ],
  },
  meera: {
    key: "meera", owner: "Meera", vehicleNo: "DL3C QR 6610", vehicleClass: "car",
    tagId: "TAG-1199", balance: 590, minBalance: 100, status: "active", kyc: "full",
    persona: "Yesterday's toll not in passbook yet",
    transactions: [
      { id: "TX-8001", type: "recharge", time: t("09T11:00:00"), amount: 800, status: "success" },
      { id: "TX-8002", type: "toll", time: t("12T19:20:00"), amount: 140, plazaId: "SHAHJ", status: "pending" },
    ],
  },

  // Annual Pass holder charged at a covered NH plaza while the pass was active.
  dev: {
    key: "dev", owner: "Dev", vehicleNo: "RJ14 KX 2208", vehicleClass: "car",
    tagId: "TAG-8834", balance: 460, minBalance: 100, status: "active", kyc: "full",
    annualPass: { activatedAt: "2026-08-20T11:05:00+05:30", expiresAt: "2027-08-20T11:05:00+05:30", tripLimit: 200, tripsUsed: 37, exhaustedAt: null },
    persona: "Has the Annual Pass, still charged at an NH plaza",
    transactions: [
      { id: "TX-9001", type: "recharge", time: t("01T10:00:00"), amount: 600, status: "success" },
      { id: "TX-9002", type: "toll", time: t("12T18:10:00"), amount: 0, plazaId: "KHERKI", status: "success", passTrip: true },
      { id: "TX-9003", type: "toll", time: t("13T07:30:00"), amount: 140, plazaId: "SHAHJ", status: "success" },
    ],
  },
  // Annual Pass holder charged on a state expressway, which the pass doesn't cover.
  aditi: {
    key: "aditi", owner: "Aditi", vehicleNo: "MH14 GT 6619", vehicleClass: "car",
    tagId: "TAG-4471", balance: 880, minBalance: 100, status: "active", kyc: "full",
    annualPass: { activatedAt: "2026-03-02T09:00:00+05:30", expiresAt: "2027-03-02T09:00:00+05:30", tripLimit: 200, tripsUsed: 64, exhaustedAt: null },
    persona: "Annual Pass active, charged on the Mumbai–Pune Expressway",
    transactions: [
      { id: "TX-9101", type: "recharge", time: t("05T12:00:00"), amount: 1200, status: "success" },
      { id: "TX-9102", type: "toll", time: t("11T08:00:00"), amount: 0, plazaId: "KHERKI", status: "success", passTrip: true },
      { id: "TX-9103", type: "toll", time: t("12T18:00:00"), amount: 320, plazaId: "KHALAPUR", status: "success" },
    ],
  },
  // Annual Pass used up (200 trips) two days ago; the tag is back to normal charging.
  farhan: {
    key: "farhan", owner: "Farhan", vehicleNo: "HR29 AC 7710", vehicleClass: "car",
    tagId: "TAG-3392", balance: 1140, minBalance: 100, status: "active", kyc: "full",
    annualPass: { activatedAt: "2025-10-20T10:00:00+05:30", expiresAt: "2026-10-20T10:00:00+05:30", tripLimit: 200, tripsUsed: 200, exhaustedAt: t("11T19:05:00") },
    persona: "Annual Pass trips ran out; now being charged",
    transactions: [
      { id: "TX-9201", type: "toll", time: t("11T08:20:00"), amount: 0, plazaId: "KHERKI", status: "success", passTrip: true },
      { id: "TX-9202", type: "toll", time: t("11T19:05:00"), amount: 0, plazaId: "KHERKI", status: "success", passTrip: true },
      { id: "TX-9203", type: "toll", time: t("12T09:10:00"), amount: 80, plazaId: "KHERKI", status: "success" },
    ],
  },
  // Paid at the booth by UPI because the tag didn't read, then the tag was debited too.
  // The booth payment isn't visible in the FASTag account.
  isha: {
    key: "isha", owner: "Isha", vehicleNo: "DL4C NB 3307", vehicleClass: "car",
    tagId: "TAG-5560", balance: 335, minBalance: 100, status: "active", kyc: "full",
    persona: "Paid at the booth, then the tag was debited too",
    transactions: [
      { id: "TX-9301", type: "recharge", time: t("07T15:00:00"), amount: 500, status: "success" },
      { id: "TX-9302", type: "toll", time: t("13T09:40:00"), postedTime: t("13T09:52:00"), amount: 165, plazaId: "PANIPAT", status: "success" },
    ],
  },
  // A toll read on 10 Oct that the plaza only posted this morning.
  tanvi: {
    key: "tanvi", owner: "Tanvi", vehicleNo: "HR26 FB 1180", vehicleClass: "car",
    tagId: "TAG-6205", balance: 470, minBalance: 100, status: "active", kyc: "full",
    persona: "SMS today for a toll read three days ago",
    transactions: [
      { id: "TX-9401", type: "recharge", time: t("06T10:00:00"), amount: 550, status: "success" },
      { id: "TX-9402", type: "toll", time: t("10T18:40:00"), postedTime: t("13T08:02:00"), amount: 80, plazaId: "KHERKI", status: "success" },
    ],
  },
};
