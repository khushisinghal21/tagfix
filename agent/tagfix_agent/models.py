"""Chat models the graph can run on.

* gemini(): the real thing. Needs GEMINI_API_KEY. Model via GEMINI_MODEL.
* OfflinePolicyModel: a deterministic stand-in that speaks the same tool-calling protocol,
  driven by keyword rules. It exists so the graph, tools and guardrails can be tested and
  demoed without a key. Its scores measure the plumbing, not the AI.
* ScriptedModel: replays hand-written model turns per step. Used to red-team the guardrails
  ("what if the model tries to dispute ₹500 on a transaction it never checked?").
"""
from __future__ import annotations

import json
import os
import re
import uuid
from typing import Any, Optional

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, ToolMessage
from langchain_core.outputs import ChatGeneration, ChatResult
from langchain_core.utils.function_calling import convert_to_openai_tool

DEFAULT_GEMINI_MODEL = "gemini-3.8-flash"


def gemini(model: Optional[str] = None, api_key: Optional[str] = None, requests_per_minute: Optional[float] = None):
    from langchain_core.rate_limiters import InMemoryRateLimiter
    from langchain_google_genai import ChatGoogleGenerativeAI

    key = api_key or os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not key:
        raise RuntimeError("Set GEMINI_API_KEY (free key: https://aistudio.google.com/apikey) or use --offline.")
    rpm = requests_per_minute or float(os.environ.get("GEMINI_RPM", "0") or 0)
    limiter = InMemoryRateLimiter(requests_per_second=rpm / 60, check_every_n_seconds=0.2, max_bucket_size=1) if rpm else None
    return ChatGoogleGenerativeAI(model=model or os.environ.get("GEMINI_MODEL", DEFAULT_GEMINI_MODEL),
                                  google_api_key=key, temperature=0, max_retries=4, timeout=60, rate_limiter=limiter)


# ---------- offline stand-in ----------

_I = re.I
_PATTERNS: list[tuple[str, list[re.Pattern]]] = [
    ("annual_pass", [re.compile(p, _I) for p in [
        r"annual\s*(pass|plan|toll pass|fastag)", r"(yearly|annual)\s*(fastag\s*|toll\s*)?(pass|plan)",
        r"(saal|saala|saalana|salana|sal)\s*(ka|wala|bhar ka)?\s*pass", r"\b3,?0[0-9]{2}\s*(wala|rs|₹|rupees?|ka)?\s*pass",
        r"trips?\s*(left|remaining|bache|bachi|khatam|used up|over|finish)",
        r"\bpass\b.*\b(active|activated|trips?|khatam|expired?|kaam nahi|stopped|not working|liya|li thi|hone ke baad|hai phir bhi|ke bawajood)\b",
        r"(my|mera|meri)\s+pass\b", r"वार्षिक पास|सालाना पास|एनुअल पास", r"rajmarg\s*yatra"]]),
    ("paid_at_booth", [re.compile(p, _I) for p in [
        r"(paid|pay kiya|pay kar|diya|de diya|gave).{0,40}(booth|counter|cash|upi|qr|gpay|phonepe|paytm)\b.{0,60}(tag|fastag|also|bhi)",
        r"(cash|counter|booth|upi)\s*(pe|par|at)?\s*(bhi|also).{0,40}(tag|fastag)",
        r"(cash|upi|counter|booth).{0,30}\b(and|aur|plus)\b.{0,30}(tag|fastag).{0,20}(bhi|also|too|deduct|kat|charge)",
        r"once (at|from) (the )?(counter|booth|cash)",
        r"(tag|fastag) (didn'?t|did not|nahi|nahin) (scan|read|chala|work).{0,60}(paid|diya|cash|upi)"]]),
    ("recharge_not_credited", [re.compile(p, _I) for p in [
        r"recharge.*(not|nahi|nahin|na).*(reflect|credit|update|aaya|aya|dikh|show)",
        r"(paid|payment|pay kiya|paise kat|deducted from (my )?bank|upi).*(balance|wallet).*(not|nahi|same|still)",
        r"recharge.*(pending|stuck|atak)", r"रिचार्ज.*(नहीं|नही)", r"balance (not|nahi) (updated|aaya|badha)"]]),
    ("tag_not_working", [re.compile(p, _I) for p in [
        r"black\s*-?\s*list", r"hot\s*-?\s*list", r"ब्लैकलिस्ट", r"kyc (pending|incomplete|nahi hua)",
        r"(tag|fastag)\s*(is |got |has been )?(blocked|band|inactive|deactivated|suspended)",
        r"(tag|fastag).*(declined|not working|nahi chal|nahi chala|reject)", r"toll (pe|par) (tag )?(nahi|nahin) (chala|chal raha)"]]),
    ("double_charge", [re.compile(p, _I) for p in [
        r"\btwice\b", r"\bdouble\b", r"\bduplicate\b", r"(do|2|two) (baar|bar|times)", r"दो बार", r"charged (two|2) times"]]),
    ("charged_without_crossing", [re.compile(p, _I) for p in [
        r"without (crossing|passing|going)", r"never (crossed|went|passed|travel)", r"(car|gaadi|gadi|vehicle).*(at home|ghar (pe|par|mein)|parked|garage)",
        r"(gaya|gayi|gaye) (hi )?(nahi|nahin)", r"not my (car|vehicle)", r"wrong vehicle", r"गया ही नहीं|घर पर", r"wasn'?t (even )?there",
        r"(was|were) in [a-z]+ (city|that day)", r"\bin (pune|mumbai|bangalore|bengaluru|chennai|hyderabad|kolkata)\b"]]),
    ("wrong_amount", [re.compile(p, _I) for p in [
        r"(extra|more than|zyada|jyada|jada|ज़्यादा|ज्यादा)", r"overcharg", r"wrong amount",
        r"(truck|bus|commercial|heavy) (rate|price|charge|toll)", r"charged ₹?\s?\d+.*(should|instead|normally|usually)"]]),
    ("missing_from_passbook", [re.compile(p, _I) for p in [
        r"passbook", r"statement", r"(not|nahi) (showing|dikh)", r"history", r"transaction (missing|not visible)"]]),
]
_NON_TXN = re.compile(r"(sticker|damaged|lost|replace|replacement|deliver|delivery|courier|order status|phone number|mobile number|"
                      r"change (my )?(number|vehicle|address)|vehicle number|address|close (my )?(fastag|account|tag)|cancel|"
                      r"activat(e|ion) (my |a )?(new )?(fastag|tag)|car ?wash|cleaner|cleaning|challan|parking|valet|insurance|loan|"
                      r"servic(e|ing)|tyre|petrol|fuel|voucher|cashback|wallet refund)", _I)
