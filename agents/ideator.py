"""The ideator: proposes the NEXT optimization idea for the open-ended optimize loop.

Unlike the improver (which grows a fixed coverage plan toward a known checklist), the
ideator looks at the current best code, the current metric, and every idea already
tried (and whether it helped), then proposes ONE new, specific optimization to attempt
next. That is what lets ``optimize_loop`` keep finding fresh angles and climbing until
it genuinely runs out of ideas that work, rather than stopping at a predefined bar.
"""
from __future__ import annotations

import os
from typing import Any

from . import _paths

_paths.ensure_repo_root()
_paths.load_env()

import weave  # noqa: E402

from . import llm  # noqa: E402

_FALLBACK = (
    "Find the slowest remaining loop and replace it with a vectorized or "
    "lower-complexity implementation."
)


@weave.op()
def propose_idea(
    task: Any,
    code: str,
    metric: float,
    tried: list[dict[str, Any]],
) -> str:
    """Return one or two sentences naming the next optimization to try (never empty).

    ``tried`` is the running history of {idea, metric, kept}; the ideator is told what
    has and has not worked so it does not repeat itself and spends its next idea where
    there is still headroom.
    """
    model = os.environ.get("GLASSBOX_CODER_MODEL") or os.environ.get(
        "GLASSBOX_CHAT_MODEL"
    )
    history = (
        "\n".join(
            f"  - {t.get('idea', '')[:140]} -> "
            f"{'HELPED' if t.get('kept') else 'did not help'} "
            f"(metric {round(float(t.get('metric', 0) or 0), 1)})"
            for t in tried[-12:]
        )
        or "  (nothing tried yet)"
    )
    messages = [
        {
            "role": "system",
            "content": (
                "You are a performance engineer running an optimization loop. Propose "
                "ONE concrete, specific optimization to try NEXT that is clearly "
                "different from what has already been tried. Prefer the highest-leverage "
                "idea you have not tried yet. Answer in one or two imperative sentences, "
                "no preamble and no code."
            ),
        },
        {
            "role": "user",
            "content": (
                f"Goal: {task.goal}\n\n"
                f"Current code:\n{code[:6000]}\n\n"
                f"Current metric (higher is better): {round(float(metric), 2)}\n\n"
                f"Ideas already tried:\n{history}\n\n"
                "What is the single best optimization to try next?"
            ),
        },
    ]
    try:
        idea = llm.chat(messages, model=model, temperature=0.6, max_tokens=400).strip()
    except llm.LLMError:
        return _FALLBACK
    return idea[:400] or _FALLBACK


def _parse_idea_list(reply: str, n: int) -> list[str]:
    """Pull up to ``n`` idea strings from a reply (JSON array preferred, else lines)."""
    import json
    import re

    m = re.search(r"\[.*\]", reply, re.DOTALL)
    if m:
        try:
            arr = json.loads(m.group(0))
            ideas = [str(x).strip() for x in arr if str(x).strip()]
            if ideas:
                return ideas[:n]
        except (ValueError, TypeError):
            pass
    out: list[str] = []
    for line in reply.splitlines():
        s = re.sub(r"^\s*(?:\d+[.)]|[-*])\s*", "", line).strip().strip('"').strip()
        if len(s) > 8:
            out.append(s)
    return out[:n]


@weave.op()
def propose_ideas(
    task: Any,
    code: str,
    metric: float,
    tried: list[dict[str, Any]],
    n: int = 4,
) -> list[str]:
    """Return up to ``n`` DISTINCT next-optimization ideas (the planner's fan-out).

    One model call asks for a diverse batch so several workers can try different
    angles in the same round; falls back to a single generic idea on any failure.
    """
    model = os.environ.get("GLASSBOX_CODER_MODEL") or os.environ.get(
        "GLASSBOX_CHAT_MODEL"
    )
    history = (
        "\n".join(
            f"  - {t.get('idea', '')[:120]} -> {'HELPED' if t.get('kept') else 'no'}"
            for t in tried[-16:]
        )
        or "  (nothing tried yet)"
    )
    messages = [
        {
            "role": "system",
            "content": (
                "You are a performance engineer running an optimization loop. Propose "
                f"{n} DISTINCT, specific optimizations to try next, each clearly "
                "different from the others and from what has already been tried. Return "
                "ONLY a JSON array of strings, each one or two imperative sentences, no "
                "code."
            ),
        },
        {
            "role": "user",
            "content": (
                f"Goal: {task.goal}\n\nCurrent code:\n{code[:6000]}\n\n"
                f"Current metric (higher is better): {round(float(metric), 2)}\n\n"
                f"Ideas already tried:\n{history}\n\n"
                f"Give {n} distinct optimizations to try next as a JSON array of strings."
            ),
        },
    ]
    try:
        reply = llm.chat(messages, model=model, temperature=0.7, max_tokens=700)
    except llm.LLMError:
        return [_FALLBACK]
    return _parse_idea_list(reply, n) or [_FALLBACK]
