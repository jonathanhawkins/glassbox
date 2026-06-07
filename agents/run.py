"""The orchestrator: one cycle, the genuine self-improving loop, and a live beat.

``run_cycle`` is a single Weave-traced session: it plans the goal into beads (from
the planner SKILL coverage), then drains the bead graph by repeatedly asking the
coordinator to claim the ready beads and having a worker implement each (which
closes it and records its category), then runs the real oracle validator. Because
it is a ``@weave.op`` and the planner/coordinator/worker/validator ops are
themselves ``@weave.op``, the Weave trace nests the whole cycle under one session
tree.

``improve_loop`` is the GENUINE self-improvement loop and the source of the
climbing curve. It resets SKILL.md from the intentionally-incomplete baseline,
then repeats: plan from the CURRENT skill, run, validate, and (if not yet at 1.0)
have the improver REWRITE the skill to cover the next failing category. So the
skill materially evolves v1 -> vN on disk and the leaderboard climbs as a real
consequence of those rewrites. The whole loop is one ``@weave.op`` parent.

``run_cycle_live`` is the demo beat: plan from a deliberately incomplete skill,
validate (partial accuracy), then WITHIN the same run inject the top missing
category bead(s) (plan_gap_found -> beads.create -> bead_injected -> worker) and
re-validate so the accuracy visibly jumps. These are the events the cockpit
already animates.

``climb_loop`` is kept as a fallback: it runs N cycles on the improver's
deterministic prefix schedule (no skill rewriting).

Interface other pillars build on:
    run_cycle(goal, run_id, planner_version, allowed_caps) -> dict
    improve_loop(goal, run_base, max_versions) -> list[dict]
    run_cycle_live(goal, run_id) -> dict
    climb_loop(goal, run_base, versions) -> list[dict]
"""
from __future__ import annotations

from typing import Any, Iterable, Optional

from . import _paths

_paths.ensure_repo_root()
_paths.load_env()

import weave  # noqa: E402

from . import (  # noqa: E402
    beads,
    bus,
    coordinator,
    improver,
    llm,
    planner,
    skill,
    validator,
    worker,
)
# Hard cap on coordinator/worker passes so a wedged graph can never spin forever.
# The canonical graph drains in 3 waves (ascii -> middle categories -> harness);
# this is a generous ceiling.
_MAX_PASSES = 32


def _drain_graph(
    task: Any,
    run_id: str,
    planner_version: int,
    cap_by_id: dict[str, str],
) -> int:
    """Claim+work every ready bead until the graph drains. Returns beads worked.

    Each pass is ONE PARALLEL WAVE: ``coordinator.assign_ready`` claims every
    currently-ready bead and fans it round-robin across the worker pool (so all
    free workers light up at once, not one at a time), then the whole wave is
    worked TOGETHER: each claimed worker stays ``working`` through a single shared
    pace beat, and every bead finishes at the end of the beat. This is what makes
    the cockpit show genuine parallelism (the wide middle wave occupies all four
    workers simultaneously) instead of a single worker ticking through the beads.

    Repeats while ``beads.ready()`` is non-empty, bounded by ``_MAX_PASSES``.
    Honors GLASSBOX_PACE_MS so the board is watchable in the demo (0 overnight).
    """
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
        # Claim the whole ready wave at once: every ready bead is assigned to a
        # worker (round-robin) and that worker is flipped to ``working`` here.
        assignments = coordinator.assign_ready(
            run_id, planner_version=planner_version
        )
        if not assignments:
            # Nothing claimable even though ready() was non-empty: avoid a spin.
            break

        # Tag the claimed wave (the workers are already lit by assign_ready).
        for a in assignments:
            a["capability"] = a.get("capability") or cap_by_id.get(a["bead_id"], "")

        # One shared beat so the lit workers read as a wave on the board (demo only).
        worker._pace_sleep()

        # Implement the wave bead by bead. Each worker genuinely authors the source
        # for its bead (LLM with a deterministic fallback) and closes it; the edits
        # serialize on the shared workspace, so the source grows incrementally and
        # the board shows each feature land.
        for a in assignments:
            worker.complete_bead(
                task,
                run_id,
                a["bead_id"],
                a["capability"],
                agent=a.get("assignee", "worker-1"),
                planner_version=planner_version,
            )
            worked += 1

        # Settle every worker that took part in this wave back to idle, once.
        for w in {a.get("assignee", "worker-1") for a in assignments}:
            bus.set_agent_status(
                run_id, w, "idle", planner_version=planner_version
            )

        # A short gap before the next wave so the rail hand-off reads cleanly.
        worker._pace_sleep()
    return worked


