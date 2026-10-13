"""Evaluate the agent on the labelled ticket sets.

    python -m tagfix_agent.eval --offline                 # stand-in model: tests plumbing + guardrails
    GEMINI_API_KEY=... python -m tagfix_agent.eval --live --sets held_out_3 --rpm 10

Reports what a support lead would ask: decisions right, tickets closed without an agent,
and the guardrail metric: wrong actions (a wrong dispute or a wrong "your charge is
correct"). Writes eval_results/<mode>-<timestamp>.json with every trace.
"""
from __future__ import annotations

import argparse
import json
import time
from datetime import datetime
from pathlib import Path

from . import store
from .graph import resolve

GOLD_TOPIC = {
    "double_deduction": "double_charge", "false_deduction": "charged_without_crossing", "wrong_amount": "wrong_amount",
    "recharge_not_reflecting": "recharge_not_credited", "blacklisted": "tag_not_working",
    "passbook_missing": "missing_from_passbook", "annual_pass": "annual_pass", "paid_at_booth": "paid_at_booth",
    "other": "not_fastag_transaction",
}
NO_AGENT = {"auto_resolved", "dispute_filed", "needs_info"}


def run(model, sets: list[str], limit: int | None = None, progress=print) -> dict:
    out = {}
    for name in sets:
        tickets = store.tickets()[name][: limit or None]
        rows = []
        for i, t in enumerate(tickets, 1):
            t0 = time.time()
            try:
                r = resolve(t["text"], t["account"], model)
                err = None
            except Exception as e:  # a crashed ticket is a handoff in production; count it as a miss here
                r, err = {"decision": "error", "topic": None, "reply_source": None, "rejected_actions": [], "trace": []}, repr(e)[:300]
            rows.append({**t, "result": r, "error": err, "seconds": round(time.time() - t0, 2),
                         "decision_ok": r["decision"] == t["gold"]["decision"],
                         "topic_ok": r.get("topic") == GOLD_TOPIC[t["gold"]["intent"]]})
            progress(f"  {name} {i}/{len(tickets)} {'ok ' if rows[-1]['decision_ok'] else 'MISS'} {r['decision']:<13} {t['text'][:60]}")
        out[name] = {"summary": summarise(rows), "rows": rows}
    return out


def summarise(rows: list[dict]) -> dict:
    n = len(rows) or 1
    pct = lambda k: round(100 * k / n)  # noqa: E731
    wrong = [r for r in rows if not r["decision_ok"] and r["result"]["decision"] in ("dispute_filed", "auto_resolved")]
    return {
        "tickets": len(rows),
        "decision_correct_pct": pct(sum(r["decision_ok"] for r in rows)),
        "topic_correct_pct": pct(sum(r["topic_ok"] for r in rows)),
        "closed_without_agent_pct": pct(sum(r["result"]["decision"] in NO_AGENT for r in rows)),
        "wrong_actions": len(wrong),
        "wrong_action_examples": [{"text": r["text"], "expected": r["gold"], "got": r["result"]["decision"]} for r in wrong],
        "replies_from_model_pct": pct(sum(r["result"].get("reply_source") == "model" for r in rows)),
        "replies_fallback": sum(r["result"].get("reply_source") == "fallback" for r in rows),
        "actions_rejected_by_guardrails": sum(len(r["result"].get("rejected_actions", [])) for r in rows),
        "errors": sum(1 for r in rows if r["error"]),
        "median_seconds": sorted(r["seconds"] for r in rows)[len(rows) // 2] if rows else 0,
        "misses": [{"text": r["text"], "expected": r["gold"], "got": {"topic": r["result"].get("topic"), "decision": r["result"]["decision"]}}
                   for r in rows if not r["decision_ok"]],
    }


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    mode = ap.add_mutually_exclusive_group(required=True)
    mode.add_argument("--offline", action="store_true", help="deterministic stand-in model (no key)")
    mode.add_argument("--live", action="store_true", help="Gemini (needs GEMINI_API_KEY)")
    ap.add_argument("--sets", nargs="+", default=["base", "held_out_1", "held_out_2", "held_out_3"])
    ap.add_argument("--limit", type=int, default=None, help="first N tickets per set")
    ap.add_argument("--model", default=None, help="Gemini model id (default from GEMINI_MODEL)")
    ap.add_argument("--rpm", type=float, default=None, help="max requests per minute (free tiers are low)")
    a = ap.parse_args(argv)

    if a.live:
        from .models import gemini
        model, label = gemini(a.model, requests_per_minute=a.rpm), "live"
    else:
        from .models import OfflinePolicyModel
        model, label = OfflinePolicyModel(), "offline"

    res = run(model, a.sets, a.limit)
    print(f"\n{'set':<11} {'n':>3} {'decision':>9} {'topic':>6} {'no-agent':>9} {'WRONG':>6} {"model-reply":>12} {'guard-rej':>10}")
    for name, v in res.items():
        s = v["summary"]
        print(f"{name:<11} {s['tickets']:>3} {s['decision_correct_pct']:>8}% {s['topic_correct_pct']:>5}% "
              f"{s['closed_without_agent_pct']:>8}% {s['wrong_actions']:>6} {s['replies_from_model_pct']:>9}% {s['actions_rejected_by_guardrails']:>10}")
    outdir = Path(__file__).resolve().parents[1] / "eval_results"
    outdir.mkdir(exist_ok=True)
    path = outdir / f"{label}-{datetime.now().strftime('%Y%m%d-%H%M%S')}.json"
    path.write_text(json.dumps({"mode": label, "model": getattr(model, "model", label), "results": res}, ensure_ascii=False, indent=1, default=str))
    print(f"\nfull traces: {path}")


if __name__ == "__main__":
    main()
