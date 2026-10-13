"""Deterministic checks over one account. Each check returns *findings*: facts the agent may
cite, with the evidence behind them and the only action that finding permits.

The LLM never computes an amount or decides that a charge is right or wrong. It chooses
which checks to run and which finding to act on; this module decides what is true.
"""
from __future__ import annotations

import math
from dataclasses import asdict, dataclass, field
from typing import Literal, Optional

from . import store
from .store import day, hhmm, inr, minutes_between, plaza_name, ts, when

Action = Literal["file_dispute", "explain", "send_link", "request_credit", "ask_customer", "none"]


@dataclass
class Finding:
    kind: str
    text: str                       # one plain-English fact, safe to show the customer
    action: Action                  # the only action this finding allows
    txn_id: Optional[str] = None
    evidence: list[str] = field(default_factory=list)
    amount: Optional[int] = None    # disputable / creditable amount, computed here, never by the LLM
    channel: Optional[str] = None
    reason: Optional[str] = None
    link: Optional[str] = None      # recharge | kyc | renew_pass
    link_amount: Optional[int] = None
    decision: Optional[str] = None  # what acting on this finding means for the ticket
    id: str = ""                    # assigned by the session (F1, F2, ...)

    def public(self) -> dict:
        d = {k: v for k, v in asdict(self).items() if v not in (None, [], "")}
        return d


R = store.rules
C = store.channels


def _tolls(acc: dict) -> list[dict]:
    t = [x for x in acc["transactions"] if x["type"] == "toll" and x["status"] == "success"]
    return sorted(t, key=lambda x: ts(x["time"]))


