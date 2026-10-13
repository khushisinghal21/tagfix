from fastapi.testclient import TestClient

from tagfix_agent.service import app

c = TestClient(app)


def test_health_and_accounts():
    assert c.get("/health").json()["ok"] is True
    ids = [a["id"] for a in c.get("/v1/accounts").json()]
    assert "rohan" in ids and "dev" in ids
    assert c.get("/v1/accounts/dev").json()["annual_pass"]["trips_left"] == 163
    assert c.get("/v1/accounts/nobody").status_code == 404


def test_resolve_offline():
    r = c.post("/v1/tickets/resolve", json={"account_id": "rohan", "message": "charged twice at Kherki", "mode": "offline"}).json()
    assert r["mode"] == "offline" and r["decision"] == "dispute_filed" and r["record"]["txn_id"] == "TX-1004"
    assert any(t["step"] == "check" for t in r["trace"])


def test_live_without_key_is_a_clear_400(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)
    r = c.post("/v1/tickets/resolve", json={"account_id": "rohan", "message": "charged twice", "mode": "live"})
    assert r.status_code == 400 and "GEMINI_API_KEY" in r.json()["detail"]


def test_console_served():
    assert "TagFix agent" in c.get("/").text
