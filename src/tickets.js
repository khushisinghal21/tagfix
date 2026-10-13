// A labelled set of customer messages across the demo accounts, written the way people
// actually text support: English, Hinglish and Hindi, with typos and missing details.
// `gold` is what a good agent would conclude. Used for tests and the impact view.

export const TICKETS = [
  // Rohan: real duplicate at Kherki Daula
  { account: "rohan", text: "I was charged twice at Kherki Daula this morning, please refund", gold: { intent: "double_deduction", decision: "dispute_filed" } },
  { account: "rohan", text: "bhai toll pe paise do baar kat gaye aaj subah", gold: { intent: "double_deduction", decision: "dispute_filed" } },
  { account: "rohan", text: "आज सुबह टोल पर दो बार पैसे कटे", gold: { intent: "double_deduction", decision: "dispute_filed" } },
  { account: "rohan", text: "duplicate deduction of rs 80 on my fastag", gold: { intent: "double_deduction", decision: "dispute_filed" } },

  // Priya: read at Kherki while the car was on the Mumbai–Pune Expressway
  { account: "priya", text: "Money deducted at Kherki Daula but my car was in Pune, I never went to Gurugram", gold: { intent: "false_deduction", decision: "dispute_filed" } },
  { account: "priya", text: "gurgaon toll se paise kate jabki gaadi pune mein thi, main gayi hi nahi", gold: { intent: "false_deduction", decision: "dispute_filed" } },
  { account: "priya", text: "toll charged without crossing, not my car", gold: { intent: "false_deduction", decision: "dispute_filed" } },

  // Arjun: car charged the truck rate at Panipat
  { account: "arjun", text: "Charged 555 at Panipat for my car, that's the truck rate", gold: { intent: "wrong_amount", decision: "dispute_filed" } },
  { account: "arjun", text: "panipat toll pe zyada paise kaate, car ka itna nahi hota", gold: { intent: "wrong_amount", decision: "dispute_filed" } },
  { account: "arjun", text: "I was overcharged at the toll yesterday", gold: { intent: "wrong_amount", decision: "dispute_filed" } },

  // Neha: UPI recharge paid, not credited, balance below minimum
  { account: "neha", text: "I recharged 500 by UPI but balance not updated", gold: { intent: "recharge_not_reflecting", decision: "escalated" } },
  { account: "neha", text: "recharge kiya 2 ghante pehle, balance abhi bhi nahi aaya", gold: { intent: "recharge_not_reflecting", decision: "escalated" } },
  { account: "neha", text: "रिचार्ज किया पर बैलेंस नहीं आया", gold: { intent: "recharge_not_reflecting", decision: "escalated" } },
  { account: "neha", text: "payment deducted from bank but fastag balance still same", gold: { intent: "recharge_not_reflecting", decision: "escalated" } },

  // Vikram: blacklisted for low balance, declined at Panipat
  { account: "vikram", text: "My fastag is blacklisted, toll declined it today", gold: { intent: "blacklisted", decision: "auto_resolved" } },
  { account: "vikram", text: "toll pe tag nahi chala, kya blacklist ho gaya?", gold: { intent: "blacklisted", decision: "auto_resolved" } },
  { account: "vikram", text: "tag got declined at panipat, what to do", gold: { intent: "blacklisted", decision: "auto_resolved" } },

  // Sana: blacklisted because KYC is pending, balance is fine
  { account: "sana", text: "why is my tag blacklisted? I have 760 balance", gold: { intent: "blacklisted", decision: "auto_resolved" } },
  { account: "sana", text: "balance hai phir bhi blacklist kyun dikha raha hai", gold: { intent: "blacklisted", decision: "auto_resolved" } },

  // Kabir: thinks he was charged twice; it was a correct return-trip fare
  { account: "kabir", text: "charged twice at Kherki today, 80 and then 40", gold: { intent: "double_deduction", decision: "auto_resolved" } },
  { account: "kabir", text: "aaj kherki pe do baar paise kate", gold: { intent: "double_deduction", decision: "auto_resolved" } },

  // Meera: yesterday's toll not in passbook yet
  { account: "meera", text: "yesterday's toll is not showing in my passbook", gold: { intent: "passbook_missing", decision: "auto_resolved" } },
  { account: "meera", text: "kal ka toll statement mein nahi dikh raha", gold: { intent: "passbook_missing", decision: "auto_resolved" } },

  // Cases the copilot should NOT pretend to solve
  { account: "rohan", text: "I want to change the phone number on my account", gold: { intent: "other", decision: "escalated" } },
  { account: "meera", text: "my fastag sticker is damaged, need a new one", gold: { intent: "other", decision: "escalated" } },
  { account: "arjun", text: "money deducted at a toll I never crossed", gold: { intent: "false_deduction", decision: "needs_info" } },
];

