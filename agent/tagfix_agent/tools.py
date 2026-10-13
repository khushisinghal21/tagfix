"""Tools the agent can call, bound to one customer's account for one ticket.

Two kinds:
  * Check tools (read-only) run deterministic checks and register findings (F1, F2...).
  * Action tools change the ticket's outcome. Every money-moving or "your charge is
    correct" action must name a finding ID; the amount, transaction and channel are taken
    from the finding, never from the model. Anything that doesn't line up is REJECTED and
    the model is told why.
"""
from __future__ import annotations

import hashlib
import json
import threading
from dataclasses import dataclass, field
from typing import Literal, Optional

from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field

from . import checks, store
from .checks import Finding
from .store import day, inr, minutes_between, plaza_name, when

ASK_FIELDS = Literal["booth_receipt", "confirm_trip", "which_transaction", "pass_payment_ref", "upi_reference"]


@dataclass
class Outcome:
    action: str
    decision: str                      # auto_resolved | dispute_filed | needs_info | escalated
    summary: str                       # what was done, in plain English, for the reply writer
    finding_id: Optional[str] = None
    record: dict = field(default_factory=dict)


@dataclass
class Session:
    account_id: str
    now: str
    findings: dict[str, Finding] = field(default_factory=dict)
    checks_run: list[str] = field(default_factory=list)
    outcome: Optional[Outcome] = None
    rejections: list[str] = field(default_factory=list)
    trace: list[dict] = field(default_factory=list)
    # ToolNode runs parallel tool calls in threads; findings and the single outcome are shared.
    _lock: threading.RLock = field(default_factory=threading.RLock, repr=False)

    @property
    def account(self) -> dict:
        return store.get_account(self.account_id)

    # ----- findings -----
    def register(self, found: list[Finding]) -> list[Finding]:
        with self._lock:
            for f in found:
                f.id = f"F{len(self.findings) + 1}"
                self.findings[f.id] = f
        return found

    def run_check(self, name: str) -> str:
        fn, _ = checks.CHECKS[name]
        found = fn(self.account, self.now)
        with self._lock:
            self.register(found)
            self.checks_run.append(name)
            self.trace.append({"step": "check", "tool": name, "findings": [f.id for f in found]})
        return json.dumps({"check": name, "findings": [f.public() for f in found] or "nothing found"}, ensure_ascii=False)

    def reject(self, why: str) -> str:
        self.rejections.append(why)
        self.trace.append({"step": "rejected", "reason": why})
        return f"REJECTED: {why}"

    def _finding(self, finding_id: str, allowed: tuple[str, ...]) -> Finding | str:
        f = self.findings.get(finding_id)
        if f is None:
            known = ", ".join(self.findings) or "none yet"
            return self.reject(f"{finding_id} is not a finding from a check you ran (known: {known}). Run a check first.")
        if f.action not in allowed:
            return self.reject(f"{finding_id} ({f.kind}) allows '{f.action}', not this action.")
        return f

    def _set(self, outcome: Outcome) -> str:
        with self._lock:
            if self.outcome is not None:
                return self.reject(f"an action was already taken ({self.outcome.action}); only one action per ticket.")
            self.outcome = outcome
        self.trace.append({"step": "action", "action": outcome.action, "decision": outcome.decision,
                           "finding": outcome.finding_id, "record": outcome.record})
        return f"OK: {outcome.summary}"

    # ----- actions -----
    def file_dispute(self, finding_id: str) -> str:
        f = self._finding(finding_id, ("file_dispute",))
        if isinstance(f, str):
            return f
        ref = int(hashlib.sha1(f"{self.account_id}:{f.txn_id}:{f.reason}".encode()).hexdigest(), 16) % 100000
        rec = {"dispute_id": f"D-{ref:05d}", "txn_id": f.txn_id,
               "amount_inr": f.amount, "channel": f.channel, "reason": f.reason, "evidence": f.evidence,
               "tag": self.account["tagId"], "vehicle": self.account["vehicleNo"]}
        what = "Refund requested" if f.reason == "recharge_not_credited" else "Dispute filed"
        return self._set(Outcome("file_dispute", f.decision or "dispute_filed",
                                 f"{what} for {inr(f.amount)} on {f.txn_id} via {f.channel} (ref {rec['dispute_id']}), "
                                 f"with {', '.join(f.evidence)} attached. Not refunded yet. {store.rules()['disputeExpectation']}.",
                                 f.id, rec))

    def explain_charge(self, finding_id: str) -> str:
        f = self._finding(finding_id, ("explain",))
        if isinstance(f, str):
            return f
        return self._set(Outcome("explain", f.decision or "auto_resolved",
                                 "No money moves. Explained to the customer using the finding.", f.id))

    def send_link(self, finding_id: str) -> str:
        f = self._finding(finding_id, ("send_link",))
        if isinstance(f, str):
            return f
        label = {"recharge": f"recharge link for {inr(f.link_amount or 0)}", "kyc": "KYC completion link",
                 "renew_pass": f"Annual Pass renewal link ({inr(f.link_amount or 0)}, Rajmargyatra)"}[f.link]
        return self._set(Outcome("send_link", f.decision or "auto_resolved", f"Sent the {label}.", f.id,
                                 {"link": f.link, "amount_inr": f.link_amount}))

    def request_credit(self, finding_id: str) -> str:
        f = self._finding(finding_id, ("request_credit",))
        if isinstance(f, str):
            return f
        return self._set(Outcome("request_credit", "escalated",
                                 f"Opened a {f.reason}-priority ticket for the issuer to credit {inr(f.amount)} ({f.txn_id}) manually. "
                                 "Not credited yet.", f.id,
                                 {"queue": "issuer_credit", "txn_id": f.txn_id, "amount_inr": f.amount, "priority": f.reason}))

    def ask_customer(self, field: str, txn_id: Optional[str] = None) -> str:
        acc = self.account
        tolls = [x for x in acc["transactions"] if x["type"] == "toll"]
        if field == "confirm_trip":
            late = [f for f in self.findings.values() if f.kind == "late_posting" and (txn_id in (None, f.txn_id))]
            if not late:
                return self.reject("confirm_trip needs a late_posting finding for that transaction; run check_late_postings.")
            f = late[-1]
            x = next(t for t in tolls if t["id"] == f.txn_id)
            q = f"Was the car at {plaza_name(x['plazaId'])} on {day(x['time'])}? If not, {f.txn_id} gets disputed straight away."
            return self._set(Outcome("ask_customer", "needs_info", f"Asked the customer: {q}", f.id,
                                     {"field": field, "txn_id": f.txn_id, "on_no": "file_dispute"}))
        if field == "booth_receipt":
            recent = [t for t in tolls if t["status"] == "success" and t["amount"] > 0
                      and 0 <= minutes_between(t["time"], self.now) <= 48 * 60]
            if txn_id:
                recent = [t for t in recent if t["id"] == txn_id]
            if not recent:
                return self.reject("booth_receipt needs a paid toll on this tag in the last 48 hours" + (f" with id {txn_id}" if txn_id else "") + ".")
            x = recent[-1]
            q = (f"Please send the booth receipt or UPI reference for the payment at {plaza_name(x['plazaId'])}; "
                 f"the tag was also charged {inr(x['amount'])} ({x['id']}) at {when(x['time'])}, and that charge gets disputed once it arrives.")
            return self._set(Outcome("ask_customer", "needs_info", f"Asked the customer: {q}", None,
                                     {"field": field, "txn_id": x["id"], "then": "file_dispute"}))
        if field == "which_transaction":
            recent = [t for t in tolls if t["status"] == "success"][-3:]
            opts = "; ".join(f"{t['id']} {inr(t['amount'])} at {plaza_name(t['plazaId'])} ({when(t['time'])})" for t in recent)
            return self._set(Outcome("ask_customer", "needs_info", f"Asked which charge wasn't theirs: {opts}.", None,
                                     {"field": field, "options": [t["id"] for t in recent]}))
        if field == "pass_payment_ref":
            if acc.get("annualPass"):
                return self.reject("this tag has an Annual Pass; use check_annual_pass findings instead.")
            return self._set(Outcome("ask_customer", "needs_info",
                                     "Told the customer no Annual Pass is linked to the tag and asked for the pass payment reference.",
                                     None, {"field": field}))
        if field == "upi_reference":
            return self._set(Outcome("ask_customer", "needs_info", "Asked for the UPI reference of the payment.", None, {"field": field}))
        return self.reject(f"unknown field {field}")

    def hand_off(self, reason: str) -> str:
        recent = [x["id"] for x in self.account["transactions"]][-3:]
        return self._set(Outcome("hand_off", "escalated",
                                 "Passed to a support specialist with the recent transactions attached; the customer won't need to repeat anything.",
                                 None, {"reason": reason, "attached": recent,
                                        "findings": [f.public() for f in self.findings.values()]}))


