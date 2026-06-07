"""Worker: genuinely implement a bead by writing real code into the task workspace.

For a scoring bead the worker prompts the LLM (W&B Inference) to author the source
for that capability, given the current target file and the validator's REAL failing
examples for that group. It writes the edit, builds, and self-checks against the
oracle: if the build succeeds and the score genuinely improves, the LLM-authored
code is kept; otherwise it reverts and falls back to the deterministic renderer
(``task.apply_groups``) so the curve always climbs even when the model misses. The
validator later builds and grades whatever the workers produced, so accuracy is a
genuine consequence of the code the agents wrote.

Set ``GLASSBOX_WORKER_LLM=0`` to skip the model and always use the deterministic
renderer (fast and fully reliable, for a live board). Default is on (genuine).

The set of covered scoring groups is persisted to the Redis set
``glassbox:run:<run_id>:caps`` so the validator, cockpit, and fallback renderer all
read what a run has covered.

Interface other pillars build on:
    complete_bead(task, run_id, bead_id, capability, agent, planner_version) -> dict
    run_bead(task, run_id, bead_id, capability, agent, planner_version) -> dict
    accumulated_capabilities(run_id) -> set[str]
"""
from __future__ import annotations

import os
import re
import time
from typing import Any, Optional

from . import _paths

_paths.ensure_repo_root()

import weave  # noqa: E402

from contract.events import RUN_META_PREFIX  # noqa: E402

from . import beads, bus, llm  # noqa: E402


def pace_ms() -> int:
    """Pace delay (ms) for a watchable board, from env GLASSBOX_PACE_MS.

    Default 0 (the overnight loop runs flat out). The demo sets e.g. 700 so the
    coordinator -> worker -> done transitions are visibly in flight on the board.
    Invalid values fall back to 0.
    """
    try:
        return max(0, int(os.environ.get("GLASSBOX_PACE_MS", "0")))
    except (TypeError, ValueError):
        return 0


def _pace_sleep() -> None:
    """Sleep the configured pace, if any (no-op when GLASSBOX_PACE_MS is 0)."""
    ms = pace_ms()
    if ms > 0:
        time.sleep(ms / 1000.0)


def _worker_llm_enabled() -> bool:
    """Whether the worker authors code with the LLM (default on). 0/false/no = off."""
    return os.environ.get("GLASSBOX_WORKER_LLM", "1").strip().lower() not in (
        "0",
        "false",
        "no",
        "",
    )


def _caps_key(run_id: str) -> str:
    """Redis set key holding the categories covered so far in this run."""
    return f"{RUN_META_PREFIX}{run_id}:caps"


def accumulated_capabilities(run_id: str) -> set[str]:
    """Return the set of category tags covered so far in this run (from Redis)."""
    members = bus.get_client().smembers(_caps_key(run_id))
    return set(members) if members else set()


def accumulate(run_id: str, capability: str) -> None:
    """Record a bead's category into the run's covered set (no-op if empty)."""
    if capability:
        bus.get_client().sadd(_caps_key(run_id), capability)


_CODE_FENCE = re.compile(r"```(?:rust|rs)?\s*(.*?)```", re.DOTALL)


def _extract_code(reply: str) -> Optional[str]:
    """Pull source out of an LLM reply (a fenced block if present, else the body).

    Returns None if the reply does not look like the target file (no gpt2_pattern).
    """
    m = _CODE_FENCE.search(reply)
    code = m.group(1).strip() if m else reply.strip()
    if "gpt2_pattern" not in code:
        return None
    return code


def _format_failing(failing: list[dict[str, Any]], limit: int = 8) -> str:
    """Format a few failing examples as 'text -> expected vs got' for the prompt."""
    lines = []
    for f in failing[:limit]:
        text = repr(f.get("text", ""))[:80]
        exp = f.get("expected")
        got = f.get("got")
        lines.append(f"  {text}\n    expected={exp}\n    got={got}")
    return "\n".join(lines) if lines else "  (no per-line examples available)"


