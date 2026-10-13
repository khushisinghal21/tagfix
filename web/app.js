// TagFix demo UI. Runs the same engine as the tests, entirely in the browser.
import { ACCOUNTS, DEMO_NOW, PLAZAS } from "../src/data.js";
import { resolve } from "../src/resolver.js";
import { runAll, summarise } from "../src/metrics.js";
import { HELD_OUT, HELD_OUT_2, TICKETS } from "../src/tickets.js";
import { RULES, CHANNELS } from "../src/rules.js";

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const inr = (n) => `₹${Number(n).toLocaleString("en-IN")}`;
const hhmm = (iso) => iso.slice(11, 16);
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const day = (iso) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`;

const DECISION_STYLE = {
  auto_resolved: { cls: "ok", label: "Resolved in chat" },
  dispute_filed: { cls: "accent", label: "Dispute filed with evidence" },
  needs_info: { cls: "warn", label: "Asked for one detail" },
  escalated: { cls: "muted", label: "Handed to an agent" },
};
const INTENT_LABEL = {
  double_deduction: "Charged twice", false_deduction: "Charged without crossing", wrong_amount: "Wrong amount",
  recharge_not_reflecting: "Recharge not credited", blacklisted: "Tag blacklisted", passbook_missing: "Missing from passbook",
  other: "Not a transaction issue",
};
const UNDERSTOOD = {
  rules: "Read from the message",
  account_signal: "Message was vague, so matched to the one issue the account shows",
  llm: "Read by the LLM",
};
const LANG = { en: "English", hinglish: "Hinglish", hi: "Hindi" };

let state = { account: "rohan", text: "", result: null, replyLang: null };

// ---------- account panel ----------
function plate(no) {
  return `<span class="plate" aria-label="Vehicle number ${esc(no)}"><span class="plate-ind">IND</span><span class="plate-no">${esc(no)}</span></span>`;
}

function txnRow(x, cited) {
  const isToll = x.type === "toll";
  const where = isToll ? PLAZAS[x.plazaId]?.name ?? x.plazaId : `Recharge${x.paymentRef ? ` · ${x.paymentRef}` : ""}`;
  const statusCls = { success: "", pending: "warn", failed: "bad" }[x.status];
  const sign = isToll ? "−" : "+";
  return `<li class="txn ${cited.has(x.id) ? "cited" : ""}" data-txn="${x.id}">
    <span class="txn-id mono">${x.id}</span>
    <span class="txn-when mono">${day(x.time)} ${hhmm(x.time)}</span>
    <span class="txn-where">${esc(where)}${x.failureCode ? ` <span class="mono small">code ${x.failureCode}</span>` : ""}</span>
    <span class="txn-amt mono ${isToll ? "" : "credit"}">${sign}${inr(x.amount)}</span>
    ${x.status !== "success" ? `<span class="pill ${statusCls}">${x.status}</span>` : `<span></span>`}
  </li>`;
}

function renderAccounts() {
  $("#account-list").innerHTML = Object.values(ACCOUNTS).map((a) => `
    <button class="acct ${a.key === state.account ? "on" : ""}" data-acct="${a.key}" type="button" aria-pressed="${a.key === state.account}">
      <span class="acct-name">${esc(a.owner)}</span>
      <span class="acct-persona">${esc(a.persona)}</span>
    </button>`).join("");
}

function renderAccountCard() {
  const a = ACCOUNTS[state.account];
  const cited = new Set((state.result?.facts ?? []).flatMap((f) => f.evidence ?? []));
  const statusPill = a.status === "blacklisted"
    ? `<span class="pill bad">Blacklisted · ${a.blacklistReason === "low_balance" ? "low balance" : "KYC pending"}</span>`
    : `<span class="pill ok">Active</span>`;
  const low = a.balance < a.minBalance;
  $("#account-card").innerHTML = `
    <div class="card-head">
      ${plate(a.vehicleNo)}
      <span class="mono small muted">${a.tagId} · ${a.vehicleClass}</span>
    </div>
    <dl class="kv">
      <div><dt>Balance</dt><dd class="mono ${low ? "bad-text" : ""}">${inr(a.balance)}</dd></div>
      <div><dt>Minimum</dt><dd class="mono">${inr(a.minBalance)}</dd></div>
      <div><dt>Tag</dt><dd>${statusPill}</dd></div>
      <div><dt>KYC</dt><dd>${a.kyc === "full" ? "Full" : `<span class="pill warn">Pending</span>`}</dd></div>
    </dl>
    <h3 class="eyebrow">Passbook <span class="muted">· now is ${day(DEMO_NOW)} ${hhmm(DEMO_NOW)}</span></h3>
    <ol class="txns">${[...a.transactions].sort((x, y) => Date.parse(y.time) - Date.parse(x.time)).map((x) => txnRow(x, cited)).join("")}</ol>
    <p class="small muted">Highlighted rows are the transactions the copilot cited.</p>`;
}

// ---------- conversation ----------
function examplesFor(key) {
  const seen = new Set();
  return [...TICKETS, ...HELD_OUT, ...HELD_OUT_2]
    .filter((t) => t.account === key && !seen.has(t.text) && seen.add(t.text))
    .slice(0, 6);
}

function renderExamples() {
  $("#examples").innerHTML = examplesFor(state.account)
    .map((t) => `<button class="chip" type="button" data-example="${esc(t.text)}">${esc(t.text)}</button>`).join("");
}

function actionLine(a) {
  switch (a.type) {
    case "dispute": return `File a dispute on <b class="mono">${a.txnId}</b> for <b>${inr(a.amount)}</b> via ${esc(a.channel)}. Reason: ${esc(a.reason.replaceAll("_", " "))}. Evidence: ${a.evidence.map((e) => `<span class="mono">${e}</span>`).join(", ")}.`;
    case "ask": return `Ask the customer which transaction they mean: ${a.options.map((o) => `<span class="mono">${o}</span>`).join(", ")}.`;
    case "recheck": return `Re-check <b class="mono">${a.txnId}</b>${a.afterMin ? ` in ${a.afterMin} minutes` : ""} and update the customer automatically.`;
    case "refund": return `Refund <b>${inr(a.amount)}</b> to the source account for <span class="mono">${a.paymentRef}</span>.`;
    case "priority_ticket": return `Open a <b>${a.priority}</b>-priority ticket in the issuer credit queue for <span class="mono">${a.txnId}</span> (${inr(a.amount)}, ${a.paymentRef}).`;
    case "recharge_link": return `Send a recharge link for <b>${inr(a.amount)}</b>.`;
    case "kyc_link": return `Send the KYC completion link.`;
    case "handoff": return `Hand to an agent with ${a.recent.map((r) => `<span class="mono">${r}</span>`).join(", ")} attached, so the customer doesn't repeat themselves.`;
    default: return esc(JSON.stringify(a));
  }
}

