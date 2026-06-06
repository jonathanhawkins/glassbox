"""The orchestrator: one self-improving cycle, and the climbing loop of N cycles.

``run_cycle`` is a single Weave-traced session: it plans the goal into beads,
then drains the bead graph by repeatedly asking the coordinator to claim the
ready beads and having a worker implement each (which closes it and records its
category), then runs the real oracle validator. Because it is a ``@weave.op`` and
the planner/coordinator/worker/validator ops are themselves ``@weave.op``, the
Weave trace nests the whole cycle under one session tree.

``climb_loop`` runs N cycles using the improver's deterministic category schedule
so the leaderboard shows v1 < v2 < ... < vN (each cycle planning one more
category than the last), each cycle as its own run_id ``<run_base>-v<n>``.

Interface other pillars build on:
    run_cycle(goal, run_id, planner_version, allowed_caps) -> dict
    climb_loop(goal, run_base, versions) -> list[dict]
"""
from __future__ import annotations

from typing import Any, Iterable, Optional

from . import _paths

_paths.ensure_repo_root()
_paths.load_env()

import weave  # noqa: E402

from . import beads, bus, coordinator, improver, llm, planner, validator, worker  # noqa: E402

# Hard cap on coordinator/worker passes so a wedged graph can never spin forever.
# The canonical graph drains in 3 waves (ascii -> middle categories -> harness);
# this is a generous ceiling.
_MAX_PASSES = 32


@weave.op()
def run_cycle(
    goal: str,
    run_id: str,
    planner_version: int = 1,
    allowed_caps: Optional[Iterable[str]] = None,
) -> dict[str, Any]:
    """Run one full self-improving cycle and return its summary.

    Steps: weave.init (best effort) -> emit run_started + planner working ->
    planner.plan (creates beads) -> loop while beads.ready(): coordinator claims
    them and a worker implements each (closing it, accumulating its category) ->
    validator.validate (real oracle, leaderboard ZADD) -> emit run_finished.

    Returns {planner_version, accuracy, caps, beads, passes}.
    """
    llm.init_weave()

    allowed_list = sorted(allowed_caps) if allowed_caps is not None else None
    bus.emit_type(
        "run_started",
        run_id,
        planner_version=planner_version,
        agent="system",
        title=goal,
        payload={"allowed_caps": allowed_list},
    )
    bus.set_agent_status(run_id, "coordinator", "working", planner_version=planner_version)

    plan = planner.plan(goal, run_id, planner_version, allowed_caps=allowed_caps)
    # Map bead id -> capability so the worker gets the right category to record.
    cap_by_id = {b["id"]: b["capability"] for b in plan}

    passes = 0
    worked = 0
    while True:
        if not beads.ready():
            break
        passes += 1
        if passes > _MAX_PASSES:
            bus.emit_type(
                "log",
                run_id,
                planner_version=planner_version,
                agent="coordinator",
                title="coordinator hit max passes",
                payload={"passes": passes},
            )
            break
        assignments = coordinator.assign_ready(
            run_id, planner_version=planner_version
        )
        if not assignments:
            # Nothing claimable even though ready() was non-empty: avoid a spin.
            break
        for a in assignments:
            bead_id = a["bead_id"]
            capability = a.get("capability") or cap_by_id.get(bead_id, "")
            worker.run_bead(
                run_id,
                bead_id,
                capability,
                agent=a.get("assignee", "worker-1"),
                planner_version=planner_version,
            )
            worked += 1

    result = validator.validate(run_id, planner_version=planner_version)
    accuracy = float(result.get("accuracy", 0.0))
    caps = sorted(worker.accumulated_capabilities(run_id))

    bus.set_agent_status(run_id, "coordinator", "done", planner_version=planner_version)
    bus.emit_type(
        "run_finished",
        run_id,
        planner_version=planner_version,
        agent="system",
        title=f"accuracy={accuracy:.4f}",
        payload={
            "planner_version": planner_version,
            "accuracy": accuracy,
            "caps": caps,
            "beads_worked": worked,
            "failed_categories": result.get("failed_categories", []),
        },
    )

    return {
        "planner_version": planner_version,
        "accuracy": accuracy,
        "caps": caps,
        "beads": len(plan),
        "passes": passes,
    }


@weave.op()
def climb_loop(
    goal: str,
    run_base: str,
    versions: int = 5,
) -> list[dict[str, Any]]:
    """Run ``versions`` cycles with the improver schedule so the curve climbs.

    The improver spreads the 7 categories across ``versions`` cycles
    (``improver.schedule_for_versions``) so the schedule is monotonic and the
    LAST cycle always covers every category (accuracy 1.0). Cycle n (1-indexed)
    plans its allowed categories, runs a full ``run_cycle`` under run id
    ``<run_base>-v<n>``, and (except after the last) asks the improver to emit
    the planner_rewrite for the next version. So the leaderboard shows
    v1 < v2 < ... < vN with v1 low and vN ~ 1.0.

    Returns the list of per-cycle summaries (one dict per version).
    """
    llm.init_weave()
    v = max(1, int(versions))
    schedule = improver.schedule_for_versions(v)
    summaries: list[dict[str, Any]] = []
    for n in range(1, v + 1):
        run_id = f"{run_base}-v{n}"
        allowed = schedule[n - 1]
        summary = run_cycle(goal, run_id, planner_version=n, allowed_caps=allowed)
        summaries.append(summary)
        # Emit the planner_rewrite that schedules the next version (skip after
        # the last cycle). This bumps the version badge in the cockpit.
        if n < v:
            improver.improve(run_id, n, summary["accuracy"], caps=summary["caps"])
    return summaries


if __name__ == "__main__":
    import json
    import sys

    g = sys.argv[1] if len(sys.argv) > 1 else "port the BPE tokenizer to Rust"
    base = sys.argv[2] if len(sys.argv) > 2 else "dev"
    n = int(sys.argv[3]) if len(sys.argv) > 3 else 5
    out = climb_loop(g, base, n)
    print(json.dumps(out, indent=2))
    print("leaderboard:", bus.get_leaderboard())
