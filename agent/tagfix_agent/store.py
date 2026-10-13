"""Loads the shared demo data (exported from the JS engine by scripts/export-data.mjs).

In production this module is the seam where Park+'s issuer-bank / NETC transaction feed,
tag status and Annual Pass status would be read instead of JSON files."""
from __future__ import annotations

import json
from datetime import datetime
from functools import lru_cache
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parents[2] / "data"


def _load(name: str):
    return json.loads((DATA_DIR / name).read_text(encoding="utf-8"))


@lru_cache
def plazas() -> dict:
    return _load("plazas.json")


@lru_cache
def _accounts_blob() -> dict:
    return _load("accounts.json")


def accounts() -> dict:
    return _accounts_blob()["accounts"]


def demo_now() -> str:
    return _accounts_blob()["demoNow"]


@lru_cache
def rules() -> dict:
    return _load("rules.json")["rules"]


@lru_cache
def channels() -> dict:
    return _load("rules.json")["channels"]


@lru_cache
def tickets() -> dict:
    return _load("tickets.json")


def get_account(account_id: str) -> dict:
    acc = accounts().get(account_id)
    if acc is None:
        raise KeyError(f"unknown account {account_id!r}")
    return acc


def ts(iso: str) -> datetime:
    return datetime.fromisoformat(iso)


def minutes_between(a: str, b: str) -> float:
    return (ts(b) - ts(a)).total_seconds() / 60


def plaza_name(pid: str) -> str:
    return plazas().get(pid, {}).get("name", pid)


MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def day(iso: str) -> str:
    d = ts(iso)
    return f"{d.day} {MONTHS[d.month - 1]}"


def hhmm(iso: str) -> str:
    return iso[11:16]


def when(iso: str) -> str:
    return f"{day(iso)}, {hhmm(iso)}"


def inr(n: float) -> str:
    n = int(round(n))
    s = str(n)
    if len(s) > 3:  # Indian digit grouping: 1,23,456
        head, tail = s[:-3], s[-3:]
        parts = []
        while len(head) > 2:
            parts.insert(0, head[-2:])
            head = head[:-2]
        if head:
            parts.insert(0, head)
        s = ",".join(parts) + "," + tail
    return f"₹{s}"
