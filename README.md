# TagFix

A FASTag support agent for Park+: it reads a customer's complaint (English, Hinglish or Hindi), checks their own transactions, takes one evidence-backed action, and replies.

This repo has two parts:

| | What | Run |
|---|---|---|
| **[`agent/`](agent/README.md)** | **The POC.** LangGraph + Gemini agent with deterministic check tools, guarded actions, a reply guard, a FastAPI service with a trace console, Docker, and 40 tests including guardrail red-teaming. | `cd agent && pip install -r requirements.txt && uvicorn tagfix_agent.service:app` |
| `src/`, `web/` | The rules engine and a static demo page (no LLM) used to design the checks and build the labelled test sets. | `npm test && npm run build` |

`data/` holds the shared accounts, plazas, rules and the 90 labelled test messages (`npm run export-data` regenerates it from `src/`).

---

## Design notes from the rules engine

Nearly half of Park+'s FASTag help-centre articles (19 of 43) are about a single transaction: charged twice, wrong amount, charged without crossing, recharge not credited, blacklisted, passbook missing. App reviews describe the support for these as "copy-paste". And since NHAI's Annual Pass launched (77 lakh+ passes by July 2026, about a third of car toll transactions), there's a new one: "charged even though I have the pass".

TagFix answers from the customer's own transactions, then does one of four things:

| Decision | When | Example |
|---|---|---|
| Resolved in chat | The account explains the charge | ₹320 at Khalapur isn't covered by the Annual Pass: it's a state (MSRDC) expressway |
| Dispute filed with evidence | The account proves an error | ₹140 at an NHAI plaza while the pass was active → NHAI pass grievance, transaction attached |
| Asked for one detail | One fact is missing | Paid at the booth too? Send the receipt and the tag charge is disputed |
| Handed to an agent | Anything it isn't sure about | Recent transactions attached, so the customer doesn't repeat themselves |

**Live demo:** `dist/tagfix.html` (one self-contained file). Tabs: Try it, Scorecard, Product case, How it works. Screenshots in `docs/`.

## What it handles

| Issue | Checks | Outcomes |
|---|---|---|
| Charged twice | Same plaza + amount within 30 min; return-trip fare (round trip minus single) | Dispute duplicate / explain return fare |
| Charged without crossing | Impossible travel between plazas (haversine vs 150 km/h); read time vs posted time | Dispute with both reads / confirm the trip for late-posted tolls |
| Wrong amount | Tariff by vehicle class; which class's rate was applied | Dispute the excess |
| Annual Pass | Pass active at read time; plaza covered (NH/NE only); trips used; expiry | Dispute to NHAI / explain coverage / explain used-up pass (round trip = 2 trips) + renewal |
| Paid at booth and tag | Recent tag debit at that plaza | Ask for receipt, then dispute |
| Recharge not credited | Pending recharge age vs settlement window | Recheck / priority credit / refund after 24h |
| Blacklisted | Reason (low balance or KYC), declined reads (code 176) | Top-up link with amount / KYC link; current booth penalty (2x cash, 1.25x UPI) |
| Passbook missing | Pending toll reads | Explain, recheck |
| Anything else (car wash, challan, parking, delivery, profile changes) | — | Agent |

## How it works

1. **Read the message.** Keyword rules for English, Hinglish and Hindi (`src/intents.js`). Optionally Gemini (`src/llm.js`); its answer must be one of the known issues, or it's ignored.
2. **Check the claim against the account.** Plain code decides what's true (`src/checks.js`). If the message is vague, or the customer's claim doesn't check out but the passbook shows exactly one other problem, TagFix answers that and says so in the reply (`src/triage.js`). Non-FASTag topics are never pulled in.
3. **Act and reply** (`src/resolver.js`). Replies are built from checked facts, so every amount and ID traces to a transaction. Disputes say they usually take 2–4 weeks. An LLM rewrite is thrown away if it drops or changes any amount, time, UPI reference or transaction ID.

All policy numbers live in `src/rules.js`, each marked public rule or product default.

## Results

