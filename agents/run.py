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

# Cooperative cancellation. The cockpit's Stop button sets this flag; the run
# loops check it at each wave/version boundary and bail out cleanly (never
# mid-bead), so the workspace is never left torn. The server clears it before
# every new run so a stale stop can never abort the next launch.
import threading  # noqa: E402

_CANCEL = threading.Event()

# Cooperative pause. The cockpit's Pause button sets this; the run loops block at
# the next wave/version boundary (inside cancel_requested) and resume in place
# when the operator hits Play again. Cancel always wins over a pause, so Stop
# during a pause still ends the run cleanly. _RESUME starts set (not paused).
_PAUSE = threading.Event()
_RESUME = threading.Event()
_RESUME.set()


def request_cancel() -> None:
    """Ask the in-flight run to stop at the next wave/version boundary."""
    _CANCEL.set()
    # A cancel must wake any boundary currently parked in a pause so it can exit.
    _PAUSE.clear()
    _RESUME.set()


def clear_cancel() -> None:
    """Clear the cancel flag and any stale pause (called before each new run)."""
    _CANCEL.clear()
    _PAUSE.clear()
    _RESUME.set()


def request_pause() -> None:
    """Ask the in-flight run to hold at the next wave/version boundary."""
    _PAUSE.set()
    _RESUME.clear()


def resume() -> None:
    """Release a paused run so it continues from where it parked."""
    _PAUSE.clear()
    _RESUME.set()


def is_paused() -> bool:
    return _PAUSE.is_set()


def cancel_requested() -> bool:
    # Boundary checkpoint. Block here while paused so the run halts cleanly at a
    # wave/version edge (never mid-bead) and picks up in place on resume. Cancel
    # short-circuits the wait so Stop still wins during a pause.
    while _PAUSE.is_set() and not _CANCEL.is_set():
        _RESUME.wait(timeout=0.3)
    return _CANCEL.is_set()