function renderResult() {
  const r = state.result, out = $("#result");
  if (!r) { out.innerHTML = ""; return; }
  const lang = state.replyLang ?? (r.language === "en" ? "en" : "hinglish");
  const d = DECISION_STYLE[r.decision];
  out.innerHTML = `
    <div class="bubble customer"><span class="who">${esc(ACCOUNTS[state.account].owner)}</span>${esc(state.text)}</div>
    <div class="bubble bot">
      <div class="bot-head">
        <span class="who">TagFix</span>
        <div class="seg" role="group" aria-label="Reply language">
          <button type="button" data-lang="en" aria-pressed="${lang === "en"}">English</button>
          <button type="button" data-lang="hinglish" aria-pressed="${lang === "hinglish"}">Hinglish</button>
        </div>
      </div>
      <p>${esc(r.replies[lang])}</p>
    </div>
    <section class="why" aria-label="How the copilot decided">
      <div class="why-top">
        <span class="decision ${d.cls}">${d.label}</span>
        <span class="small muted">Issue: <b>${INTENT_LABEL[r.intent]}</b> · ${UNDERSTOOD[r.understoodBy] ?? r.understoodBy} · customer wrote in ${LANG[r.language]}</span>
      </div>
      <h3 class="eyebrow">Facts checked on the account</h3>
      <ul class="facts">${r.facts.map((f) => `<li>${esc(f.text)}${f.evidence?.length ? `<span class="ev">${f.evidence.map((e) => `<span class="tx mono" data-hl="${e}">${e}</span>`).join("")}</span>` : ""}</li>`).join("")}</ul>
      <h3 class="eyebrow">What happens next</h3>
      <ul class="actions">${r.actions.length ? r.actions.map((a) => `<li>${actionLine(a)}</li>`).join("") : `<li>Nothing to file. The reply explains the charge.</li>`}</ul>
      ${r.language === "hi" ? `<p class="small muted">The customer wrote in Devanagari. The built-in replies are English and Hinglish; with an LLM key the reply is rewritten in Hindi, and any rewrite that changes an amount, time or ID is thrown away.</p>` : ""}
    </section>`;
}

