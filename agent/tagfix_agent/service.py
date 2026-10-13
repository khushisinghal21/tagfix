"""HTTP service: the seam a support desk (chat widget, WhatsApp bot, agent console) would call.

    uvicorn tagfix_agent.service:app --reload        # http://localhost:8000 opens the trace console

With GEMINI_API_KEY set, tickets run on Gemini; without it, on the offline stand-in model
(responses say which). POST /v1/tickets/resolve returns the decision, the action record
(e.g. the dispute packet), the reply and the full trace.
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Literal, Optional

from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field

from . import __version__, checks, store
from .graph import resolve
from .models import OfflinePolicyModel, gemini

app = FastAPI(title="TagFix agent", version=__version__,
              description="FASTag support agent: LLM understanding, deterministic checks, guarded actions.")

_models: dict[str, object] = {}


def _model(mode: str):
    if mode == "auto":
        mode = "live" if (os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")) else "offline"
    if mode not in _models:
        _models[mode] = gemini() if mode == "live" else OfflinePolicyModel()
    return mode, _models[mode]


class TicketIn(BaseModel):
    account_id: str = Field(examples=["rohan"])
    message: str = Field(min_length=2, max_length=2000, examples=["toll pe paise do baar kat gaye"])
    mode: Literal["auto", "live", "offline"] = "auto"
    now: Optional[str] = Field(default=None, description="ISO time to evaluate against; defaults to the demo clock.")


@app.get("/health")
def health():
    mode, _ = _model("auto")
    return {"ok": True, "version": __version__, "default_mode": mode,
            "gemini_model": os.environ.get("GEMINI_MODEL") if mode == "live" else None}


@app.get("/v1/accounts")
def list_accounts():
    return [{"id": k, "owner": a["owner"], "persona": a["persona"], "vehicle": a["vehicleNo"]} for k, a in store.accounts().items()]


@app.get("/v1/accounts/{account_id}")
def account(account_id: str):
    try:
        return checks.account_overview(store.get_account(account_id))
    except KeyError:
        raise HTTPException(404, f"unknown account {account_id}")


@app.get("/v1/examples")
def examples():
    out: dict[str, list[str]] = {}
    for rows in store.tickets().values():
        for t in rows:
            lst = out.setdefault(t["account"], [])
            if t["text"] not in lst and len(lst) < 6:
                lst.append(t["text"])
    return out


@app.post("/v1/tickets/resolve")
def resolve_ticket(t: TicketIn):
    try:
        store.get_account(t.account_id)
    except KeyError:
        raise HTTPException(404, f"unknown account {t.account_id}")
    try:
        mode, model = _model(t.mode)
    except RuntimeError as e:
        raise HTTPException(400, str(e))
    try:
        result = resolve(t.message, t.account_id, model, now=t.now)
    except Exception as e:  # model/network failure: fail closed, like a handoff
        raise HTTPException(502, f"agent failed ({type(e).__name__}); route this ticket to a human. {str(e)[:200]}")
    return {"mode": mode, **result}


@app.get("/", response_class=HTMLResponse)
def console():
    return (Path(__file__).parent / "static" / "console.html").read_text(encoding="utf-8")