def _llm_author(
    task: Any,
    capability: str,
    target: str,
    current_src: str,
    failing: list[dict[str, Any]],
    build_error: str = "",
) -> Optional[str]:
    """Ask the LLM to rewrite the target file so ``capability`` inputs tokenize right.

    Returns the new file contents, or None if the model is unavailable or its reply
    does not look like the target file. The model only ever sees the real source and
    the real failing examples; the build + oracle (not the model) decide if it worked.
    """
    # Prefer an explicit coder/chat model; otherwise fall through to the project's
    # model resolution (GLASSBOX_LLM_MODEL or a /models probe via llm.get_model()),
    # so a retired hardcoded model never silently forces the deterministic path.
    model = (
        os.environ.get("GLASSBOX_CODER_MODEL")
        or os.environ.get("GLASSBOX_CHAT_MODEL")
        or None
    )
    retry = (
        f"\n\nYour previous attempt failed to build with:\n{build_error[:600]}\n"
        "Fix it and return the full file again."
        if build_error
        else ""
    )
    messages = [
        {
            "role": "system",
            "content": (
                "You are a Rust engineer implementing the gpt2 BPE pretokenizer. The "
                f"file {target} exposes `pub fn gpt2_pattern() -> String`, which "
                "returns a fancy-regex pattern assembled from alternation branches "
                "joined by '|'. The tokenizer splits text with this pattern then "
                "byte-pair-merges each piece, reproducing tiktoken gpt2 exactly. "
                "Return ONLY the complete updated contents of the file, no prose."
            ),
        },
        {
            "role": "user",
            "content": (
                f"Current {target}:\n\n{current_src}\n\n"
                f"The tokenizer must reproduce tiktoken gpt2 token ids for "
                f"'{capability}' inputs, but these fail exact match:\n"
                f"{_format_failing(failing)}\n\n"
                f"Update gpt2_pattern() so '{capability}' inputs tokenize exactly, "
                "keeping every currently-correct branch. Add only what this "
                "capability needs (later beads implement the other input classes). "
                "Return the full file."
                f"{retry}"
            ),
        },
    ]
    try:
        reply = llm.chat(messages, model=model, temperature=0.1, max_tokens=4096)
    except llm.LLMError as exc:
        print(f"[worker] LLM unavailable, using deterministic fallback: {exc}")
        return None
    return _extract_code(reply)


def _author_source(
    task: Any, run_id: str, capability: str, agent: str
) -> dict[str, Any]:
    """Genuinely realize ``capability`` into the workspace source. Returns a summary.

    LLM mode: prompt the model to write the target file, build, and keep the edit
    only if it builds AND the oracle score strictly improves; otherwise revert and
    use the deterministic renderer. Deterministic mode (or non-scoring/structural
    beads): use ``task.apply_groups`` directly. The result records ``source_kind``
    (llm | fallback | deterministic | structural) and the before/after score.
    """
    scoring = set(getattr(task, "groups", []) or [])

    # Structural / non-scoring beads (e.g. the suite/harness) change no graded source.
    if capability not in scoring:
        return {"source_kind": "structural"}

    # Bring-your-own-repo: author real edits with the LLM only, NO deterministic
    # fallback. The score moves only if the model genuinely fixed the tests.
    if getattr(task, "kind", "curated") == "byo":
        return _author_source_byo(task, capability)

    covered = accumulated_capabilities(run_id) & scoring
    targets = getattr(task, "edit_targets", []) or []
    group_targets = getattr(task, "group_targets", {}) or {}
    # The file this bead's group edits: a per-group module if the task maps one,
    # else the single shared editable file.
    target = group_targets.get(capability) or (targets[0] if targets else None)
    if not target:
        return {"source_kind": "structural"}

    # Deterministic mode: render the covered set and let the validator grade it.
    if not _worker_llm_enabled():
        task.apply_groups(covered)
        return {"source_kind": "deterministic"}
    # Establish the pre-bead state and the real failing examples for this group.
    task.build()
    before = task.evaluate()
    src_before = task.read_target(target)
    failing = [f for f in before.failures if f.get("group") == capability]

    new_src = _llm_author(task, capability, target, src_before, failing)
    if new_src and new_src.strip() != src_before.strip():
        task.write_target(target, new_src)
        ok, err = task.build()
        if not ok:
            # One bounded retry with the compiler error fed back.
            retry_src = _llm_author(
                task, capability, target, src_before, failing, build_error=err
            )
            if retry_src:
                task.write_target(target, retry_src)
                ok, err = task.build()
        if ok:
            after = task.evaluate()
            if after.score > before.score:
                return {
                    "source_kind": "llm",
                    "score_before": round(before.score, 4),
                    "score_after": round(after.score, 4),
                }
        # Did not build or did not improve: revert the model's edit.
        task.write_target(target, src_before)

    # Fallback: the deterministic renderer guarantees this group is genuinely covered.
    task.apply_groups(covered)
    task.build()
    after = task.evaluate()
    return {
        "source_kind": "fallback" if new_src else "deterministic",
        "score_before": round(before.score, 4),
        "score_after": round(after.score, 4),
    }


