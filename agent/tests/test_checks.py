"""The checks must agree with the JS engine the demo and earlier evaluations used."""
from tagfix_agent import checks as c
from tagfix_agent import store

NOW = store.demo_now()
A = store.accounts()


def kinds(fn, acc):
    return [(f.kind, f.txn_id, f.amount, f.action) for f in fn(A[acc], NOW)]


def test_duplicate_vs_return_trip():
    assert kinds(c.check_duplicates, "rohan") == [("duplicate_read", "TX-1004", 80, "file_dispute")]
    assert kinds(c.check_duplicates, "kabir") == []
    assert kinds(c.check_return_fares, "kabir") == [("return_trip_fare", "TX-7003", None, "explain")]
    # a duplicate 2 minutes later is not a discounted return leg
    assert kinds(c.check_vehicle_class, "rohan") == []


def test_overcharge_and_impossible_travel():
    assert kinds(c.check_vehicle_class, "arjun") == [("overcharge", "TX-3002", 390, "file_dispute")]
    (f,) = c.check_impossible_travel(A["priya"], NOW)
    assert (f.txn_id, f.amount) == ("TX-2003", 270) and f.evidence == ["TX-2002", "TX-2003"]


def test_annual_pass_verdicts():
    assert [f.kind for f in c.check_annual_pass(A["dev"], NOW)] == ["pass_status", "pass_not_applied"]
    assert [f.kind for f in c.check_annual_pass(A["aditi"], NOW)] == ["pass_status", "pass_not_covered"]
    assert [f.kind for f in c.check_annual_pass(A["farhan"], NOW)] == ["pass_ended"]
    assert [f.kind for f in c.check_annual_pass(A["rohan"], NOW)] == ["no_annual_pass"]
    # a pass miss is not double-counted as a wrong vehicle class
    assert c.check_vehicle_class(A["dev"], NOW) == []


def test_late_posting_recharge_blacklist_pending():
    assert kinds(c.check_late_postings, "tanvi") == [("late_posting", "TX-9402", 80, "ask_customer")]
    assert kinds(c.check_late_postings, "isha") == []  # 12 minutes is normal
    (r,) = c.check_recharges(A["neha"], NOW)
    assert (r.kind, r.action, r.reason) == ("recharge_stuck", "request_credit", "high")
    (b,) = c.check_tag_status(A["vikram"], NOW)
    assert (b.link, b.link_amount) == ("recharge", 260) and "1.25x" in b.text
    assert c.check_tag_status(A["sana"], NOW)[0].link == "kyc"
    assert kinds(c.check_pending_tolls, "meera") == [("toll_pending", "TX-8002", None, "explain")]


def test_inr_grouping():
    assert store.inr(3075) == "₹3,075" and store.inr(123456) == "₹1,23,456"
