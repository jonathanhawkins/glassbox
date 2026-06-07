"""Regression tests: a fresh run/reset must clear stale beads before planning.

Stale beads (open OR blocked) left behind by a prior or interrupted run would
otherwise be claimed and worked into the next run's drain, inflating its score
and refilling the board after a reset. The fix routes every clear through
``beads.close_open()``, which sweeps the WHOLE graph (blocked beads too, which
``beads.ready()`` would miss):

  * ``run.run_cycle``       clears before it plans          (the /run path)
  * ``run.run_cycle_live``  clears before it plans          (the /live path)
  * ``server.post_reset``   closes every open bead, not just the ready ones

These tests monkeypatch the heavy collaborators (LLM, Redis bus, br CLI, oracle)
so they assert the orchestration contract offline and deterministically.
"""
from __future__ import annotations

from types import SimpleNamespace

from agents import run as run_module
from agents import server as server_module


def _fake_task():
    # run_cycle reaches the task only through patched collaborators; run_cycle_live
    # also reads task.skill.foundational to size the gap. A single-category coverage
    # ("ascii" == foundational) makes the gap empty, so the injection loop is a
    # no-op and the test stays focused on the clear-before-plan ordering.
    return SimpleNamespace(skill=SimpleNamespace(foundational="ascii"))


def _patch_orchestrator(monkeypatch, order):
    """Silence the bus/LLM/oracle and record the order of close_open vs plan."""
    monkeypatch.setattr(run_module.llm, "init_weave", lambda: None)
    monkeypatch.setattr(run_module.bus, "emit_type", lambda *a, **k: None)
    monkeypatch.setattr(run_module.bus, "set_agent_status", lambda *a, **k: None)
    monkeypatch.setattr(run_module.planner, "covered_categories", lambda cfg: ["ascii"])
    monkeypatch.setattr(
        run_module.worker, "accumulated_capabilities", lambda run_id: set()
    )
    monkeypatch.setattr(run_module, "_drain_graph", lambda *a, **k: 0)
    monkeypatch.setattr(
        run_module.validator,
        "validate",
        lambda *a, **k: {"accuracy": 0.5, "failing": [], "failed_categories": []},
    )

    def fake_close_open(reason=""):
        order.append("close_open")
        return 3

    def fake_plan(task, goal, run_id, planner_version=1, allowed_caps=None):
        order.append("plan")
        return []

    monkeypatch.setattr(run_module.beads, "close_open", fake_close_open)
    monkeypatch.setattr(run_module.planner, "plan", fake_plan)


def test_run_cycle_clears_stale_beads_before_planning(monkeypatch):
    order: list[str] = []
    _patch_orchestrator(monkeypatch, order)

    run_module.run_cycle(_fake_task(), "goal", "run-1", planner_version=1)

    assert "close_open" in order, "run_cycle must sweep stale beads (it did not)"
    assert order.index("close_open") < order.index(
        "plan"
    ), "run_cycle must clear stale beads BEFORE it plans the new graph"


def test_run_cycle_live_clears_stale_beads_before_planning(monkeypatch):
    order: list[str] = []
    _patch_orchestrator(monkeypatch, order)

    # injections=0 keeps us on the pre-plan clear, not the gap-injection beat.
    run_module.run_cycle_live(_fake_task(), "goal", "live-1", injections=0)

    assert "close_open" in order, "run_cycle_live must sweep stale beads (it did not)"
    assert order.index("close_open") < order.index(
        "plan"
    ), "run_cycle_live must clear stale beads BEFORE it plans the new graph"


def test_reset_closes_all_open_beads_not_just_ready(monkeypatch):
    # /reset must sweep the whole graph via close_open(), never iterate ready() to
    # drive the close: ready() misses blocked beads, which the poller would then
    # refill the board with. We make ready() explode to prove it is not used, and
    # assert the reported count comes straight from close_open().
    task = SimpleNamespace(restore_workspace=lambda: None, skill=None)
    monkeypatch.setattr(server_module, "_require_task", lambda name: task)
    monkeypatch.setattr(server_module.bus, "reset_state", lambda: {"cleared": True})
    monkeypatch.setattr(
        server_module.bus, "get_client", lambda: SimpleNamespace(set=lambda *a, **k: None)
    )
    monkeypatch.setattr(server_module, "_snapshot_beads", lambda: {})

    def ready_must_not_be_used():
        raise AssertionError(
            "reset must not close via beads.ready() (it misses blocked beads)"
        )

    monkeypatch.setattr(server_module.beads, "ready", ready_must_not_be_used)

    seen = {}

    def fake_close_open(reason=""):
        seen["reason"] = reason
        return 5

    monkeypatch.setattr(server_module.beads, "close_open", fake_close_open)

    # reset_skill=False so the skill/workspace machinery stays out of this test.
    out = server_module.post_reset(server_module.ResetRequest(reset_skill=False))

    assert out["beads_closed"] == 5, "reset must report close_open()'s full count"
    assert seen.get("reason"), "reset must pass a reason to close_open()"