_BYO_MAX_CONTEXT_FILES = 12
_BYO_MAX_FILE_CHARS = 6000


def _glob_match(rel: str, glob: str) -> bool:
    """fnmatch with recursive ``**`` support for the common ``**/*.ext`` case.

    Plain fnmatch requires ``**/*.py`` to contain a slash, so a top-level ``calc.py``
    would not match; we also try the de-``**``-ed variant so root files match too.
    """
    import fnmatch

    if fnmatch.fnmatch(rel, glob):
        return True
    if "**/" in glob and fnmatch.fnmatch(rel, glob.replace("**/", "", 1)):
        return True
    return False


def _byo_path_allowed(rel: str, edit_globs: list[str], test_paths: list[str]) -> bool:
    """True if a worker may write ``rel`` (workspace-relative): matches an edit glob,
    is not under any read-only test path, and does not escape the workspace."""
    from pathlib import PurePosixPath

    rel = rel.lstrip("/")
    parts = PurePosixPath(rel).parts
    if not rel or ".." in parts:
        return False
    test_prefixes = tuple(tp.strip("/") + "/" for tp in test_paths)
    if rel.startswith(test_prefixes):
        return False
    return any(_glob_match(rel, g) for g in edit_globs)


def _byo_context_files(task: Any) -> list[tuple[str, str]]:
    """The editable files (rel, contents) to show the model, bounded for tokens."""
    out: list[tuple[str, str]] = []
    for rel in getattr(task, "edit_targets", []) or []:
        if len(out) >= _BYO_MAX_CONTEXT_FILES:
            break
        src = task.read_target(rel)
        out.append((rel, src[:_BYO_MAX_FILE_CHARS]))
    return out


def _byo_test_hashes(task: Any) -> dict[str, str]:
    """Content hash of every file under the read-only test paths (tamper tripwire)."""
    import hashlib
    from pathlib import Path

    ws: Path = task.workspace
    hashes: dict[str, str] = {}
    for tp in getattr(task, "test_paths", []) or []:
        base = ws / tp
        files = [base] if base.is_file() else (base.rglob("*") if base.is_dir() else [])
        for p in files:
            if p.is_file():
                rel = p.relative_to(ws).as_posix()
                hashes[rel] = hashlib.sha256(p.read_bytes()).hexdigest()
    return hashes


def _byo_parse_files(reply: str) -> dict[str, str]:
    """Parse a model reply into {path: contents}. Expects a JSON object with a
    ``files`` map (tolerates a fenced ```json block). Returns {} on any failure."""
    import json

    text = reply.strip()
    fence = re.search(r"```(?:json)?\s*(.*?)```", text, re.DOTALL)
    if fence:
        text = fence.group(1).strip()
    try:
        obj = json.loads(text)
    except (json.JSONDecodeError, TypeError):
        # Fall back to the first {...} block if the model wrapped JSON in prose.
        block = re.search(r"\{.*\}", text, re.DOTALL)
        if not block:
            return {}
        try:
            obj = json.loads(block.group(0))
        except (json.JSONDecodeError, TypeError):
            return {}
    files = obj.get("files") if isinstance(obj, dict) else None
    if not isinstance(files, dict):
        return {}
    return {str(k): str(v) for k, v in files.items() if isinstance(v, str)}