@weave.op()
def run_cycle(
    task: Any,
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

    plan = planner.plan(task, goal, run_id, planner_version, allowed_caps=allowed_caps)
    # Map bead id -> capability so the worker gets the right group to author.
    cap_by_id = {b["id"]: b["capability"] for b in plan}

    worked = _drain_graph(task, run_id, planner_version, cap_by_id)

    result = validator.validate(task, run_id, planner_version=planner_version)
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
            "covered": planner.covered_categories(task.skill),
            "failed_categories": result.get("failed_categories", []),
        },
    )

    return {
        "planner_version": planner_version,
        "accuracy": accuracy,
        "caps": caps,
        "beads": len(plan),
        "covered": planner.covered_categories(task.skill),
        "failing": result.get("failing", []),
        "failed_categories": result.get("failed_categories", []),
    }


@weave.op()
def improve_loop(
    task: Any,
    goal: str,
    run_base: str = "auto",
    max_versions: int = 8,
) -> list[dict[str, Any]]:
    """The GENUINE self-improving loop: the curve climbs from real skill rewrites.

    At start, reset SKILL.md from the intentionally-incomplete baseline and
    snapshot it to history/v1.md. Then loop n = 1.. max_versions:

      * ``run_cycle(goal, run_id=f"{run_base}-v{n}", planner_version=n)`` plans
        from the CURRENT skill coverage, runs the workers, validates with the
        real oracle, and ZADDs the leaderboard;
      * record {version, accuracy, covered, weave_url};
      * if accuracy >= 1.0 (all categories covered) stop;
      * else ``improver.improve(...)`` REWRITES SKILL.md to cover the next failing
        category (and snapshots history/v{n+1}.md), so the next cycle plans one
        more category.

    SKILL.md persists on disk between cycles (the improver writes it; the planner
    reads it), so the evolution v1 -> vN is genuine and the leaderboard shows
    v1 < v2 < ... < vN topping out at 1.0. The whole loop is one ``@weave.op``
    parent, so Weave shows one self-improvement session with nested cycles.

    Returns the list of per-cycle summaries (one dict per version), each with
    ``version``, ``accuracy``, ``covered``, ``failed_categories``, ``weave_url``.
    """
    llm.init_weave()
    weave_url = _weave_url()

    # Always start from the incomplete baseline so there is real room to climb,
    # regardless of what a previous session left on disk.
    skill.reset_to_baseline(task.skill)
    skill.snapshot(1, cfg=task.skill)

    base = run_base if run_base and run_base != "auto" else _auto_base("improve")
    cap = max(1, int(max_versions))

    summaries: list[dict[str, Any]] = []
    for n in range(1, cap + 1):
        run_id = f"{base}-v{n}"
        covered_before = planner.covered_categories(task.skill)
        # Clear any leftover beads (from a prior/interrupted run or the previous
        # version) so this version's drain works ONLY its own freshly-planned graph;
        # otherwise stale ready beads get worked in and inflate the score.
        beads.close_open(reason=f"cleared before {run_id}")
        # Each version builds its plan FRESH from the baseline source, so the genuine
        # per-bead authoring is coherent (no carry-over from the previous version's
        # source) and the version's score reflects exactly the skill's current
        # coverage. The skill (the planner's strategy) is what persists and grows.
        task.reset_workspace()
        summary = run_cycle(task, goal, run_id, planner_version=n)
        task.snapshot_workspace(n)
        accuracy = float(summary["accuracy"])
        failing = summary.get("failing", [])
        failed = [f["category"] for f in failing] or _failed_categories_for(
            task, run_id, summary
        )
        summaries.append(
            {
                "version": n,
                "run_id": run_id,
                "accuracy": accuracy,
                "covered": covered_before,
                "failed_categories": failed,
                "weave_url": weave_url,
            }
        )
        if accuracy >= 1.0:
            break
        # Genuine rewrite: grow the skill to cover the BIGGEST failing gap (from
        # the eval breakdown), which varies run to run.
        improver.improve(
            task, run_id, n, accuracy, failed_categories=failed, failing=failing
        )

    return summaries


