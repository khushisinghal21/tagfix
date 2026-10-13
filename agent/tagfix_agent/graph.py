"""The LangGraph agent.

    triage ──(not a FASTag transaction)──> hand_off ─┐
       │                                             │
       └──> investigate <──> run_checks              │
                 │                                   │
                 └──> act (guarded, ≤3 tries) ───────┴──> respond (validated, ≤2 tries, else fallback)

The model reads the message, picks checks, picks one action and writes the reply. Code decides
what is true (checks), what is allowed (action tools bound to findings) and what may be said
(reply guard).
"""
from __future__ import annotations

import json
from typing import Annotated, Literal, Optional, TypedDict

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage, AnyMessage, HumanMessage, SystemMessage, ToolMessage
from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import add_messages
from langgraph.prebuilt import ToolNode
from pydantic import BaseModel, Field, ValidationError

from . import checks, prompts, store
from .guard import check_reply
from .tools import Session, action_tools, check_tools

MAX_INVESTIGATE_ROUNDS = 3
MAX_ACT_TRIES = 3
MAX_REPLY_TRIES = 2

TOPICS = Literal["double_charge", "charged_without_crossing", "wrong_amount", "annual_pass", "paid_at_booth",
                 "recharge_not_credited", "tag_not_working", "missing_from_passbook", "unclear_money_issue",
                 "not_fastag_transaction"]

# Which finding kinds answer which complaint. Acting on anything else means the agent found a
# different problem than the one described, and the reply has to say so.
ANSWERS = {
    "double_charge": {"duplicate_read", "return_trip_fare"},
    "charged_without_crossing": {"impossible_travel", "late_posting"},
    "wrong_amount": {"overcharge", "return_trip_fare", "pass_not_applied"},
    "annual_pass": {"pass_not_applied", "pass_not_covered", "pass_ended", "pass_not_yet_active", "pass_status", "no_annual_pass"},
    "recharge_not_credited": {"recharge_stuck", "recharge_settling", "recharge_stuck_refund", "no_pending_recharge"},
    "tag_not_working": {"blacklisted_low_balance", "blacklisted_kyc", "tag_active"},
    "missing_from_passbook": {"toll_pending"},
}


class Triage(BaseModel):
    """Classify the customer's message."""
    language: Literal["en", "hinglish", "hi"] = Field(description="en, hinglish (Hindi in Roman script) or hi (Devanagari)")
    about_fastag_transaction: bool
    topic: TOPICS
    claim: str = Field(description="The customer's claim restated in one plain English sentence.")


class State(TypedDict, total=False):
    message: str
    language: str
    topic: str
    about_fastag: bool
    claim: str
    messages: Annotated[list[AnyMessage], add_messages]
    rounds: int
    different_issue: bool
    reply: str
    reply_source: str
    reply_problems: list[str]


def _devanagari(text: str) -> bool:
    return any("ऀ" <= ch <= "ॿ" for ch in text)


