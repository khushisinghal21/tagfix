"""Checks on the reply the LLM writes, before the customer sees it.

1. Every transaction ID, UPI reference, dispute reference, rupee amount and clock time in the
   reply must already appear in the verified material (findings, the action's outcome, the
   account). The model can rephrase; it can't introduce a number.
2. No false promises: the reply can't say money was refunded or credited when the action only
   filed a dispute or opened a ticket, and can't guarantee outcomes or timelines.
3. The reply is in the customer's script (Devanagari for Hindi, Roman otherwise).
"""
from __future__ import annotations

import re

TOKEN_RES = [
    re.compile(r"\bTX-\d+\b"),
    re.compile(r"\bUPI-\d+\b"),
    re.compile(r"\bD-\d{5}\b"),
    re.compile(r"\bTAG-\d+\b"),
    re.compile(r"\b\d{1,2}:\d{2}\b"),
]
AMOUNT_RE = re.compile(r"(?:₹|\brs\.?\s?|\binr\s?)\s?(\d[\d,]*(?:\.\d+)?)", re.I)
AMOUNT_AFTER_RE = re.compile(r"\b(\d[\d,]*)\s?(?:rupees|rupaye|rupay|रुपये|रुपए)\b", re.I)

FALSE_PROMISES = [
    re.compile(r"\b(has|have|had) been (refunded|credited|reversed|returned)\b", re.I),
    re.compile(r"\b(was|were|is|are) (refunded|credited back|reversed)\b", re.I),
    re.compile(r"\brefund (is |has been |was )?(done|processed|completed|successful|issued)\b", re.I),
    re.compile(r"\b(i|we)('ve| have)? (refunded|reversed|credited)\b", re.I),
    re.compile(r"\b(paise|amount|refund|rupaye)\s+(wapas\s+)?(aa gaye|aa gaya|mil gaye|mil gaya|credit ho gaye|credit ho gaya|wapas kar diye|lauta diye)\b", re.I),
    re.compile(r"\bwapas\s+(aa gaye|aa gaya|aa chuke|mil gaye|mil gaya|kar diye|kar diya|bhej diye|bhej diya|ho gaye|ho gaya)\b", re.I),
    re.compile(r"\brefund\s+(ho gaya|ho chuka|mil gaya|kar diya)\b", re.I),
    re.compile(r"(वापस (आ गए|आ गया|कर दिए|कर दिया|भेज दिए)|रिफंड (हो गया|कर दिया))"),
    re.compile(r"\bguarantee", re.I),
    re.compile(r"\b(within|in) (24|48) hours\b", re.I),
]

DEVANAGARI = re.compile(r"[ऀ-ॿ]")


def _amounts(text: str) -> set[str]:
    out = {m.group(1).replace(",", "").rstrip(".") for m in AMOUNT_RE.finditer(text)}
    out |= {m.group(1).replace(",", "") for m in AMOUNT_AFTER_RE.finditer(text)}
    return {a[:-2] if a.endswith(".00") else a for a in out}


def tokens(text: str) -> set[str]:
    found = set()
    for r in TOKEN_RES:
        found |= set(r.findall(text))
    return found


def check_reply(reply: str, verified: str, language: str, money_moved: bool = False) -> list[str]:
    """Returns a list of problems; empty means the reply may be sent."""
    problems = []
    if not reply or len(reply.strip()) < 20:
        return ["reply is empty or too short"]
    extra = tokens(reply) - tokens(verified)
    if extra:
        problems.append(f"mentions IDs/times not in the verified facts: {', '.join(sorted(extra))}")
    extra_amt = _amounts(reply) - _amounts(verified)
    if extra_amt:
        problems.append(f"mentions amounts not in the verified facts: {', '.join('₹' + a for a in sorted(extra_amt))}")
    if not money_moved:
        for r in FALSE_PROMISES:
            m = r.search(reply)
            if m:
                problems.append(f"promises something that hasn't happened: '{m.group(0)}'")
                break
    has_dev = bool(DEVANAGARI.search(reply))
    if language == "hi" and not has_dev:
        problems.append("customer wrote in Hindi (Devanagari) but the reply isn't in Devanagari")
    if language in ("en", "hinglish") and has_dev:
        problems.append("reply uses Devanagari but the customer wrote in Roman script")
    return problems