function run(text) {
  state.text = text.trim();
  if (!state.text) return;
  state.result = resolve(state.text, ACCOUNTS[state.account], { now: DEMO_NOW });
  state.replyLang = null;
  renderResult();
  renderAccountCard();
}

function pickAccount(key) {
  state.account = key;
  renderAccounts();
  renderExamples();
  const first = examplesFor(key)[0]?.text ?? "";
  $("#msg").value = first;
  run(first);
}

// ---------- scorecard ----------
const SETS = [
  { key: "base", name: "Base set", n: TICKETS, note: "Written alongside the rules. Shows the engine works end to end; says little about new phrasing." },
  { key: "ho1", name: "Held-out 1", n: HELD_OUT, note: "Written after the keyword rules and never used to tune them. Keyword rules alone got 1 of 12. Account triage was designed after seeing these misses, so its score here is not a fair test." },
  { key: "ho2", name: "Held-out 2", n: HELD_OUT_2, note: "Written after triage was built. No code was tuned to it. This is the honest number." },
];

function bar(pct, cls = "") {
  return `<span class="bar ${cls}" role="img" aria-label="${pct}%"><span style="width:${pct}%"></span></span><span class="mono pct">${pct}%</span>`;
}

function renderScorecard() {
  const rows = SETS.map((s) => {
    const rules = summarise(runAll(s.n, { noTriage: true }));
    const full = summarise(runAll(s.n));
    return { ...s, rules, full, all: runAll(s.n) };
  });
  const ho2 = rows.at(-1);
  const wrongDisputes = rows.flatMap((r) => r.all).filter((x) => !x.decisionOk && x.result.decision !== "escalated").length;
  $("#score-summary").innerHTML = `
    <div class="stat"><span class="stat-n mono">${ho2.rules.intentAccuracy}% → ${ho2.full.intentAccuracy}%</span><span class="stat-l">Issue identified correctly on unseen messages, keyword rules alone vs with account triage</span></div>
    <div class="stat"><span class="stat-n mono">${ho2.full.handledWithoutAgentPct}%</span><span class="stat-l">of unseen messages closed without an agent (resolved, disputed or one question asked)</span></div>
    <div class="stat"><span class="stat-n mono">${wrongDisputes}</span><span class="stat-l">wrong disputes or wrong answers across all ${rows.reduce((n, r) => n + r.n.length, 0)} test messages. Every miss went to an agent.</span></div>`;
  $("#score-table").innerHTML = `
    <table>
      <thead><tr><th scope="col">Set</th><th scope="col">Mode</th><th scope="col">Issue correct</th><th scope="col">Decision correct</th><th scope="col">No agent needed</th><th scope="col">Disputes w/ evidence</th></tr></thead>
      <tbody>${rows.map((r) => `
        <tr class="set-first"><th scope="row" rowspan="2">${r.name}<span class="small muted block">${r.n.length} messages</span></th>
          <td>Keyword rules</td><td>${bar(r.rules.intentAccuracy, "dim")}</td><td>${bar(r.rules.decisionAccuracy, "dim")}</td><td>${bar(r.rules.handledWithoutAgentPct, "dim")}</td><td class="mono">${r.rules.disputesWithEvidence}</td></tr>
        <tr><td>+ account triage</td><td>${bar(r.full.intentAccuracy)}</td><td>${bar(r.full.decisionAccuracy)}</td><td>${bar(r.full.handledWithoutAgentPct)}</td><td class="mono">${r.full.disputesWithEvidence}</td></tr>`).join("")}
      </tbody>
    </table>`;
  $("#score-notes").innerHTML = rows.map((r) => `<li><b>${r.name}.</b> ${r.note}</li>`).join("");
  $("#score-misses").innerHTML = ho2.full.misses.map((m) => `
    <li><q>${esc(m.text)}</q><span class="small muted block">Expected ${INTENT_LABEL[m.expected.intent]} → got ${INTENT_LABEL[m.got.intent]}, ${DECISION_STYLE[m.got.decision].label.toLowerCase()}.</span></li>`).join("")
    || "<li>None.</li>";
}