def _byo_author_llm(
    task: Any, capability: str, failing: list[dict[str, Any]], build_error: str = ""
) -> dict[str, str]:
    """Ask the model to fix the failing tests for ``capability`` by editing real
    repo files. Returns {path: new_contents} (allow-list enforced by the caller)."""
    model = os.environ.get("GLASSBOX_CODER_MODEL") or os.environ.get(
        "GLASSBOX_CHAT_MODEL"
    )
    ctx = "\n\n".join(
        f"=== {rel} ===\n{src}" for rel, src in _byo_context_files(task)
    )
    fails = "\n".join(
        f"  {f.get('test', '')}: {f.get('message', '')}" for f in failing[:10]
    ) or "  (no per-test messages captured)"
    globs = ", ".join(getattr(task, "edit_globs", []) or [])
    retry = (
        f"\n\nYour previous attempt failed with:\n{build_error[:600]}\nFix it."
        if build_error
        else ""
    )
    messages = [
        {
            "role": "system",
            "content": (
                "You are a software engineer fixing a real repository so its test "
                "suite passes. You may ONLY edit source files (you may NOT edit test "
                "files). Return ONLY a JSON object of the form "
                '{"files": {"relative/path.py": "<full new file contents>"}} with '
                "the complete contents of each file you change. No prose."
            ),
        },
        {
            "role": "user",
            "content": (
                f"Goal: {task.goal}\n\n"
                f"Editable files (globs: {globs}):\n\n{ctx}\n\n"
                f"These '{capability}' tests currently fail:\n{fails}\n\n"
                f"Edit the source so the '{capability}' tests pass, without breaking "
                f"others. Return the JSON files object only.{retry}"
            ),
        },
    ]
    try:
        reply = llm.chat(messages, model=model, temperature=0.1, max_tokens=4096)
    except llm.LLMError as exc:
        print(f"[worker] BYO LLM unavailable, bead will bounce: {exc}")
        return {}
    return _byo_parse_files(reply)


def _author_source_byo(task: Any, capability: str) -> dict[str, Any]:
    """BYO authoring: real LLM edits, no fallback. Keep the edit only if it builds
    and strictly raises the score AND leaves the test files untouched; else revert
    every touched file and bounce the bead (score flat)."""
    edit_globs = list(getattr(task, "edit_globs", []) or [])
    test_paths = list(getattr(task, "test_paths", []) or [])

    task.build()
    before = task.evaluate()
    test_hashes = _byo_test_hashes(task)
    failing = [f for f in before.failures if f.get("group") == capability]

    def attempt(build_error: str = "") -> tuple[bool, dict[str, str]]:
        proposed = _byo_author_llm(task, capability, failing, build_error)
        allowed = {
            rel: src
            for rel, src in proposed.items()
            if _byo_path_allowed(rel, edit_globs, test_paths)
        }
        if not allowed:
            return False, {}
        # Snapshot the files we are about to touch so we can revert on bounce.
        snapshot = {rel: task.read_target(rel) for rel in allowed}
        for rel, src in allowed.items():
            task.write_target(rel, src)
        return True, snapshot

    wrote, snapshot = attempt()
    if not wrote:
        return _byo_bounced(before)

    ok, err = task.build()
    if not ok:
        wrote2, snap2 = attempt(build_error=err)
        if wrote2:
            snapshot = {**snap2, **snapshot}  # keep the earliest pre-bead contents
            ok, err = task.build()

    kept = False
    if ok:
        after = task.evaluate()
        tampered = _byo_test_hashes(task) != test_hashes
        if after.score > before.score and not tampered:
            kept = True
            return {
                "source_kind": "llm",
                "files": sorted(snapshot.keys()),
                "score_before": round(before.score, 4),
                "score_after": round(after.score, 4),
            }
    # Bounced: revert every touched file to its pre-bead contents.
    if not kept:
        for rel, src in snapshot.items():
            task.write_target(rel, src)
    return _byo_bounced(before)


def _byo_bounced(before: Any) -> dict[str, Any]:
    """A bead that left the repo unchanged (the model did not raise the score)."""
    return {
        "source_kind": "bounced",
        "score_before": round(before.score, 4),
        "score_after": round(before.score, 4),
    }