# ---------- LangChain tool wrappers ----------

class _NoArgs(BaseModel):
    pass


class _FindingArg(BaseModel):
    finding_id: str = Field(description="ID of a finding returned by a check tool, e.g. 'F2'.")


class _AskArgs(BaseModel):
    field: ASK_FIELDS = Field(description="What to ask for. booth_receipt: customer paid at the booth AND the tag was charged. "
                                          "confirm_trip: a late_posting finding exists. which_transaction: customer says a charge "
                                          "wasn't theirs but no check proves which. pass_payment_ref: customer thinks they have an "
                                          "Annual Pass but none is linked. upi_reference: a payment needs tracing.")
    txn_id: Optional[str] = Field(default=None, description="Transaction the question is about, if known.")


class _HandOffArgs(BaseModel):
    reason: str = Field(description="One sentence on why a human should take this.")


def check_tools(s: Session) -> list[StructuredTool]:
    tools = [StructuredTool.from_function(
        func=lambda: json.dumps(checks.account_overview(s.account), ensure_ascii=False),
        name="get_account", description="Read the customer's tag, balance, Annual Pass summary and transactions (read time, "
                                        "posted time, plaza, amount, status). Use it to orient; it produces no findings.",
        args_schema=_NoArgs)]
    for name, (_, desc) in checks.CHECKS.items():
        tools.append(StructuredTool.from_function(func=(lambda n=name: s.run_check(n)), name=name,
                                                  description=desc + " Returns findings with IDs.", args_schema=_NoArgs))
    return tools