def haversine_km(a: dict, b: dict) -> float:
    r = 6371.0
    dlat, dlon = math.radians(b["lat"] - a["lat"]), math.radians(b["lon"] - a["lon"])
    h = math.sin(dlat / 2) ** 2 + math.cos(math.radians(a["lat"])) * math.cos(math.radians(b["lat"])) * math.sin(dlon / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


# ---------- Annual Pass ----------

def pass_state_at(acc: dict, iso: str) -> str:
    p = acc.get("annualPass")
    if not p:
        return "none"
    t = ts(iso)
    if t < ts(p["activatedAt"]):
        return "before_activation"
    if p.get("exhaustedAt") and t > ts(p["exhaustedAt"]):
        return "exhausted"
    if t >= ts(p["expiresAt"]):
        return "expired"
    return "active"


def expected_tariff(acc: dict, txn: dict) -> Optional[dict]:
    plaza = store.plazas().get(txn.get("plazaId"))
    if not plaza:
        return None
    if acc.get("annualPass") and plaza.get("annualPass") and pass_state_at(acc, txn["time"]) == "active":
        return {"amount": 0, "kind": "annual_pass"}
    cls = acc["vehicleClass"]
    prior = [x for x in _tolls(acc) if x["plazaId"] == txn["plazaId"] and x["id"] != txn["id"]
             and R()["duplicateWindowMin"] < minutes_between(x["time"], txn["time"]) <= R()["returnJourneyHours"] * 60]
    full = plaza["tariff"][cls]
    if prior and prior[-1]["amount"] == full:
        return {"amount": plaza["returnTariff"][cls] - full, "kind": "return", "return_of": prior[-1]["id"]}
    return {"amount": full, "kind": "single"}


# ---------- checks ----------

def check_duplicates(acc: dict, now: str) -> list[Finding]:
    ts_, out = _tolls(acc), []
    for i in range(len(ts_)):
        for j in range(i + 1, len(ts_)):
            gap = minutes_between(ts_[i]["time"], ts_[j]["time"])
            if gap > R()["duplicateWindowMin"]:
                break
            a, b = ts_[i], ts_[j]
            if a["plazaId"] == b["plazaId"] and a["amount"] == b["amount"] and a["amount"] > 0:
                out.append(Finding(
                    kind="duplicate_read", txn_id=b["id"], evidence=[a["id"], b["id"]], amount=b["amount"],
                    text=f"{inr(a['amount'])} was debited twice at {plaza_name(b['plazaId'])}, {round(gap)} minutes apart "
                         f"({hhmm(a['time'])} and {hhmm(b['time'])} on {day(b['time'])}). Same plaza, same amount, within "
                         f"{R()['duplicateWindowMin']} minutes: a duplicate read. {b['id']} is the duplicate.",
                    action="file_dispute", channel=C()["issuerDispute"], reason="duplicate_read", decision="dispute_filed"))
    return out


def check_return_fares(acc: dict, now: str) -> list[Finding]:
    out = []
    for x in _tolls(acc):
        exp = expected_tariff(acc, x)
        if exp and exp["kind"] == "return" and x["amount"] == exp["amount"]:
            place = plaza_name(x["plazaId"])
            out.append(Finding(
                kind="return_trip_fare", txn_id=x["id"], evidence=[exp["return_of"], x["id"]],
                text=f"{x['id']} ({inr(x['amount'])} at {place}, {when(x['time'])}) is the return leg of {exp['return_of']} "
                     f"within {R()['returnJourneyHours']} hours. A return leg is charged the round-trip fare minus the single "
                     f"fare already paid, so {inr(x['amount'])} is correct and not a duplicate.",
                action="explain", decision="auto_resolved"))
    return out


def check_vehicle_class(acc: dict, now: str) -> list[Finding]:
    out = []
    for x in _tolls(acc):
        exp = expected_tariff(acc, x)
        if not exp or exp["kind"] == "annual_pass" or x["amount"] <= exp["amount"]:
            continue
        plaza = store.plazas()[x["plazaId"]]
        charged_as = next((k for k, v in plaza["tariff"].items() if v == x["amount"]), None)
        as_ = f" (the {charged_as} rate)" if charged_as and charged_as != acc["vehicleClass"] else ""
        excess = x["amount"] - exp["amount"]
        out.append(Finding(
            kind="overcharge", txn_id=x["id"], evidence=[x["id"]], amount=excess,
            text=f"{x['id']}: charged {inr(x['amount'])} at {plaza['name']}{as_} on {when(x['time'])}. The "
                 f"{acc['vehicleClass']} {'return-leg' if exp['kind'] == 'return' else 'single'} fare there is "
                 f"{inr(exp['amount'])}, so {inr(excess)} was charged extra.",
            action="file_dispute", channel=C()["issuerDispute"], reason="vehicle_class_mismatch", decision="dispute_filed"))
    return out


def check_impossible_travel(acc: dict, now: str) -> list[Finding]:
    ts_, out = _tolls(acc), []
    pl = store.plazas()
    for a, b in zip(ts_, ts_[1:]):
        if a["plazaId"] == b["plazaId"]:
            continue
        km = haversine_km(pl[a["plazaId"]], pl[b["plazaId"]])
        hours = max(minutes_between(a["time"], b["time"]) / 60, 1 / 60)
        speed = km / hours
        if speed > R()["maxPlausibleSpeedKmh"]:
            out.append(Finding(
                kind="impossible_travel", txn_id=b["id"], evidence=[a["id"], b["id"]], amount=b["amount"],
                text=f"{b['id']}: {inr(b['amount'])} at {plaza_name(b['plazaId'])} on {when(b['time'])}, but "
                     f"{round(hours, 1)} hours earlier the same tag was read at {plaza_name(a['plazaId'])}, {round(km)} km away. "
                     f"That needs {round(speed)} km/h, above the {R()['maxPlausibleSpeedKmh']} km/h limit for a plausible trip, "
                     f"so {b['id']} can't be this vehicle.",
                action="file_dispute", channel=f"{C()['issuerDispute']}; {C()['nhaiEmail']}",
                reason="deduction_without_crossing", decision="dispute_filed"))
    return out


def check_annual_pass(acc: dict, now: str) -> list[Finding]:
    p = acc.get("annualPass")
    if not p:
        return [Finding(kind="no_annual_pass", text=f"No Annual Pass is linked to {acc['tagId']}; tolls are charged at the normal rate. "
                        "The pass is bought from NHAI in the Rajmargyatra app.",
                        action="ask_customer", reason="pass_payment_ref", decision="needs_info")]
    out: list[Finding] = []
    state = pass_state_at(acc, now)
    left = max(0, p["tripLimit"] - p["tripsUsed"])
    valid = f"{day(p['expiresAt'])} {p['expiresAt'][:4]}"
    pl = store.plazas()
    paid = [x for x in _tolls(acc) if x["amount"] > 0]
    for x in paid:
        st = pass_state_at(acc, x["time"])
        plaza = pl.get(x["plazaId"], {})
        place = plaza.get("name", x["plazaId"])
        if st == "active" and plaza.get("annualPass"):
            out.append(Finding(
                kind="pass_not_applied", txn_id=x["id"], evidence=[x["id"]], amount=x["amount"],
                text=f"{x['id']}: {inr(x['amount'])} charged at {place} on {when(x['time'])} while the Annual Pass was active. "
                     f"{place} is an {plaza.get('operator')} plaza covered by the pass, so this crossing should have been free.",
                action="file_dispute", channel=C()["annualPass"], reason="annual_pass_not_applied", decision="dispute_filed"))
        elif st == "active":
            out.append(Finding(
                kind="pass_not_covered", txn_id=x["id"], evidence=[x["id"]],
                text=f"{x['id']}: {inr(x['amount'])} at {place} on {when(x['time'])}. {place} is run by {plaza.get('operator')}; "
                     "the Annual Pass covers only National Highway and National Expressway plazas, so this toll is "
                     "correctly charged from the balance.",
                action="explain", decision="auto_resolved"))
        elif st in ("exhausted", "expired"):
            why = (f"all {p['tripLimit']} trips were used by {when(p['exhaustedAt'])}" if st == "exhausted"
                   else f"it expired on {valid}")
            out.append(Finding(
                kind="pass_ended", txn_id=x["id"], evidence=[x["id"]],
                text=f"The Annual Pass ended ({why}), so the tag went back to normal charging. {x['id']}: {inr(x['amount'])} "
                     f"at {place} on {when(x['time'])} is correct. A round trip through a point-based plaza counts as two trips. "
                     f"A new pass costs {inr(R()['annualPassFeeInr'])} in the Rajmargyatra app.",
                action="send_link", link="renew_pass", link_amount=R()["annualPassFeeInr"], decision="auto_resolved"))
        elif st == "before_activation":
            out.append(Finding(
                kind="pass_not_yet_active", txn_id=x["id"], evidence=[x["id"]],
                text=f"{x['id']} at {when(x['time'])} was read before the Annual Pass activated on {when(p['activatedAt'])}, "
                     "so it was charged normally.",
                action="explain", decision="auto_resolved"))
    if not out:
        out.append(Finding(
            kind="pass_status", text=f"Annual Pass {state}: {left} of {p['tripLimit']} trips left, valid until {valid}. "
                                     "No toll has been charged to the balance while it was active.",
            action="explain", decision="auto_resolved"))
    elif state == "active":
        out.insert(0, Finding(kind="pass_status", text=f"Annual Pass active: {left} of {p['tripLimit']} trips left, valid until {valid}.",
                              action="none"))
    return out


def check_late_postings(acc: dict, now: str) -> list[Finding]:
    out = []
    for x in _tolls(acc):
        if not x.get("postedTime"):
            continue
        delay = minutes_between(x["time"], x["postedTime"])
        if delay > R()["latePostingMin"] and minutes_between(x["postedTime"], now) <= 48 * 60:
            place = plaza_name(x["plazaId"])
            out.append(Finding(
                kind="late_posting", txn_id=x["id"], evidence=[x["id"]], amount=x["amount"],
                text=f"{x['id']}: {inr(x['amount'])} at {place}. The tag was read on {when(x['time'])} but the plaza only posted "
                     f"it on {when(x['postedTime'])}, {round(delay / 60, 1)} hours later, so the SMS date is not the trip date. "
                     f"If the car was at {place} on {day(x['time'])} the charge is correct; if not, it should be disputed.",
                action="ask_customer", reason="confirm_trip", decision="needs_info"))
    return out


def check_recharges(acc: dict, now: str) -> list[Finding]:
    pending = sorted([x for x in acc["transactions"] if x["type"] == "recharge" and x["status"] == "pending"],
                     key=lambda x: ts(x["time"]))
    if not pending:
        return [Finding(kind="no_pending_recharge", text=f"No recharge is pending on this tag. Balance is {inr(acc['balance'])}.",
                        action="explain", decision="auto_resolved")]
    r = pending[-1]
    age = round(minutes_between(r["time"], now))
    age_s = f"{age // 60}h {age % 60}m" if age >= 60 else f"{age} minutes"
    ref = r.get("paymentRef", r["id"])
    low = acc["balance"] < acc["minBalance"]
    base = f"Recharge {r['id']} of {inr(r['amount'])} ({ref}) was paid {age_s} ago and is not credited yet."
    if age < R()["rechargeSettleMin"]:
        return [Finding(kind="recharge_settling", txn_id=r["id"], evidence=[r["id"]],
                        text=f"{base} That's inside the normal {R()['rechargeSettleMin']}-minute settlement window; it will be rechecked automatically.",
                        action="explain", decision="auto_resolved")]
    if age >= R()["rechargeRefundAfterHours"] * 60:
        return [Finding(kind="recharge_stuck_refund", txn_id=r["id"], evidence=[r["id"]], amount=r["amount"],
                        text=f"{base} It is older than {R()['rechargeRefundAfterHours']} hours, so it should be refunded to the source account.",
                        action="file_dispute", channel="Payment refund to source account", reason="recharge_not_credited",
                        decision="dispute_filed")]
    extra = (f" Balance is {inr(acc['balance'])}, below the {inr(acc['minBalance'])} minimum, so the tag risks blacklisting: high priority."
             if low else "")
    return [Finding(kind="recharge_stuck", txn_id=r["id"], evidence=[r["id"]], amount=r["amount"],
                    text=f"{base} Past the {R()['rechargeSettleMin']}-minute settlement window, so it needs a manual credit by the issuer.{extra}",
                    action="request_credit", reason="high" if low else "normal", decision="escalated")]


def check_tag_status(acc: dict, now: str) -> list[Finding]:
    if acc["status"] != "blacklisted":
        return [Finding(kind="tag_active", text=f"Tag {acc['tagId']} is active with balance {inr(acc['balance'])}.",
                        action="explain", decision="auto_resolved")]
    declined = [x for x in acc["transactions"] if x["type"] == "toll" and x["status"] == "failed"]
    d = declined[-1] if declined else None
    dtext = (f" {d['id']} at {plaza_name(d['plazaId'])} on {when(d['time'])} was declined (code {d.get('failureCode')})." if d else "")
    penalty = (f" At a toll without a working tag the fee is {R()['noTagCashMultiplier']}x in cash or "
               f"{R()['noTagUpiMultiplier']}x by UPI (since 15 Nov 2025).")
    if acc.get("blacklistReason") == "low_balance":
        top = max(0, acc["minBalance"] - acc["balance"]) + R()["topUpBufferInr"]
        return [Finding(kind="blacklisted_low_balance", evidence=[d["id"]] if d else [], txn_id=d["id"] if d else None,
                        text=f"Tag blacklisted for low balance: {inr(acc['balance'])} against a {inr(acc['minBalance'])} minimum. "
                             f"A recharge of {inr(top)} clears it.{dtext}{penalty}",
                        action="send_link", link="recharge", link_amount=top, decision="auto_resolved")]
    return [Finding(kind="blacklisted_kyc", text=f"Tag blacklisted because KYC is {acc.get('kyc')}; the balance ({inr(acc['balance'])}) "
                                                 f"is not the issue. Completing KYC (RC and photo ID) reactivates it.{dtext}{penalty}",
                    action="send_link", link="kyc", decision="auto_resolved")]


def check_pending_tolls(acc: dict, now: str) -> list[Finding]:
    out = []
    for x in acc["transactions"]:
        if x["type"] == "toll" and x["status"] == "pending":
            out.append(Finding(kind="toll_pending", txn_id=x["id"], evidence=[x["id"]],
                               text=f"{x['id']}: {inr(x['amount'])} at {plaza_name(x['plazaId'])} on {when(x['time'])} was read but the "
                                    "plaza hasn't settled it, so it isn't in the passbook yet. It won't be charged twice.",
                               action="explain", decision="auto_resolved"))
    return out


CHECKS = {
    "check_duplicate_charges": (check_duplicates, "Same toll charged twice within minutes."),
    "check_return_trip_fares": (check_return_fares, "Second, cheaper charge at the same plaza that is a correct return-trip fare."),
    "check_vehicle_class_charges": (check_vehicle_class, "Tolls charged above this vehicle class's tariff (e.g. car charged truck rate)."),
    "check_impossible_travel": (check_impossible_travel, "Reads at two plazas too far apart for the time between them (charged without crossing)."),
    "check_annual_pass": (check_annual_pass, "Annual Pass status, trips left, and whether each paid toll should have been covered."),
    "check_late_postings": (check_late_postings, "Tolls the plaza posted hours or days after the tag read (SMS date differs from trip date)."),
    "check_recharges": (check_recharges, "Recharges paid but not credited to the tag."),
    "check_tag_status": (check_tag_status, "Whether the tag is blacklisted, why, and what clears it."),
    "check_pending_tolls": (check_pending_tolls, "Toll reads not yet in the passbook."),
}


def account_overview(acc: dict) -> dict:
    """What the agent may read about the account: no PII beyond first name and plate."""
    txns = []
    for x in sorted(acc["transactions"], key=lambda x: ts(x["time"])):
        row = {"id": x["id"], "type": x["type"], "read_time": x["time"][:16].replace("T", " "), "amount_inr": x["amount"],
               "status": x["status"]}
        if x.get("plazaId"):
            row["plaza"] = plaza_name(x["plazaId"])
        if x.get("postedTime"):
            row["posted_time"] = x["postedTime"][:16].replace("T", " ")
        if x.get("passTrip"):
            row["annual_pass_trip"] = True
        if x.get("paymentRef"):
            row["payment_ref"] = x["paymentRef"]
        if x.get("failureCode"):
            row["decline_code"] = x["failureCode"]
        txns.append(row)
    p = acc.get("annualPass")
    return {
        "customer_first_name": acc["owner"], "vehicle": acc["vehicleNo"], "vehicle_class": acc["vehicleClass"],
        "tag": acc["tagId"], "tag_status": acc["status"], "balance_inr": acc["balance"], "min_balance_inr": acc["minBalance"],
        "annual_pass": ({"trips_left": p["tripLimit"] - p["tripsUsed"], "valid_until": p["expiresAt"][:10],
                         "used_up": bool(p.get("exhaustedAt"))} if p else None),
        "transactions": txns,
    }