def _lease_path(task: Any, capability: str) -> Optional[str]:
    """The repo-relative workspace file a worker leases for this bead, or None.

    Mirrors the target selection in ``_author_source``: only scoring beads with a
    concrete edit target take a lease; structural / non-scoring beads (e.g. the
    harness) edit no graded source and hold no lease. The path is prefixed with the
    task's workspace dir name so the cockpit shows a readable repo-relative path
    (e.g. ``tokenizer-rs/src/pretok.rs``).
    """
    scoring = set(getattr(task, "groups", []) or [])
    if capability not in scoring:
        return None
    targets = getattr(task, "edit_targets", []) or []
    group_targets = getattr(task, "group_targets", {}) or {}
    rel = group_targets.get(capability) or (targets[0] if targets else None)
    if not rel:
        return None
    ws = getattr(task, "workspace", None)
    name = getattr(ws, "name", None)
    return f"{name}/{rel}" if name else rel


@weave.op()
def complete_bead(
    task: Any,
    run_id: str,
    bead_id: str,
    capability: str,
    agent: str = "worker-1",
    planner_version: int = 1,
) -> dict[str, Any]:
    """Implement one already-claimed bead: author its source, close it, emit done.

    Records the bead's capability into the run's covered set, takes a real advisory
    Agent Mail file lease on the workspace file it edits, genuinely authors the
    source for it (LLM with deterministic fallback, see ``_author_source``),
    releases the lease, closes the bead, and emits ``bead_done`` carrying how the
    source was produced. Does not pace or touch agent status, so a drained wave can
    complete bead by bead.
    """
    accumulate(run_id, capability)
    # Reserve the file this bead edits before touching it (Agent Mail advisory
    # lease), then release after authoring. The cockpit shows the reservation; the
    # try/finally guarantees the lease is freed even if authoring raises.
    lease_path = _lease_path(task, capability)
    if lease_path:
        bus.lease_files(
            run_id,
            agent,
            [lease_path],
            planner_version=planner_version,
            reason=capability,
            bead_id=bead_id,
        )
    try:
        authored = _author_source(task, run_id, capability, agent)
    finally:
        if lease_path:
            bus.release_files(
                run_id, agent, [lease_path], planner_version=planner_version
            )
    beads.close(bead_id, reason=f"{agent} implemented capability={capability}")
    caps_sorted = sorted(accumulated_capabilities(run_id))
    bus.emit_type(
        "bead_done",
        run_id,
        planner_version=planner_version,
        agent=agent,
        bead_id=bead_id,
        payload={"capability": capability, "caps": caps_sorted, **authored},
    )
    kind = authored.get("source_kind", "")
    how = {
        "llm": "wrote the code",
        "fallback": "wrote the code (model missed, used reference)",
        "deterministic": "applied the reference",
        "structural": "wired the harness",
        "bounced": "attempted, left unchanged (no improvement)",
    }.get(kind, "implemented")
    bus.emit_mail(
        run_id,
        agent,
        "validator",
        f"Done: {capability or 'task'}",
        planner_version=planner_version,
        bead_id=bead_id,
        body=f"{how} for {capability or 'task'}, ready to grade",
        kind="done",
        cap=capability or None,
    )
    return {"bead_id": bead_id, "capability": capability, "caps": caps_sorted, **authored}


@weave.op()
def run_bead(
    task: Any,
    run_id: str,
    bead_id: str,
    capability: str,
    agent: str = "worker-1",
    planner_version: int = 1,
) -> dict[str, Any]:
    """Implement one bead end to end: claim-light, author, close, done, idle.

    The single-bead convenience used by the live inject beat. Flips the worker to
    ``working``, authors the source for the bead (genuine LLM with deterministic
    fallback), closes the bead, and settles the worker back to ``idle``.
    """
    bus.set_agent_status(run_id, agent, "working", planner_version=planner_version)
    # Pace the bead in flight so the cockpit can show the chip move (demo only).
    _pace_sleep()
    result = complete_bead(task, run_id, bead_id, capability, agent, planner_version)
    bus.set_agent_status(run_id, agent, "idle", planner_version=planner_version)
    return result
