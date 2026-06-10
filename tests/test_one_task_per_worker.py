"""Regression tests: a single coordinator wave hands each worker at most one bead.

The cockpit board parks a claimed bead in its worker's dock until the worker closes
it. If ``coordinator.assign_ready`` round-robins MORE ready beads than there are
workers in one wave, a worker gets a second bead stacked in its dock, i.e. it appears
to be working two tasks at once. The fix caps a wave at one bead per worker; the ready
beads beyond the pool size wait and are claimed in the next wave (once a worker frees
up by closing its current bead). These tests prove that cap and prove nothing is
dropped or double-claimed.

They monkeypatch the heavy collaborators (br CLI, Redis bus) so they assert the
assignment contract offline and deterministically, like tests/test_stale_beads.py.
"""
from __future__ import annotations

from agents import coordinator


def _fake_beads(n: int) -> list[dict[str, str]]:
    """n ready rows shaped like ``br ready --json`` (id + title + a capability tag)."""
    return [
        {"id": f"bead-{i}", "title": f"task {i}", "description": f"capability=cat{i}"}
        for i in range(n)
    ]


def _silence_side_effects(monkeypatch, ready_rows):
    """Stub br/Redis so assign_ready runs with no subprocess or network, feeding it
    ``ready_rows`` from ``beads.ready()``. Returns the list of claimed ids (in order),
    which mirrors what the real ``br`` claim would mark in_progress."""
    claimed: list[str] = []
    monkeypatch.setattr(coordinator.beads, "ready", lambda: list(ready_rows))
    monkeypatch.setattr(
        coordinator.beads, "claim", lambda bead_id, assignee="": claimed.append(bead_id)
    )
    monkeypatch.setattr(coordinator.bus, "emit_type", lambda *a, **k: None)
    monkeypatch.setattr(coordinator.bus, "emit_mail", lambda *a, **k: None)
    monkeypatch.setattr(coordinator.bus, "set_agent_status", lambda *a, **k: None)
    return claimed


def test_wave_caps_at_one_bead_per_worker(monkeypatch):
    # 6 ready beads against the 4-worker pool: one wave must claim 4 (one each), not 6.
    pool = coordinator.DEFAULT_WORKERS  # worker-1..worker-4
    _silence_side_effects(monkeypatch, _fake_beads(6))
    coordinator._next_worker = 0  # deterministic rotation start

    assignments = coordinator.assign_ready("run-1", planner_version=1)

    assert len(assignments) == len(pool), (
        "one wave must claim at most one bead per worker, not the whole ready set"
    )
    assignees = [a["assignee"] for a in assignments]
    assert len(set(assignees)) == len(assignments), (
        "no worker may be handed two beads in the same wave"
    )
    assert set(assignees) == set(pool), "a full wave should light every worker once"


def test_leftover_beads_are_claimed_next_wave(monkeypatch):
    # Wave 1 claims 4 of 6; the real br marks those in_progress so the next ready()
    # returns only the remaining 2. Simulate that and assert the second wave claims
    # exactly those two: nothing dropped, nothing double-claimed, no deadlock.
    all_beads = _fake_beads(6)
    claimed = _silence_side_effects(monkeypatch, all_beads)
    coordinator._next_worker = 0

    first = coordinator.assign_ready("run-1", planner_version=1)
    assert len(first) == 4

    # ready() now returns only the beads not yet claimed (mirrors the in_progress drop).
    remaining = [b for b in all_beads if b["id"] not in set(claimed)]
    monkeypatch.setattr(coordinator.beads, "ready", lambda: list(remaining))

    second = coordinator.assign_ready("run-1", planner_version=1)
    assert len(second) == 2, "the leftover ready beads must be claimed in the next wave"
    assert {a["bead_id"] for a in second} == {b["id"] for b in remaining}
    # Every one of the 6 beads got claimed across the two waves, none twice.
    assert sorted(claimed) == sorted(b["id"] for b in all_beads)


def test_narrow_wave_assigns_only_what_is_ready(monkeypatch):
    # Fewer ready beads than workers: claim them all (no padding to the pool size),
    # each on a distinct worker. Guards against the cap mis-firing on small waves.
    _silence_side_effects(monkeypatch, _fake_beads(2))
    coordinator._next_worker = 0

    assignments = coordinator.assign_ready("run-1", planner_version=1)

    assert len(assignments) == 2
    assert len({a["assignee"] for a in assignments}) == 2