_HINGLISH = re.compile(r"\b(hai|hain|nahi|nahin|kya|mera|meri|mere|mujhe|baar|kiya|kar|gaya|gayi|hua|tha|thi|paise|gaadi|gadi|ghar|kyun|kab|abhi|bhi|se|pe|par)\b", _I)

TOPIC_CHECKS = {
    "double_charge": ["check_duplicate_charges", "check_return_trip_fares"],
    "charged_without_crossing": ["check_impossible_travel", "check_late_postings", "check_vehicle_class_charges"],
    "wrong_amount": ["check_vehicle_class_charges", "check_duplicate_charges", "check_return_trip_fares", "check_annual_pass"],
    "annual_pass": ["check_annual_pass"],
    "paid_at_booth": ["get_account"],
    "recharge_not_credited": ["check_recharges"],
    "tag_not_working": ["check_tag_status"],
    "missing_from_passbook": ["check_pending_tolls"],
}
ALL_CHECKS = ["check_duplicate_charges", "check_return_trip_fares", "check_vehicle_class_charges", "check_impossible_travel",
              "check_annual_pass", "check_late_postings", "check_recharges", "check_tag_status", "check_pending_tolls"]
# Order of preference when several findings answer the complaint.
PREFER = ["impossible_travel", "duplicate_read", "pass_not_applied", "overcharge", "late_posting", "recharge_stuck_refund",
          "recharge_stuck", "recharge_settling", "blacklisted_low_balance", "blacklisted_kyc", "pass_ended", "pass_not_covered",
          "pass_not_yet_active", "toll_pending", "return_trip_fare", "no_annual_pass", "pass_status", "no_pending_recharge", "tag_active"]
PROBLEMS = {"duplicate_read", "impossible_travel", "overcharge", "pass_not_applied", "late_posting", "recharge_stuck",
            "recharge_stuck_refund", "blacklisted_low_balance", "blacklisted_kyc", "toll_pending"}


def offline_triage(text: str) -> dict:
    lang = "hi" if re.search(r"[ऀ-ॿ]", text) else ("hinglish" if len(_HINGLISH.findall(text)) >= 2 else "en")
    if _NON_TXN.search(text):
        return {"language": lang, "about_fastag_transaction": False, "topic": "not_fastag_transaction", "claim": text}
    for topic, regs in _PATTERNS:
        if any(r.search(text) for r in regs):
            return {"language": lang, "about_fastag_transaction": True, "topic": topic, "claim": text}
    money = re.search(r"(toll|charg|deduct|debit|kat|kaat|paise|paisa|money|rupee|\brs\b|₹|\d{2,5}|fastag|\btag\b|balance|recharge|"
                      r"payment|paid|upi|sms|transaction|wallet|barrier|inactive|deactivat|declin|passbook|statement|fraud|using)", text, _I)
    if not money:
        return {"language": lang, "about_fastag_transaction": False, "topic": "not_fastag_transaction", "claim": text}
    return {"language": lang, "about_fastag_transaction": True, "topic": "unclear_money_issue", "claim": text}