def _drain_graph(
    task: Any,
    run_id: str,
    planner_version: int,
    cap_by_id: dict[str, str],
) -> int:
    """Claim+work every ready bead until the graph drains. Returns beads worked.

    Each pass is ONE PARALLEL WAVE: ``coordinator.assign_ready`` claims up to one
    bead per free worker and fans them round-robin across the worker pool (so all
    free workers light up at once, one task each, not one worker at a time), then
    the whole wave is worked TOGETHER: each claimed worker stays ``working`` through
    a single shared pace beat, and every bead finishes at the end of the beat. This
    is what makes the cockpit show genuine parallelism (a wide middle wave occupies
    all four workers simultaneously) without ever stacking two tasks on one worker;
    any ready beads beyond the pool size are claimed in the next wave, once a worker
    frees up.

    Repeats while ``beads.ready()`` is non-empty, bounded by a pass ceiling scaled
    to the plan size (so a wide graph still fully drains under the one-per-worker
    cadence). Honors GLASSBOX_PACE_MS so the board is watchable in the demo (0
    overnight).
    """
    # Each wave now assigns at most one bead per worker (one task per worker at a
    # time), so an N-bead graph needs ~ceil(N / pool) waves instead of ~3. Bound the
    # passes from the plan size (each non-empty pass closes >= 1 bead) so a wide graph
    # still fully drains; keep the old 32 as a generous floor for the canonical case.
    max_passes = max(_MAX_PASSES, len(cap_by_id) + 8)
    passes = 0
    worked = 0
    while True:
        if cancel_requested():
            bus.emit_type(
                "log",
                run_id,
                planner_version=planner_version,
                agent="system",
                title="run stopped by operator",
                payload={"passes": passes},
            )
            break
        if not beads.ready():
            break
        passes += 1
        if passes > max_passes:
            bus.emit_type(
                "log",
                run_id,
                planner_version=planner_version,
                agent="coordinator",
                title="coordinator hit max passes",
                payload={"passes": passes, "max_passes": max_passes},
            )
            break
        # Claim this wave: up to one ready bead per free worker is assigned (round-
        # robin) and that worker is flipped to ``working`` here. Ready beads beyond
        # the pool size wait for the next wave, so no worker gets two at once.
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
    close_open (clear stale beads from a prior/interrupted run) -> planner.plan
    (creates beads) -> loop while beads.ready(): coordinator claims them and a
    worker implements each (closing it, accumulating its category) ->
    validator.validate (real oracle, leaderboard ZADD) -> emit run_finished.

    Returns {planner_version, accuracy, caps, beads, passes}.
    """
    llm.init_weave()
    # Stamp every event this cycle emits with the build target, so the per-task
    # cockpit applies only the events for the task it is showing.
    bus.bind_task(getattr(task, "name", None))

    allowed_list = sorted(allowed_caps) if allowed_caps is not None else None
    bus.emit_type(
        "run_started",
        run_id,
        planner_version=planner_version,
        agent="system",
        title=goal,
        payload={"allowed_caps": allowed_list},
        # The self-improving cycle is a climb loop: push accuracy while it improves.
        archetype="climb",
    )
    bus.set_agent_status(run_id, "coordinator", "working", planner_version=planner_version)

    # Clear any stale beads (from a prior or interrupted run) BEFORE planning, so the
    # drain works ONLY this cycle's freshly-planned graph. close_open() sweeps the
    # whole graph including blocked beads, which ready() would miss; without this,
    # leftover ready beads get claimed and worked into this run and inflate its score.
    beads.close_open(reason=f"cleared before {run_id}")

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
    # Bind the build target for the whole climb so improver rewrites and any
    # between-cycle events are stamped with this task too (run_cycle re-binds it).
    bus.bind_task(getattr(task, "name", None))
    weave_url = _weave_url()

    # Start a climb with a trim beads WAL so a long run's many bead writes cannot
    # slow to a crawl on an inherited, bloated write-ahead log.
    beads.checkpoint_wal()

    # Always start from the incomplete baseline so there is real room to climb,
    # regardless of what a previous session left on disk.
    skill.reset_to_baseline(task.skill)
    skill.snapshot(1, cfg=task.skill)
    # Clear any prior climb's per-version code snapshots so the code viewer shows
    # only this climb's v1..vN (the analog of the skill history reset above).
    task.reset_workspace_history()
    # Same intent for the leaderboard: drop this task's prior scores + version
    # metadata so the curve and the ranked panel show ONLY this climb's v1..vN. A
    # shorter climb must not inherit a longer prior climb's trailing versions.
    bus.clear_leaderboard(getattr(task, "name", None) or "tokenizer")

    base = run_base if run_base and run_base != "auto" else _auto_base("improve")
    cap = max(1, int(max_versions))

    summaries: list[dict[str, Any]] = []
    for n in range(1, cap + 1):
        run_id = f"{base}-v{n}"
        if cancel_requested():
            bus.emit_type(
                "log", run_id, planner_version=n, agent="system",
                title="run stopped by operator", payload={"version": n},
            )
            break
        covered_before = planner.covered_categories(task.skill)
        # run_cycle clears any leftover beads (from a prior/interrupted run or the
        # previous version) before it plans, so this version's drain works ONLY its
        # own freshly-planned graph. Each version also builds its plan FRESH from the
        # baseline source, so the genuine per-bead authoring is coherent (no carry-over
        # from the previous version's source) and the version's score reflects exactly
        # the skill's current coverage. The skill (the planner's strategy) is what
        # persists and grows.
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
        # Stop only when EVERY scoring category is covered (the PRD end state: all
        # classes listed, oracle 1.0), not merely when accuracy hits 1.0. Some
        # classes are delivered by a branch another class adds (the tokenizer's
        # code/emoji ride on punctuation's symbol-run branch), so accuracy can reach
        # 1.0 while a class is still unlisted; stopping at 1.0 would leave the
        # converged skill short of full coverage and the cockpit showing a grey tile.
        if set(planner.covered_categories(task.skill)) >= set(task.groups):
            break
        # Genuine rewrite: grow the skill to cover the BIGGEST failing gap (from the
        # eval breakdown), which varies run to run; once accuracy is already 1.0,
        # cover the next still-unlisted class to complete coverage.
        improver.improve(
            task, run_id, n, accuracy, failed_categories=failed, failing=failing
        )

    return summaries


@weave.op()
def byo_loop(
    task: Any,
    goal: str,
    run_base: str = "auto",
    max_rounds: int = 4,
) -> list[dict[str, Any]]:
    """The bring-your-own-repo loop: the curve is the live test pass-rate climbing
    as beads close, across re-attempt rounds. NO skill rewrite, NO improver, NO
    deterministic fallback (the worker's BYO branch enforces that).

    Round 1 plans one bead per discovered failing module and drains it. Each later
    round re-attempts ONLY the still-failing modules (so the model gets fresh tries
    at what it has not cracked yet), accumulating fixes on the same sandbox. Stops
    when the suite is green or a round adds no score (fixed point).

    Returns the per-round summaries (version == round number, so the existing curve
    and leaderboard UI render it unchanged).
    """
    llm.init_weave()
    bus.bind_task(getattr(task, "name", None))
    bus.clear_leaderboard(getattr(task, "name", None) or "byo")
    # Start each climb from the pristine baseline repo so the cycle count visibly falls
    # from the top, clear the prior climb's code snapshots, and reset the integrity
    # counters the cockpit panel reads. reset_workspace is a no-op without a reset_fn.
    task.reset_workspace()
    task.reset_workspace_history()
    bus.clear_integrity(getattr(task, "name", None) or "byo")

    base = run_base if run_base and run_base != "auto" else _auto_base("byo")
    summaries: list[dict[str, Any]] = []

    if not task.groups:
        # The suite is already green: nothing to fix. Validate once for the record.
        run_id = f"{base}-v1"
        result = validator.validate(task, run_id, planner_version=1)
        return [
            {
                "version": 1,
                "run_id": run_id,
                "accuracy": float(result.get("accuracy", 1.0)),
                "failed_categories": [],
            }
        ]

    rounds = max(1, int(max_rounds))
    remaining = list(task.groups)
    last_acc = -1.0
    for n in range(1, rounds + 1):
        run_id = f"{base}-v{n}"
        if cancel_requested():
            bus.emit_type(
                "log", run_id, planner_version=n, agent="system",
                title="run stopped by operator", payload={"version": n},
            )
            break
        # Round 1 plans the full discovered set; later rounds re-attempt only what is
        # still failing, so the model spends its tries where they are needed.
        allowed = None if n == 1 else remaining
        summary = run_cycle(task, goal, run_id, planner_version=n, allowed_caps=allowed)
        task.snapshot_workspace(n)
        accuracy = float(summary["accuracy"])
        remaining = list(summary.get("failed_categories", []))
        summaries.append(
            {
                "version": n,
                "run_id": run_id,
                "accuracy": accuracy,
                "failed_categories": remaining,
            }
        )
        # Stop on green or a fixed point (a round that did not raise the score).
        if accuracy >= 1.0 or not remaining or accuracy <= last_acc:
            break
        last_acc = accuracy

    return summaries


def _primary_metric(result: Any) -> float:
    """The continuous, higher-is-better objective the optimize loop climbs.

    Reads the evaluator's task-specific metric (speedkit mean speedup, perf cycles) and
    falls back to the 0..1 score for evaluators that expose neither.
    """
    ex = getattr(result, "extra", {}) or {}
    if ex.get("mean_speedup") is not None:
        return float(ex["mean_speedup"])
    if ex.get("speedup"):
        return float(ex["speedup"])
    if ex.get("cycles"):
        return -float(ex["cycles"])  # fewer cycles is a higher objective
    return float(getattr(result, "score", 0.0))


def _all_correct(result: Any) -> bool:
    """Whether the artifact is still correct (never keep a faster-but-wrong edit)."""
    ex = getattr(result, "extra", {}) or {}
    per = ex.get("per_fn")
    if isinstance(per, dict) and per:
        return all(bool(v.get("correct")) for v in per.values())
    if ex.get("correct") is not None:
        return bool(ex["correct"])
    return bool(getattr(result, "score", 0.0) > 0) and not getattr(result, "error", "")


def _opt_curve_score(result: Any, metric: float) -> float:
    """A 0..1 value for the existing leaderboard curve: the evaluator score when it is
    below full, else a log-scaled metric so the curve keeps climbing past 1.0."""
    import math

    score = float(getattr(result, "score", 0.0))
    if 0.0 < score < 1.0:
        return score
    return max(0.0, min(1.0, math.log(max(metric, 1.0)) / math.log(1000.0)))


_OPT_WORKERS = ["worker-1", "worker-2", "worker-3", "worker-4"]


def _opt_guidance(idea: str) -> list[dict[str, str]]:
    """The worker prompt for one optimization idea: build on the current best."""
    return [
        {
            "group": "optimize",
            "test": "idea",
            "message": (
                "The code shown is the current BEST version, already optimized in "
                "places. Apply this optimization and KEEP every existing speedup intact "
                "(never revert a function to a slower version; return the complete "
                "file). Idea: " + idea
            ),
        }
    ]


@weave.op()
def optimize_loop(
    task: Any,
    goal: str,
    run_base: str = "auto",
    max_rounds: int = 12,
    patience: int = 3,
) -> list[dict[str, Any]]:
    """Open-ended optimization: keep proposing NEW ideas and keep the ones the real
    grader confirms are correct AND strictly better, until ``patience`` rounds in a row
    fail to improve (genuinely stuck).

    Unlike ``byo_loop`` (which stops at a fixed bar) this has NO target: each round the
    ideator proposes a fresh optimization from the current best code plus the full
    history of what has and has not worked; the worker applies it; the frozen grader
    keeps it only if it is correct and the continuous metric strictly rises, else it is
    reverted. Each kept improvement is a new leaderboard version, so the curve climbs
    and then plateaus at the genuine ceiling the model can reach.
    """
    from concurrent.futures import ThreadPoolExecutor

    from . import ideator

    llm.init_weave()
    name = getattr(task, "name", None)
    bus.bind_task(name)
    bus.clear_leaderboard(name or "optimize")
    task.reset_workspace()
    task.reset_workspace_history()
    bus.clear_integrity(name or "optimize")
    base = run_base if run_base and run_base != "auto" else _auto_base("opt")

    target = (getattr(task, "edit_targets", []) or [""])[0]
    best = task.evaluate()
    best_metric = _primary_metric(best)
    best_src = task.read_target(target)
    n_ideas = len(_OPT_WORKERS)  # one idea per worker lane, fanned out each round
    min_gain = 1.05  # require a real (>5%) rise so timing noise is not "progress"

    bus.emit_type(
        "run_started", f"{base}-r1", planner_version=1, agent="system", title=goal,
        payload={"mode": "optimize", "metric": best_metric, "baseline_metric": best_metric},
        archetype="climb",
    )

    tried: list[dict[str, Any]] = []
    summaries: list[dict[str, Any]] = []
    stale = 0
    version = 0
    for n in range(1, max(1, int(max_rounds)) + 1):
        run_id = f"{base}-r{n}"
        if cancel_requested():
            bus.emit_type(
                "log", run_id, planner_version=version or 1, agent="system",
                title="run stopped by operator", payload={"round": n},
            )
            break
        pv = version + 1
        task.write_target(target, best_src)  # every worker authors from the current best

        # PLANNER fans out a batch of distinct ideas, one bead per idea.
        bus.set_agent_status(run_id, "planner", "working", planner_version=pv)
        bus.emit_type(
            "plan_started", run_id, planner_version=pv, agent="planner",
            title=f"round {n}: {n_ideas} ideas", payload={"round": n, "metric": best_metric},
        )
        ideas = ideator.propose_ideas(task, best_src, best_metric, tried, n=n_ideas)
        items: list[dict[str, Any]] = []
        for i, idea in enumerate(ideas[:n_ideas]):
            bid = f"{run_id}-i{i + 1}"
            wk = _OPT_WORKERS[i % len(_OPT_WORKERS)]
            bus.emit_type(
                "bead_created", run_id, planner_version=pv, agent="planner",
                bead_id=bid, title=idea[:60],
                payload={"capability": "optimize", "idea": idea},
            )
            items.append({"bead_id": bid, "idea": idea, "worker": wk})
        bus.set_agent_status(run_id, "planner", "done", planner_version=pv)

        # COORDINATOR assigns each idea to a worker; the assigned workers light up.
        bus.set_agent_status(run_id, "coordinator", "working", planner_version=pv)
        for it in items:
            bus.emit_type(
                "bead_claimed", run_id, planner_version=pv, agent="coordinator",
                bead_id=it["bead_id"], title=it["idea"][:60],
                payload={"capability": "optimize", "assignee": it["worker"]},
            )
            bus.set_agent_status(run_id, it["worker"], "working", planner_version=pv)
        bus.set_agent_status(run_id, "coordinator", "done", planner_version=pv)
        worker._pace_sleep()

        # WORKERS author candidates in parallel (read-only on the shared best source).
        with ThreadPoolExecutor(max_workers=max(1, len(items))) as ex:
            proposals = list(
                ex.map(
                    lambda it: worker._byo_author_llm(
                        task, "optimize", _opt_guidance(it["idea"])
                    ),
                    items,
                )
            )

        # VALIDATOR grades each candidate against the real oracle (serialized on disk).
        bus.set_agent_status(run_id, "validator", "working", planner_version=pv)
        candidates: list[dict[str, Any]] = []
        for it, proposed in zip(items, proposals):
            cand = proposed.get(target) if proposed else None
            if cand and cand.strip():
                task.write_target(target, cand)
                res = task.evaluate()
                m, correct = _primary_metric(res), _all_correct(res)
                task.write_target(target, best_src)  # revert; winner committed below
            else:
                m, correct = best_metric, False
            candidates.append({**it, "src": cand, "metric": m, "correct": correct})
            bus.emit_type(
                "bead_done", run_id, planner_version=pv, agent=it["worker"],
                bead_id=it["bead_id"], title=(f"{m:.2f}x" if cand else "no edit"),
                payload={
                    "capability": "optimize", "idea": it["idea"],
                    "metric": m, "correct": correct,
                },
            )
            bus.set_agent_status(run_id, it["worker"], "idle", planner_version=pv)
        bus.set_agent_status(run_id, "validator", "done", planner_version=pv)
        worker._pace_sleep()

        # IMPROVER keeps the single best correct gain that clears the bar.
        bus.set_agent_status(run_id, "improver", "working", planner_version=pv)
        viable = [
            c for c in candidates
            if c["src"] and c["correct"] and c["metric"] > best_metric * min_gain
        ]
        winner = max(viable, key=lambda c: c["metric"]) if viable else None
        if winner is not None:
            version += 1
            task.write_target(target, winner["src"])  # commit the winner to disk
            res2 = task.evaluate()
            best_metric, best_src = _primary_metric(res2), winner["src"]
            bus.set_planner_score(version, _opt_curve_score(res2, best_metric), task=name)
            bus.set_planner_meta(
                name, version, accuracy=float(res2.score), status="partial",
                extra=(res2.extra or None), idea=winner["idea"],
            )
            bus.emit_type(
                "validation_passed", run_id, planner_version=version, agent="validator",
                title=f"metric={best_metric:.2f}",
                payload={"metric": best_metric, "idea": winner["idea"], "extra": res2.extra},
            )
            bus.emit_type(
                "plan_gap_found", run_id, planner_version=version, agent="improver",
                title=f"kept: {winner['idea'][:56]}",
                payload={"idea": winner["idea"], "metric": best_metric, "kept": True},
            )
            stale = 0
        else:
            stale += 1
            bus.emit_type(
                "validation_failed", run_id, planner_version=max(version, 1), agent="validator",
                title=f"no gain ({stale}/{patience})",
                payload={"metric": best_metric, "round": n},
            )
        bus.set_agent_status(run_id, "improver", "done", planner_version=pv)

        for c in candidates:
            tried.append({
                "idea": c["idea"], "metric": c["metric"],
                "kept": winner is not None and c["bead_id"] == winner["bead_id"],
            })
        summaries.append({
            "round": n, "version": version, "metric": best_metric,
            "ideas": [c["idea"] for c in candidates],
            "kept": (winner["idea"] if winner else None),
        })
        if stale >= max(1, int(patience)):
            bus.emit_type(
                "run_finished", run_id, planner_version=max(version, 1), agent="system",
                title=f"stuck at {best_metric:.2f}x after {n} rounds",
                payload={"metric": best_metric, "rounds": n, "stuck": True},
            )
            break

    task.write_target(target, best_src)  # leave the best version on disk
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
    # Stamp every event this beat emits with the build target (per-task cockpit).
    bus.bind_task(getattr(task, "name", None))

    full = planner.covered_categories(task.skill)
    # Manufacture the gap from SCORE-MOVING groups only: drop the foundational group
    # (everything needs it) and any "free" group the task flags as adding no
    # independent capability (the tokenizer's code/emoji, which punctuation's
    # symbol-run branch already tokenizes). Injecting a free group back would not move
    # the number, so excluding them keeps every before/after jump real. The free
    # groups stay in start_caps (they are already green), so the plan still covers
    # them.
    free = set(getattr(task, "free_groups", set()) or set())
    droppable = [c for c in full if c != task.skill.foundational and c not in free]
    if not droppable:  # degenerate: everything is foundational/free, fall back
        droppable = [c for c in full if c != task.skill.foundational]
    k = max(1, min(int(injections), len(droppable)))
    to_inject = droppable[-k:]  # the highest-index score-moving cats become the gap
    start_caps = [c for c in full if c not in set(to_inject)]

    bus.emit_type(
        "run_started",
        run_id,
        planner_version=planner_version,
        agent="system",
        title=goal,
        payload={"mode": "live", "start_caps": start_caps, "gap": to_inject},
        archetype="climb",
    )
    bus.set_agent_status(
        run_id, "coordinator", "working", planner_version=planner_version
    )

    # Clear any stale beads (from a prior or interrupted run) BEFORE planning, so the
    # initial drain and the gap injections work only this beat's own graph. As in
    # run_cycle, close_open() sweeps blocked beads too (ready() would miss them).
    beads.close_open(reason=f"cleared before {run_id}")

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
        title = skill.canonical_title(category, task.skill)
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
    # Stamp every event this loop emits with the build target (per-task cockpit).
    bus.bind_task(getattr(task, "name", None))
    # Fresh curve for this climb: drop the task's prior scores + version metadata so
    # a shorter climb never shows a longer prior climb's trailing versions.
    bus.clear_leaderboard(getattr(task, "name", None) or "tokenizer")
    v = max(1, int(versions))
    schedule = improver.schedule_for_versions(v)
    summaries: list[dict[str, Any]] = []
    for n in range(1, v + 1):
        run_id = f"{run_base}-v{n}"
        if cancel_requested():
            bus.emit_type(
                "log", run_id, planner_version=n, agent="system",
                title="run stopped by operator", payload={"version": n},
            )
            break
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
            # Persist the added-category half of the next version's leaderboard meta,
            # for parity with the genuine improve_loop (the validator writes the grade
            # half when that version is scored).
            bus.set_planner_meta(
                getattr(task, "name", "tokenizer"),
                n + 1,
                added_category=added[0] if added else None,
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
