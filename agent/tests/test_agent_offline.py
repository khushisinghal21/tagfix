"""End-to-end through the graph with the offline stand-in model."""
import pytest

from tagfix_agent import store
from tagfix_agent.eval import run, summarise
from tagfix_agent.graph import resolve
from tagfix_agent.models import OfflinePolicyModel

M = OfflinePolicyModel()


@pytest.mark.parametrize("acc,msg,decision,action", [
    ("rohan", "charged twice at Kherki this morning", "dispute_filed", "file_dispute"),
    ("kabir", "aaj kherki pe do baar paise kate", "auto_resolved", "explain"),
    ("priya", "toll charged without crossing, not my car", "dispute_filed", "file_dispute"),
    ("neha", "I recharged 500 by UPI but balance not updated", "escalated", "request_credit"),
    ("vikram", "My fastag is blacklisted, toll declined it today", "auto_resolved", "send_link"),
    ("dev", "annual pass hai phir bhi toll kat gaya", "dispute_filed", "file_dispute"),
    ("aditi", "why did Khalapur charge me, I have the annual pass", "auto_resolved", "explain"),
    ("farhan", "my annual pass stopped working", "auto_resolved", "send_link"),
    ("isha", "paid cash at the counter and the fastag also deducted", "needs_info", "ask_customer"),
    ("tanvi", "toll deducted today but I never crossed any toll today", "needs_info", "ask_customer"),
    ("meera", "my fastag sticker is damaged, need a new one", "escalated", "hand_off"),
])
def test_scenarios(acc, msg, decision, action):
    r = resolve(msg, acc, M)
    assert (r["decision"], r["action"]) == (decision, action), r["trace"]


def test_dispute_record_is_complete():
    r = resolve("duplicate deduction of rs 80 on my fastag", "rohan", M)
    rec = r["record"]
    assert rec["txn_id"] == "TX-1004" and rec["amount_inr"] == 80 and rec["evidence"] == ["TX-1003", "TX-1004"]
    assert rec["dispute_id"].startswith("D-") and rec["tag"] == "TAG-7781"


def test_pass_dispute_goes_to_nhai():
    r = resolve("I have the annual pass but ₹140 still got deducted", "dev", M)
    assert "Annual Pass" in r["record"]["channel"]


def test_follows_the_account_when_the_claim_doesnt_check_out():
    r = resolve("stuck at toll, they asked me to pay cash double", "vikram", M)
    assert r["action"] == "send_link" and r["different_issue"] is True


@pytest.mark.parametrize("name", ["base", "held_out_1", "held_out_2", "held_out_3"])
def test_offline_eval_has_no_wrong_actions(name):
    s = run(M, [name], progress=lambda *_: None)[name]["summary"]
    assert s["wrong_actions"] == 0 and s["errors"] == 0