def build_graph(model: BaseChatModel, s: Session):
    ctools, atools = check_tools(s), action_tools(s)
    atool_map = {t.name: t for t in atools}

    def triage(st: State) -> State:
        ai = model.bind_tools([Triage], tool_choice="any").invoke(
            [SystemMessage(prompts.TRIAGE), HumanMessage(st["message"])])
        try:
            t = Triage(**ai.tool_calls[0]["args"])
        except (IndexError, KeyError, ValidationError, TypeError) as e:
            s.trace.append({"step": "triage_failed", "error": str(e)[:200]})
            t = Triage(language="hi" if _devanagari(st["message"]) else "en", about_fastag_transaction=True,
                       topic="unclear_money_issue", claim=st["message"][:200])
        if not t.about_fastag_transaction:
            t.topic = "not_fastag_transaction"
        s.trace.append({"step": "triage", **t.model_dump()})
        return {"language": t.language, "topic": t.topic, "about_fastag": t.about_fastag_transaction, "claim": t.claim,
                "rounds": 0}

    def after_triage(st: State) -> str:
        return "investigate" if st["about_fastag"] else "not_fastag"

    def not_fastag(st: State) -> State:
        s.hand_off(f"Not a FASTag transaction issue: {st['claim']}")
        return {"different_issue": False}

    def investigate(st: State) -> State:
        msgs = st.get("messages") or [
            SystemMessage(prompts.INVESTIGATE),
            HumanMessage(f"Customer message: {st['message']}\nTriage: topic={st['topic']}; claim={st['claim']}"),
        ]
        ai = model.bind_tools(ctools).invoke(msgs)
        new = msgs + [ai] if not st.get("messages") else [ai]
        return {"messages": new, "rounds": st.get("rounds", 0) + 1}

    def after_investigate(st: State) -> str:
        last = st["messages"][-1]
        if isinstance(last, AIMessage) and last.tool_calls and st["rounds"] <= MAX_INVESTIGATE_ROUNDS:
            return "run_checks"
        return "act"

    def act(st: State) -> State:
        findings = [f.public() for f in s.findings.values()]
        msgs: list[AnyMessage] = [
            SystemMessage(prompts.ACT),
            HumanMessage(f"Customer message: {st['message']}\nTriage: topic={st['topic']}; claim={st['claim']}\n"
                         f"Checks run: {', '.join(s.checks_run) or 'none'}\n"
                         f"FINDINGS_JSON: {json.dumps(findings, ensure_ascii=False)}"),
        ]
        bound = model.bind_tools(atools, tool_choice="any")
        for _ in range(MAX_ACT_TRIES):
            ai = bound.invoke(msgs)
            msgs.append(ai)
            if not ai.tool_calls:
                s.reject("no action tool was called")
                msgs.append(HumanMessage("You must call exactly one action tool."))
                continue
            for i, call in enumerate(ai.tool_calls):
                if i == 0:
                    tool = atool_map.get(call["name"])
                    result = tool.invoke(call["args"]) if tool else s.reject(f"unknown tool {call['name']}")
                else:
                    result = "REJECTED: only one action per ticket; this call was ignored."
                msgs.append(ToolMessage(str(result), tool_call_id=call["id"]))
            if s.outcome is not None:
                break
        if s.outcome is None:
            s.hand_off("The agent couldn't choose an action the findings support.")
        f = s.findings.get(s.outcome.finding_id) if s.outcome.finding_id else None
        expected = ANSWERS.get(st["topic"])
        different = bool(f and expected and f.kind not in expected)
        return {"different_issue": different}

    def respond(st: State) -> State:
        o = s.outcome
        acted = s.findings.get(o.finding_id) if o.finding_id else None
        facts = [acted.text] if acted else []
        status = next((f for f in s.findings.values() if f.kind == "pass_status"), None)
        if acted and acted.kind.startswith("pass_") and status and status is not acted:
            facts.insert(0, status.text)
        verified = "\n".join([*(f.text for f in s.findings.values()), o.summary, json.dumps(o.record, ensure_ascii=False),
                              json.dumps(checks.account_overview(s.account), ensure_ascii=False)])
        brief = (f"Customer language: {st['language']}\nCustomer first name: {s.account['owner']}\n"
                 f"Customer wrote: {st['message']}\n"
                 f"FACTS:\n" + "\n".join(f"- {x}" for x in facts) + f"\nOUTCOME: {o.summary}\n"
                 f"different_issue: {str(st.get('different_issue', False)).lower()}")
        msgs: list[AnyMessage] = [SystemMessage(prompts.RESPOND), HumanMessage(brief)]
        problems: list[str] = []
        for _ in range(MAX_REPLY_TRIES):
            ai = model.invoke(msgs)
            text = ai.content if isinstance(ai.content, str) else "".join(
                p.get("text", "") if isinstance(p, dict) else str(p) for p in ai.content)
            text = text.strip()
            problems = check_reply(text, verified, st["language"])
            if not problems:
                s.trace.append({"step": "reply", "source": "model"})
                return {"reply": text, "reply_source": "model", "reply_problems": []}
            s.trace.append({"step": "reply_rejected", "problems": problems})
            msgs += [AIMessage(text), HumanMessage("Your reply was rejected: " + "; ".join(problems) + ". Rewrite it.")]
        fallback = " ".join([*facts, o.summary])
        s.trace.append({"step": "reply", "source": "fallback"})
        return {"reply": fallback, "reply_source": "fallback", "reply_problems": problems}

    g = StateGraph(State)
    g.add_node("triage", triage)
    g.add_node("not_fastag", not_fastag)
    g.add_node("investigate", investigate)
    g.add_node("run_checks", ToolNode(ctools))
    g.add_node("act", act)
    g.add_node("respond", respond)
    g.add_edge(START, "triage")
    g.add_conditional_edges("triage", after_triage, {"investigate": "investigate", "not_fastag": "not_fastag"})
    g.add_conditional_edges("investigate", after_investigate, {"run_checks": "run_checks", "act": "act"})
    g.add_edge("run_checks", "investigate")
    g.add_edge("not_fastag", "respond")
    g.add_edge("act", "respond")
    g.add_edge("respond", END)
    return g.compile()


def resolve(message: str, account_id: str, model: BaseChatModel, now: Optional[str] = None) -> dict:
    """Run one ticket end to end. Returns the decision, the action record, the reply and a full trace."""
    s = Session(account_id=account_id, now=now or store.demo_now())
    store.get_account(account_id)  # fail fast on unknown accounts
    out = build_graph(model, s).invoke({"message": message}, {"recursion_limit": 20})
    o = s.outcome
    return {
        "account_id": account_id,
        "message": message,
        "language": out.get("language"),
        "topic": out.get("topic"),
        "claim": out.get("claim"),
        "decision": o.decision,
        "action": o.action,
        "finding": s.findings[o.finding_id].public() if o.finding_id else None,
        "record": o.record,
        "different_issue": out.get("different_issue", False),
        "reply": out.get("reply"),
        "reply_source": out.get("reply_source"),
        "reply_problems": out.get("reply_problems", []),
        "checks_run": s.checks_run,
        "rejected_actions": s.rejections,
        "trace": s.trace,
    }
