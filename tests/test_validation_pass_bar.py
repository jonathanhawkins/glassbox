"""Regression tests: the validator passes only on a full exact-match sweep.

A run "passes" only when the oracle matches every scored line (accuracy >= 1.0,
``validator.PASS_THRESHOLD``). The old bar emitted ``validation_passed`` for any
accuracy > 0, so a partial run lit the whole board green even though most
categories still failed. These tests pin the honest bar at the producer (the
event type and the validator lane status), since the cockpit paints the board off
exactly those signals:

  * partial accuracy (0 < acc < 1)  -> validation_failed, validator lane "failed"
  * zero accuracy / broken build    -> validation_failed, validator lane "failed"
  * full exact match (acc == 1.0)   -> validation_passed, validator lane "done"

Heavy collaborators (Weave, the Redis bus, the leaderboard) are monkeypatched so
the contract is asserted offline and deterministically.
"""
from __future__ import annotations

from types import SimpleNamespace

from agents import validator as validator_module
from harness.evaluator import EvalResult


def _patch_bus(monkeypatch):
    """Silence Weave + the leaderboard; capture emitted events and lane statuses."""
    events: list[tuple[str, dict]] = []
    statuses: list[tuple[str, str]] = []

    monkeypatch.setattr(validator_module.llm, "init_weave", lambda: None)
    monkeypatch.setattr(
        validator_module.weave_eval,
        "log_planner_eval",
        lambda *a, **k: {"logged": False},
    )
    monkeypatch.setattr(validator_module.bus, "set_planner_score", lambda *a, **k: 0.0)
    monkeypatch.setattr(validator_module.bus, "emit_mail", lambda *a, **k: "")

    def fake_emit_type(event_type, run_id, **kw):
        events.append((event_type, kw.get("payload") or {}))
        return "1-0"

    def fake_set_agent_status(run_id, agent, status, **kw):
        statuses.append((agent, status))
        return "1-0"

    monkeypatch.setattr(validator_module.bus, "emit_type", fake_emit_type)
    monkeypatch.setattr(validator_module.bus, "set_agent_status", fake_set_agent_status)
    return events, statuses


def _task(result: EvalResult, build_ok: bool = True):
    """A minimal task whose build()/evaluate() return a canned grade."""
    return SimpleNamespace(
        name="tokenizer",
        groups=["ascii", "punctuation", "numbers"],
        build=lambda: (build_ok, "" if build_ok else "boom"),
        evaluate=lambda: result,
    )


def _validation_event(events):
    for ev_type, payload in events:
        if ev_type in ("validation_passed", "validation_failed"):
            return ev_type, payload
    raise AssertionError(f"no validation event was emitted (got {events})")


def _final_validator_status(statuses):
    for agent, status in reversed(statuses):
        if agent == "validator":
            return status
    raise AssertionError(f"validator status was never set (got {statuses})")


def test_partial_accuracy_does_not_pass(monkeypatch):
    events, statuses = _patch_bus(monkeypatch)
    # ascii covered + matching; punctuation/numbers uncovered + failing -> 0.6 overall.
    result = EvalResult(
        score=0.6,
        passed=6,
        total=10,
        by_group={
            "ascii": {"total": 3, "passed": 3, "failed": 0},
            "punctuation": {"total": 4, "passed": 0, "failed": 4},
            "numbers": {"total": 3, "passed": 0, "failed": 3},
        },
    )

    validator_module.validate(_task(result), "run-partial", planner_version=2, caps={"ascii"})

    ev_type, payload = _validation_event(events)
    assert ev_type == "validation_failed", "a partial score must NOT read as passed"
    assert payload["accuracy"] == 0.6
    assert "punctuation" in payload["failed_categories"]
    assert _final_validator_status(statuses) == "failed", (
        "the validator lane must not look settled (done/idle) on a partial run"
    )


def test_zero_accuracy_fails(monkeypatch):
    events, statuses = _patch_bus(monkeypatch)
    # A broken build grades to 0.0; it must read as a failure, not a pass.
    result = EvalResult(score=0.0, passed=0, total=0, error="build failed: boom")

    validator_module.validate(
        _task(result, build_ok=False), "run-zero", planner_version=1, caps=set()
    )

    ev_type, _ = _validation_event(events)
    assert ev_type == "validation_failed"
    assert _final_validator_status(statuses) == "failed"


def test_full_exact_match_passes(monkeypatch):
    events, statuses = _patch_bus(monkeypatch)
    # Every scored line matches: a genuine pass.
    result = EvalResult(
        score=1.0,
        passed=10,
        total=10,
        by_group={
            "ascii": {"total": 3, "passed": 3, "failed": 0},
            "punctuation": {"total": 4, "passed": 4, "failed": 0},
            "numbers": {"total": 3, "passed": 3, "failed": 0},
        },
    )

    validator_module.validate(
        _task(result),
        "run-full",
        planner_version=8,
        caps={"ascii", "punctuation", "numbers"},
    )

    ev_type, payload = _validation_event(events)
    assert ev_type == "validation_passed", "a full exact-match sweep must pass"
    assert payload["accuracy"] == 1.0
    assert payload["failed_categories"] == []
    assert _final_validator_status(statuses) == "done"


def test_pass_threshold_is_exact_match():
    # The bar is exact match, not "any progress": this is the knob the board, the
    # mail, and the improve loop all agree on.
    assert validator_module.PASS_THRESHOLD == 1.0