@weave.op()
def run_cycle_live(
    task: Any,
    goal: str,
    run_id: str = "live",
    planner_version: int = 1,
    injections: int = 2,
) -> dict[str, Any]:
    """The live demo beat: plan incomplete, then inject gaps so accuracy JUMPS.

    Plans from a DELIBERATELY incomplete coverage (the current SKILL coverage
    minus its top 1-2 categories, but always keeping ``ascii``), runs the workers,
    and validates for a partial accuracy. Then, WITHIN the same run, for each top
    gap category (bounded by ``injections``):

      * emit ``plan_gap_found`` (the cockpit pulses planner + improver),
      * create the missing-category bead via ``beads.create``,
      * emit ``bead_injected`` (the cockpit shows a glowing injected bead),
      * have a worker run it (accumulating the capability),
      * re-validate so the accuracy visibly jumps.

    Returns {run_id, before, after, injected, steps} where ``steps`` is the
    per-injection accuracy trail. Bounded and quick: at most ``injections`` beads
    are added. Honors GLASSBOX_PACE_MS for a watchable board.
    """
    llm.init_weave()

    full = planner.covered_categories(task.skill)
    # Drop the top 1-2 covered groups (after the foundational one) to manufacture a
    # visible gap, but always plan foundational + structural + whatever remains.
    droppable = [c for c in full if c != task.skill.foundational]
    k = max(1, min(int(injections), len(droppable)))
    to_inject = droppable[-k:]  # the highest-index covered cats become the gap
    start_caps = [c for c in full if c not in set(to_inject)]

    bus.emit_type(
        "run_started",
        run_id,
        planner_version=planner_version,
        agent="system",
        title=goal,
        payload={"mode": "live", "start_caps": start_caps, "gap": to_inject},
    )
    bus.set_agent_status(
        run_id, "coordinator", "working", planner_version=planner_version
    )

    plan = planner.plan(
        task, goal, run_id, planner_version, allowed_caps=start_caps
    )
    cap_by_id = {b["id"]: b["capability"] for b in plan}
    _drain_graph(task, run_id, planner_version, cap_by_id)

    before = float(
        validator.validate(task, run_id, planner_version=planner_version).get(
            "accuracy", 0.0
        )
    )

    steps: list[dict[str, Any]] = []
    injected: list[str] = []
    current_acc = before
    for category in to_inject:
        # 1) Diagnose the gap (cockpit pulses planner + improver). Report the
        # accuracy as it stands right now so each gap event reads honestly.
        bus.emit_type(
            "plan_gap_found",
            run_id,
            planner_version=planner_version,
            agent="improver",
            title=f"gap: {category} failing (accuracy {current_acc:.2f})",
            payload={"category": category, "accuracy": current_acc},
        )
        worker._pace_sleep()

        # 2) Inject the missing-category bead (depends on the ascii foundation so
        # the wiring is honest: it only becomes ready once ascii is closed).
        title = skill.canonical_title(category)
        ascii_id = next(
            (b["id"] for b in plan if b["capability"] == task.skill.foundational), None
        )
        dep_ids = [ascii_id] if ascii_id else None
        bead_id = beads.create(
            title,
            body=f"capability={category}",
            btype="task",
            priority=1,
            deps=dep_ids,
        )
        cap_by_id[bead_id] = category
        bus.emit_type(
            "bead_injected",
            run_id,
            planner_version=planner_version,
            agent="improver",
            bead_id=bead_id,
            title=title,
            payload={"capability": category},
        )
        worker._pace_sleep()

        # 3) A worker implements the injected bead (accumulates the capability).
        coordinator.assign_ready(run_id, planner_version=planner_version)
        worker.run_bead(
            task,
            run_id,
            bead_id,
            category,
            agent="worker-1",
            planner_version=planner_version,
        )
        injected.append(category)

        # 4) Re-validate: the accuracy visibly jumps.
        acc = float(
            validator.validate(task, run_id, planner_version=planner_version).get(
                "accuracy", 0.0
            )
        )
        steps.append({"injected": category, "accuracy": acc})
        current_acc = acc

    after = steps[-1]["accuracy"] if steps else before
    caps = sorted(worker.accumulated_capabilities(run_id))

    bus.set_agent_status(
        run_id, "coordinator", "done", planner_version=planner_version
    )
    bus.emit_type(
        "run_finished",
        run_id,
        planner_version=planner_version,
        agent="system",
        title=f"accuracy {before:.2f} -> {after:.2f}",
        payload={
            "mode": "live",
            "accuracy": after,
            "before": before,
            "after": after,
            "injected": injected,
            "caps": caps,
        },
    )

    return {
        "run_id": run_id,
        "before": before,
        "after": after,
        "injected": injected,
        "steps": steps,
        "caps": caps,
    }