def offline_action(topic: str, findings: list[dict]) -> tuple[str, dict]:
    from .graph import ANSWERS  # local import avoids a cycle

    def pick(cands):
        cands = sorted(cands, key=lambda f: PREFER.index(f["kind"]) if f["kind"] in PREFER else 99)
        return cands[0] if cands else None

    def act_on(f):
        a = f["action"]
        if a == "ask_customer":
            return "ask_customer", {"field": f.get("reason", "which_transaction"), "txn_id": f.get("txn_id")}
        if a == "none":
            return "hand_off", {"reason": "nothing actionable"}
        return {"file_dispute": "file_dispute", "explain": "explain_charge", "send_link": "send_link",
                "request_credit": "request_credit"}[a], {"finding_id": f["id"]}

    if topic == "paid_at_booth":
        return "ask_customer", {"field": "booth_receipt"}
    answers = ANSWERS.get(topic, set())
    direct = pick([f for f in findings if f["kind"] in answers and f["action"] != "none"])
    if direct and (direct["kind"] in PROBLEMS or not any(f["kind"] in PROBLEMS for f in findings) or topic != "unclear_money_issue"):
        return act_on(direct)
    if topic == "charged_without_crossing":
        return "ask_customer", {"field": "which_transaction"}
    problems = [f for f in findings if f["kind"] in PROBLEMS]
    by_txn: dict[Any, dict] = {}
    for f in sorted(problems, key=lambda f: PREFER.index(f["kind"])):
        by_txn.setdefault(f.get("txn_id") or f["kind"], f)
    if len(by_txn) == 1:
        return act_on(next(iter(by_txn.values())))
    if not by_txn and topic in ("unclear_money_issue", "double_charge"):
        rt = pick([f for f in findings if f["kind"] == "return_trip_fare"])
        if rt:
            return act_on(rt)
    return "hand_off", {"reason": "findings don't support a single action"}


def _call(name: str, args: dict) -> dict:
    return {"name": name, "args": args, "id": f"call_{uuid.uuid4().hex[:8]}", "type": "tool_call"}


class OfflinePolicyModel(BaseChatModel):
    bound: tuple = ()

    @property
    def _llm_type(self) -> str:
        return "tagfix-offline-policy"

    def bind_tools(self, tools, *, tool_choice=None, **kwargs):
        names = tuple(convert_to_openai_tool(t)["function"]["name"] for t in tools)
        return self.model_copy(update={"bound": names})

    def phase(self) -> str:
        if "Triage" in self.bound:
            return "triage"
        if "check_tag_status" in self.bound:
            return "investigate"
        if "file_dispute" in self.bound:
            return "act"
        return "respond"

    def _generate(self, messages: list[BaseMessage], stop=None, run_manager=None, **kwargs) -> ChatResult:
        return ChatResult(generations=[ChatGeneration(message=self.turn(self.phase(), messages))])

    def turn(self, phase: str, messages: list[BaseMessage]) -> AIMessage:
        human = next(m.content for m in messages if isinstance(m, HumanMessage))
        if phase == "triage":
            return AIMessage("", tool_calls=[_call("Triage", offline_triage(human))])
        if phase == "investigate":
            topic = re.search(r"topic=(\w+)", human).group(1)
            results = [m for m in messages if isinstance(m, ToolMessage)]
            if not results:
                return AIMessage("", tool_calls=[_call(n, {}) for n in TOPIC_CHECKS.get(topic, ALL_CHECKS)])
            rounds = sum(1 for m in messages if isinstance(m, AIMessage) and m.tool_calls)
            found_any = any('"findings": [' in m.content for m in results)
            if rounds == 1 and not found_any and topic != "paid_at_booth":
                # The claim didn't check out: look for another explanation on the account.
                done = {m.name for m in results}
                rest = [n for n in ALL_CHECKS if n not in done]
                if rest:
                    return AIMessage("", tool_calls=[_call(n, {}) for n in rest])
            return AIMessage("DONE")
        if phase == "act":
            if isinstance(messages[-1], ToolMessage) and messages[-1].content.startswith("REJECTED"):
                return AIMessage("", tool_calls=[_call("hand_off", {"reason": "previous action rejected"})])
            topic = re.search(r"topic=(\w+)", human).group(1)
            findings = json.loads(human.split("FINDINGS_JSON:", 1)[1])
            name, args = offline_action(topic, findings)
            return AIMessage("", tool_calls=[_call(name, args)])
        facts = re.findall(r"^- (.+)$", human, re.M)
        outcome = re.search(r"^OUTCOME: (.+)$", human, re.M).group(1)
        different = "different_issue: true" in human
        lead = "I checked your account and found a different issue from the one you described. " if different else ""
        tail = " If you meant something else, just tell me." if different else ""
        return AIMessage(lead + " ".join(facts + [outcome]) + tail)


class ScriptedModel(OfflinePolicyModel):
    """Replays scripted AIMessages for chosen phases; other phases use the offline policy."""
    script: dict = {}

    def turn(self, phase: str, messages: list[BaseMessage]) -> AIMessage:
        queue = self.script.get(phase)
        if queue:
            m = queue.pop(0)
            if isinstance(m, AIMessage) and m.tool_calls:
                m = AIMessage(m.content, tool_calls=[_call(c["name"], c["args"]) for c in m.tool_calls])
            return m
        return super().turn(phase, messages)
