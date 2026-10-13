// Writes the shared demo data and labelled ticket sets to data/*.json so the Python agent
// and the JS demo use exactly the same accounts, plazas, rules and test messages.
import { mkdirSync, writeFileSync } from "node:fs";
import { ACCOUNTS, DEMO_NOW, PLAZAS } from "../src/data.js";
import { CHANNELS, RULES } from "../src/rules.js";
import { HELD_OUT, HELD_OUT_2, HELD_OUT_3, TICKETS } from "../src/tickets.js";

mkdirSync("data", { recursive: true });
const w = (f, v) => writeFileSync(`data/${f}`, JSON.stringify(v, null, 2) + "\n");
w("plazas.json", PLAZAS);
w("accounts.json", { demoNow: DEMO_NOW, accounts: ACCOUNTS });
w("rules.json", { rules: RULES, channels: CHANNELS });
w("tickets.json", { base: TICKETS, held_out_1: HELD_OUT, held_out_2: HELD_OUT_2, held_out_3: HELD_OUT_3 });
console.log("wrote data/plazas.json, accounts.json, rules.json, tickets.json");