// ---------- rules panel ----------
function renderRules() {
  $("#rule-values").innerHTML = `
    <li>Duplicate read: same plaza, same amount within <b class="mono">${RULES.duplicateWindowMin} min</b>.</li>
    <li>Impossible travel: two plazas that would need more than <b class="mono">${RULES.maxPlausibleSpeedKmh} km/h</b> between reads (straight-line distance).</li>
    <li>Return journey: second crossing within <b class="mono">${RULES.returnJourneyHours} h</b> pays round-trip fare minus the single fare.</li>
    <li>Recharge: escalate if not credited after <b class="mono">${RULES.rechargeSettleMin} min</b>.</li>
    <li>Blacklist: a tag blacklisted more than <b class="mono">${RULES.blacklistBeforeReadMin} min</b> before a read and still blacklisted <b class="mono">${RULES.blacklistAfterReadMin} min</b> after is declined (code 176), per NPCI's Feb 2025 rule.</li>
    <li>Charged without crossing: dispute via the issuer, and the customer can also use ${esc(CHANNELS.nhaiHelpline)} or ${esc(CHANNELS.nhaiEmail)}.</li>`;
}

// ---------- wiring ----------
function showTab(id) {
  for (const b of document.querySelectorAll("[data-tab]")) b.setAttribute("aria-selected", String(b.dataset.tab === id));
  for (const p of document.querySelectorAll(".panel")) p.hidden = p.id !== id;
  try { localStorage.setItem("tagfix-tab", id); } catch {}
}

document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-acct],[data-example],[data-lang],[data-tab]");
  if (!t) return;
  if (t.dataset.acct) pickAccount(t.dataset.acct);
  else if (t.dataset.example) { $("#msg").value = t.dataset.example; run(t.dataset.example); }
  else if (t.dataset.lang) { state.replyLang = t.dataset.lang; renderResult(); }
  else if (t.dataset.tab) showTab(t.dataset.tab);
});
document.addEventListener("mouseover", (e) => {
  const tx = e.target.closest("[data-hl]");
  for (const row of document.querySelectorAll(".txn.flash")) row.classList.remove("flash");
  if (tx) document.querySelector(`.txn[data-txn="${tx.dataset.hl}"]`)?.classList.add("flash");
});
$("#ask").addEventListener("submit", (e) => { e.preventDefault(); run($("#msg").value); });
$("#msg").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); run($("#msg").value); }
});

renderScorecard();
renderRules();
pickAccount("rohan");
let tab = "try";
try { tab = localStorage.getItem("tagfix-tab") ?? "try"; } catch {}
const hash = location.hash.slice(1);
showTab(["try", "score", "how"].includes(hash) ? hash : ["try", "score", "how"].includes(tab) ? tab : "try");