// Held out: written after the rules were finished and never used to tune them. Phrased the
// way real reviews and tweets complain, so the score here is the honest one.
export const HELD_OUT = [
  { account: "rohan", text: "same toll deducted 2 times within 2 minutes!!", gold: { intent: "double_deduction", decision: "dispute_filed" } },
  { account: "rohan", text: "Kherki daula ne ek hi trip ka 160 kaata", gold: { intent: "double_deduction", decision: "dispute_filed" } },
  { account: "priya", text: "Got an SMS for toll deduction in Haryana. I am in Maharashtra.", gold: { intent: "false_deduction", decision: "dispute_filed" } },
  { account: "priya", text: "unauthorised toll transaction on my fastag", gold: { intent: "false_deduction", decision: "dispute_filed" } },
  { account: "arjun", text: "panipat charged me like a commercial vehicle", gold: { intent: "wrong_amount", decision: "dispute_filed" } },
  { account: "arjun", text: "why 555 for a hatchback??", gold: { intent: "wrong_amount", decision: "dispute_filed" } },
  { account: "neha", text: "money gone from my account but not added to fastag wallet", gold: { intent: "recharge_not_reflecting", decision: "escalated" } },
  { account: "neha", text: "500 ka recharge fail ho gaya lekin paise kat gaye", gold: { intent: "recharge_not_reflecting", decision: "escalated" } },
  { account: "vikram", text: "boom barrier didn't open, they said my fastag is inactive", gold: { intent: "blacklisted", decision: "auto_resolved" } },
  { account: "sana", text: "tag deactivated even though I have money in it", gold: { intent: "blacklisted", decision: "auto_resolved" } },
  { account: "kabir", text: "two deductions at kherki today, is this correct?", gold: { intent: "double_deduction", decision: "auto_resolved" } },
  { account: "meera", text: "toll paid yesterday but app shows nothing", gold: { intent: "passbook_missing", decision: "auto_resolved" } },
];

// Second held-out set: written after account-signal triage was built (triage was designed
// after seeing HELD_OUT fail, so that score is contaminated). Not used to change any code.
export const HELD_OUT_2 = [
  { account: "rohan", text: "hello? 80 rupees gone twice from my fastag, same plaza same time", gold: { intent: "double_deduction", decision: "dispute_filed" } },
  { account: "rohan", text: "mera fastag se extra kat gaya", gold: { intent: "double_deduction", decision: "dispute_filed" } },
  { account: "priya", text: "I got a message that my tag was used at a plaza I've never been to", gold: { intent: "false_deduction", decision: "dispute_filed" } },
  { account: "priya", text: "kherki daula kaha hai mujhe nahi pata, wahan ka toll kaise kat gaya", gold: { intent: "false_deduction", decision: "dispute_filed" } },
  { account: "arjun", text: "toll amount too high, I drive a small car", gold: { intent: "wrong_amount", decision: "dispute_filed" } },
  { account: "neha", text: "where is my 500 rupees? paid an hour ago", gold: { intent: "recharge_not_reflecting", decision: "escalated" } },
  { account: "neha", text: "UPI successful, fastag balance 35 only", gold: { intent: "recharge_not_reflecting", decision: "escalated" } },
  { account: "vikram", text: "stuck at toll, they asked me to pay cash double", gold: { intent: "blacklisted", decision: "auto_resolved" } },
  { account: "sana", text: "fastag not working since yesterday", gold: { intent: "blacklisted", decision: "auto_resolved" } },
  { account: "kabir", text: "why was I charged again at the same toll on the way back?", gold: { intent: "double_deduction", decision: "auto_resolved" } },
  { account: "meera", text: "SMS aaya 140 kata, passbook mein entry nahi hai", gold: { intent: "passbook_missing", decision: "auto_resolved" } },
  { account: "kabir", text: "please update the address on my fastag account", gold: { intent: "other", decision: "escalated" } },
];
