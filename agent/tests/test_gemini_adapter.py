"""Runs the whole graph through the real ChatGoogleGenerativeAI adapter, with only the network
call replaced. Proves the Gemini request/response plumbing (forced function calling, parallel
function calls, function responses fed back, Devanagari text) works before a key is used."""
import json

import pytest
from google.genai import types

from tagfix_agent.graph import resolve
from tagfix_agent.models import gemini


def _resp(*parts):
    return types.GenerateContentResponse(candidates=[types.Candidate(
        content=types.Content(role="model", parts=list(parts)), finish_reason=types.FinishReason.STOP)])


def _fc(name, **args):
    return types.Part(function_call=types.FunctionCall(name=name, args=args))


class FakeGemini:
    """Plays the model's side of the conversation, reading the real request payloads."""

    def __init__(self):
        self.requests = []

    def __call__(self, model, contents, config):
        self.requests.append({"model": model, "contents": contents, "config": config})
        fns = [f.name for t in (config.tools or []) for f in (t.function_declarations or [])]
        responses = [p.function_response for c in contents for p in (c.parts or []) if p.function_response]
        if fns == ["Triage"]:
            assert config.tool_config.function_calling_config.mode == types.FunctionCallingConfigMode.ANY
            return _resp(_fc("Triage", language="hi", about_fastag_transaction=True, topic="double_charge",
                             claim="Charged twice at a toll this morning."))
        if "check_duplicate_charges" in fns:
            if not responses:  # first turn: two checks in parallel
                return _resp(_fc("check_duplicate_charges"), _fc("check_return_trip_fares"))
            return _resp(types.Part(text="DONE"))
        if "file_dispute" in fns:
            text = contents[-1].parts[0].text
            findings = json.loads(text.split("FINDINGS_JSON:", 1)[1])
            dup = next(f for f in findings if f["kind"] == "duplicate_read")
            return _resp(_fc("file_dispute", finding_id=dup["id"]))
        return _resp(types.Part(text="आप सही हैं, टोल पर ₹80 दो बार कटे। मैंने TX-1004 पर विवाद दर्ज कर दिया है। "
                                     "इसमें आम तौर पर 2 से 4 हफ्ते लगते हैं, हर अपडेट यहीं मिलेगा।"))


@pytest.fixture
def llm():
    m = gemini(api_key="test-key-not-used")
    fake = FakeGemini()
    m.client.models.generate_content = fake
    m._fake = fake
    return m


def test_full_ticket_through_gemini_adapter(llm):
    r = resolve("आज सुबह टोल पर दो बार पैसे कटे", "rohan", llm)
    assert r["language"] == "hi" and r["topic"] == "double_charge"
    assert sorted(r["checks_run"]) == ["check_duplicate_charges", "check_return_trip_fares"]
    assert r["decision"] == "dispute_filed" and r["record"]["txn_id"] == "TX-1004" and r["record"]["amount_inr"] == 80
    assert r["reply_source"] == "model" and "विवाद" in r["reply"]
    # triage, investigate x2, act, respond
    assert len(llm._fake.requests) == 5
    # the check results were sent back to the model as function responses
    second = llm._fake.requests[2]["contents"]
    assert sum(1 for c in second for p in (c.parts or []) if p.function_response) == 2
