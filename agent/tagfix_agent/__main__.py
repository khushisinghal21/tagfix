"""CLI: resolve one ticket and print the decision, reply and trace.

    python -m tagfix_agent --account rohan "toll pe paise do baar kat gaye"
    python -m tagfix_agent --account dev --offline "annual pass hai phir bhi toll kat gaya"
"""
import argparse
import json
import os

from .graph import resolve
from .models import OfflinePolicyModel, gemini


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("message")
    ap.add_argument("--account", required=True)
    ap.add_argument("--offline", action="store_true", help="use the offline stand-in model")
    ap.add_argument("--json", action="store_true", help="print the full result as JSON")
    a = ap.parse_args()
    live = not a.offline and (os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY"))
    r = resolve(a.message, a.account, gemini() if live else OfflinePolicyModel())
    if a.json:
        print(json.dumps(r, ensure_ascii=False, indent=2))
        return
    print(f"model     : {'gemini' if live else 'offline stand-in'}")
    print(f"triage    : {r['language']} / {r['topic']} — {r['claim']}")
    print(f"checks    : {', '.join(r['checks_run']) or '-'}")
    if r["finding"]:
        print(f"finding   : {r['finding']['id']} {r['finding']['kind']}: {r['finding']['text']}")
    print(f"action    : {r['action']} → {r['decision']}" + (f"  {json.dumps(r['record'], ensure_ascii=False)}" if r["record"] else ""))
    if r["rejected_actions"]:
        print(f"guardrail : rejected {r['rejected_actions']}")
    print(f"reply ({r['reply_source']}):\n  {r['reply']}")


if __name__ == "__main__":
    main()
