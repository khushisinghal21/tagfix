# TagFix

A FASTag support copilot that checks the customer's passbook before it replies.

Most FASTag complaints are one of six things: charged twice, charged at a toll the car never crossed, wrong amount (usually the wrong vehicle class), a recharge that didn't credit, a blacklisted tag, or a toll missing from the passbook. A first-line agent answers most of these by looking at the same three or four transactions. TagFix does that check in code, then does one of four things:

| Decision | When | Example |
|---|---|---|
| Resolved in chat | The account explains it | Second ₹40 at the same plaza is a return-trip fare, not a duplicate |
| Dispute filed with evidence | The account proves an error | ₹80 read twice, 2 minutes apart → dispute on TX-1004, both reads attached |
| Asked for one detail | It can't tell which charge | "Which of these did you mean?" |
| Handed to an agent | Anything it isn't sure about | With the recent transactions attached, so the customer doesn't repeat themselves |

**Live demo:** published as a single HTML page (`dist/tagfix.html`). Screenshots in `docs/`.

## How it works

1. **Read the message.** Keyword rules for English, Hinglish and Hindi (`src/intents.js`). Optionally Gemini (`src/llm.js`); its answer must be one of the known issues, or it's ignored.
2. **Look at the account.** If the message is vague but about money, and the passbook shows exactly one problem, use that, and tell the customer it was a guess (`src/triage.js`).
3. **Check the facts.** Plain code decides what's true (`src/checks.js`): duplicate reads, tariff by vehicle class, return-journey fares, impossible travel between plazas (haversine distance vs a 150 km/h limit), stuck recharges, blacklist reason and top-up needed.
4. **Act and reply** (`src/resolver.js`). The reply is assembled from the checked facts, so every amount and ID traces to a transaction. If the LLM rewrites the reply, the rewrite is thrown away when it drops or changes any amount, time, UPI reference or transaction ID.

## Results

Run `npm run metrics`.

| Set | Messages | Mode | Issue correct | Decision correct | No agent needed |
|---|---|---|---|---|---|
| Base | 26 | rules + triage | 100% | 100% | 77% |
| Held-out 1 | 12 | keyword rules only | 8% | 25% | 8% |
| Held-out 1 | 12 | rules + triage | 100%* | 100%* | 83% |
| **Held-out 2** | 12 | keyword rules only | 33% | 50% | 25% |
| **Held-out 2** | 12 | **rules + triage** | **83%** | **83%** | **58%** |

\* Triage was designed after seeing the Held-out 1 failures, so that score isn't a fair test. Held-out 2 was written afterwards and nothing was tuned to it.

Across all 50 messages, every miss was handed to an agent. None produced a wrong dispute or a wrong answer.

Held-out 2 also found a real bug: a duplicate read 2 minutes after the first was being priced as a discounted return trip, which would have disputed ₹40 instead of ₹80. Fixed in `expectedTariff`, with a test.

## What's real and what isn't

- Plaza names and coordinates are real, so distances are real. Tariffs, accounts and transactions are made up.
- Rules encoded from public sources: NPCI's Feb 2025 blacklist timing rule (blacklisted >60 min before a read and still blacklisted 10 min after → declined, code 176), and NHAI's 1033 helpline / falsededuction@ihmcl.com for deductions without crossing.
- The LLM layer is unit-tested with a mocked model only. It has not been run on live traffic, and the published demo runs without it.
- Built-in replies are English and Hinglish; Devanagari replies need the LLM layer.

## Run it

```bash
npm install
npm test          # 22 tests, node:test
npm run metrics   # scorecard above
npm run build     # dist/tagfix.html, one self-contained file
```

Node 22, no runtime dependencies. esbuild is the only dev dependency.

Independent prototype by Khushi Singhal. Not affiliated with or endorsed by any FASTag issuer or app.