@weave.op()
def climb_loop(
    task: Any,
    goal: str,
    run_base: str,
    versions: int = 5,
) -> list[dict[str, Any]]:
    """Fallback loop: ``versions`` cycles on a deterministic prefix schedule.

    Kept as a fallback to ``improve_loop`` (which is the genuine skill-rewriting
    loop). The improver spreads the 7 categories across ``versions`` cycles
    (``improver.schedule_for_versions``) so the schedule is monotonic and the
    LAST cycle always covers every category (accuracy 1.0). Cycle n plans its
    allowed categories via ``allowed_caps`` (so it does NOT rewrite the skill),
    runs a full ``run_cycle`` under run id ``<run_base>-v<n>``, and emits a
    lightweight ``planner_rewrite`` to bump the version badge.

    Returns the list of per-cycle summaries (one dict per version).
    """
    llm.init_weave()
    v = max(1, int(versions))
    schedule = improver.schedule_for_versions(v)
    summaries: list[dict[str, Any]] = []
    for n in range(1, v + 1):
        run_id = f"{run_base}-v{n}"
        allowed = schedule[n - 1]
        summary = run_cycle(task, goal, run_id, planner_version=n, allowed_caps=allowed)
        summaries.append(summary)
        # Bump the version badge for the next cycle (no skill rewrite here).
        if n < v:
            next_allowed = schedule[n]
            added = [c for c in next_allowed if c not in allowed]
            bus.emit_type(
                "planner_rewrite",
                run_id,
                planner_version=n + 1,
                agent="improver",
                title=f"planner v{n + 1} adds {added[0] if added else 'nothing'}",
                payload={
                    "from_version": n,
                    "to_version": n + 1,
                    "added_category": added[0] if added else None,
                    "next_allowed_caps": next_allowed,
                },
            )
    return summaries


def _weave_url() -> str:
    """Best-effort Weave project URL for the current entity/project."""
    import os

    entity = os.environ.get("WANDB_ENTITY", "").strip()
    project = os.environ.get(
        "WEAVE_PROJECT", os.environ.get("WANDB_PROJECT", "glassbox")
    ).strip()
    if entity:
        return f"https://wandb.ai/{entity}/{project}/weave"
    return f"https://wandb.ai/{project}/weave"


def _auto_base(prefix: str) -> str:
    """A unique-ish run_base when the caller did not provide one."""
    import time

    return f"{prefix}-{int(time.time())}"


def _failed_categories_for(
    task: Any, run_id: str, summary: dict[str, Any]
) -> list[str]:
    """Derive the failing groups for a finished cycle.

    Uses the run's accumulated caps (from the summary) to compute the task's scoring
    groups not yet covered. This is what the validator reports, recomputed here so
    ``improve_loop`` does not need to thread the validator's full result through
    ``run_cycle``.
    """
    caps = set(summary.get("caps", []))
    return [c for c in task.groups if c not in caps]


if __name__ == "__main__":
    import json
    import sys

    from tasks import load_task

    task = load_task(sys.argv[4] if len(sys.argv) > 4 else "tokenizer")
    g = sys.argv[1] if len(sys.argv) > 1 else task.goal
    base = sys.argv[2] if len(sys.argv) > 2 else "dev"
    n = int(sys.argv[3]) if len(sys.argv) > 3 else 8
    try:
        out = improve_loop(task, g, base, n)
        print(json.dumps(out, indent=2))
        print("leaderboard:", bus.get_leaderboard())
    finally:
        # Leave the workspace green at rest even if the loop raised.
        task.restore_workspace()