`npm run metrics` prints today's numbers. The table below is the first run on each set, which is the only fair one: after each run I fixed what failed, so re-running a set afterwards measures nothing.

| Set | Messages | Written | First run (issue / decision / no agent) |
|---|---|---|---|
| Held-out 1 | 12 | After the keyword rules | Keyword rules alone: 8% / 25% / 8% |
| Held-out 2 | 12 | After account triage | 83% / 83% / 58% |
| **Held-out 3** | **40** | **Committed before any v2 code** (`60dc86b`) | Before v2: 53% / 55%. **After v2: 93% / 93% / 73%** |

- **Wrong actions: 0.** Across all 90 messages, no wrong refund and no wrong "your charge is correct". Every miss went to an agent. This is the number I care about most.
- Held-out 3's three misses (one pass phrasing, two late-posted tolls) were fixed after the run.
- Held-out 2 found a real bug: a duplicate read 2 minutes after the first was priced as a discounted return trip, which would have disputed ₹40 instead of ₹80.
- **Caveat:** I wrote both the rules and every test message. The fair test is a few hundred of Park+'s real tickets in shadow mode (see Product case).

## What's real and what isn't

- Plaza names, coordinates and operators are real, so distances and Annual Pass coverage are real. Tariffs, accounts and transactions are made up.
- Public rules encoded:
  - NPCI blacklist timing (Feb 2025): a tag blacklisted more than 60 min before a read and still blacklisted 10 min after is declined, code 176.
  - No valid FASTag (since 15 Nov 2025): 2x the fee in cash, 1.25x by UPI.
  - Annual Pass: 200 trips or one year, NH/NE plazas only, round trip at a point-based plaza = 2 trips, ₹3,075 for 2026–27.
  - Wrong-deduction channels: NHAI 1033 and falsededuction@ihmcl.com.
- Product defaults to replace with Park+ data: dispute timeline (2–4 weeks, from user reports of 25–30 days), recharge settlement window, late-posting threshold.
- The LLM layer is unit-tested with a mocked model only. The published demo runs without it. Built-in replies are English and Hinglish; Devanagari replies need the LLM layer.

## Run it

```bash
npm install
npm test          # 36 tests, node:test
npm run metrics   # scorecard
npm run build     # dist/tagfix.html
```

Node 22, no runtime dependencies. esbuild is the only dev dependency.

## Sources

- Park+ help centre, FASTag section: https://parkplus.freshdesk.com/support/solutions
- Park+ App Store reviews: https://apps.apple.com/in/app/park-rto-parivahan-fastag/id1244749178
- IHMCL Annual Pass FAQ: https://ihmcl.co.in/wp-content/uploads/2025/08/FAQ-Annual-Pass_12.08.25.pdf
- 77 lakh Annual Passes, ~33% of car ETC transactions: https://www.nbmcw.com/news/roads-highways/over-77-lakh-fastag-annual-passes-issued-nhai-expands-barrier-free-tolling.html
- Annual Pass fee ₹3,075 for FY 2026–27: https://www.newsonair.gov.in/nhai-revises-fastag-annual-pass-fee-to-%E2%82%B93075-for-fy-2026-27
- 2x cash / 1.25x UPI from 15 Nov 2025: https://www.tribuneindia.com/news/business/new-user-fee-collection-rule-to-come-into-effect-from-november-15-to-incentivize-digital-payments-at-toll-plazas-for-non-fastag-users
- NPCI blacklist timing rules: https://www.business-standard.com/finance/personal-finance/npci-s-new-fastag-rules-take-effect-from-today-what-should-users-do-125021700310_1.html
- Wrong-deduction refund experiences: https://www.team-bhp.com/forum/street-experiences/258260-fastag-money-deducted-when-car-parked-home.html
- KYV discontinued for cars from 1 Feb 2026: https://ianslive.in/kyv-discontinued-for-cars-on-new-fastag-issued-after-feb-1-nhai--20260101171828

Independent prototype by Khushi Singhal. Not affiliated with or endorsed by any FASTag issuer or app.