def action_tools(s: Session) -> list[StructuredTool]:
    return [
        StructuredTool.from_function(func=s.file_dispute, name="file_dispute", args_schema=_FindingArg,
                                     description="File a dispute/refund for a finding whose action is file_dispute. Amount, "
                                                 "transaction and channel come from the finding."),
        StructuredTool.from_function(func=s.explain_charge, name="explain_charge", args_schema=_FindingArg,
                                     description="Close the ticket by explaining a charge or status, using a finding whose action is "
                                                 "explain (e.g. return-trip fare, plaza not covered by the pass, pending toll)."),
        StructuredTool.from_function(func=s.send_link, name="send_link", args_schema=_FindingArg,
                                     description="Send the recharge / KYC / pass-renewal link named by a finding whose action is send_link."),
        StructuredTool.from_function(func=s.request_credit, name="request_credit", args_schema=_FindingArg,
                                     description="Open a priority manual-credit ticket for a stuck recharge (finding action request_credit)."),
        StructuredTool.from_function(func=s.ask_customer, name="ask_customer", args_schema=_AskArgs,
                                     description="Ask the customer for one missing detail instead of guessing."),
        StructuredTool.from_function(func=s.hand_off, name="hand_off", args_schema=_HandOffArgs,
                                     description="Hand the ticket to a human. Use when the findings don't support any other action, "
                                                 "or the message isn't about a FASTag transaction."),
    ]
