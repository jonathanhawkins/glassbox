"""OpenAI-compatible LLM client for W&B Inference (auto-traced by Weave).

W&B Inference exposes an OpenAI-compatible endpoint at OPENAI_BASE_URL using the
W&B API key as OPENAI_API_KEY. Because we call ``weave.init`` first, every
OpenAI call this module makes is auto-traced into the Weave project.

Verified against the live endpoint (https://api.inference.wandb.ai/v1):
    - GET /models lists available models; auth is the bearer key alone.
    - The default model ``openai/gpt-oss-120b`` is a REASONING model: it returns
      its chain in ``message.reasoning`` and the answer in ``message.content``.
      With too small a ``max_tokens`` the budget is spent on reasoning and
      ``content`` comes back null, so we default to a generous budget.
    - The OpenAI-Project header is accepted but not required; we only send it
      when GLASSBOX_LLM_SEND_PROJECT_HEADER is truthy.

Public interface:
    chat(messages, **kw) -> str        the assistant content (raises on failure)
    get_model()          -> str        the resolved working model id
    init_weave()         -> None       idempotent weave.init for the project
    available_models()   -> list[str]  ids from GET /models
"""
from __future__ import annotations

import os
from typing import Any, Optional

from . import _paths

_paths.ensure_repo_root()
_paths.load_env()

# Candidate strong instruct/coder models to fall back to if GLASSBOX_LLM_MODEL
# is unset. Ordered by preference. We pick the first one the endpoint offers.
_CANDIDATES = [
    "openai/gpt-oss-120b",
    "deepseek-ai/DeepSeek-V3.1",
    "Qwen/Qwen3-235B-A22B-Instruct-2507",
    "Qwen/Qwen3-Coder-480B-A35B-Instruct",
    "meta-llama/Llama-3.3-70B-Instruct",
    "moonshotai/Kimi-K2-Instruct",
    "zai-org/GLM-4.6",
]

_DEFAULT_MAX_TOKENS = 4096

_client: Optional[Any] = None
_model: Optional[str] = None
_weave_inited = False


class LLMError(RuntimeError):
    """The W&B Inference endpoint is unreachable, unauthorized, or empty.

    The planner catches this and falls back to its deterministic plan, so a
    flaky network never breaks a run.
    """


def _entity_project() -> str:
    entity = os.environ.get("WANDB_ENTITY", "").strip()
    project = os.environ.get("WEAVE_PROJECT", os.environ.get("WANDB_PROJECT", "glassbox")).strip()
    return f"{entity}/{project}" if entity else project


def init_weave() -> None:
    """Initialize Weave for the glassbox project (idempotent).

    A bare project name fails with an entity error on this account, so we always
    use ``entity/project`` when WANDB_ENTITY is set. Safe to call many times.
    """
    global _weave_inited
    if _weave_inited:
        return
    try:
        import weave

        weave.init(_entity_project())
        _weave_inited = True
    except Exception as exc:  # pragma: no cover (network/auth dependent)
        # Do not hard-fail: tracing is best-effort, the swarm must still run.
        print(f"[llm] weave.init skipped: {exc}")


def _build_client() -> Any:
    from openai import OpenAI

    base_url = os.environ.get("OPENAI_BASE_URL", "https://api.inference.wandb.ai/v1")
    api_key = os.environ.get("OPENAI_API_KEY", "")
    if not api_key:
        raise LLMError("OPENAI_API_KEY is not set (the W&B Inference key)")

    default_headers: dict[str, str] = {}
    if os.environ.get("GLASSBOX_LLM_SEND_PROJECT_HEADER", "").lower() in ("1", "true", "yes"):
        default_headers["OpenAI-Project"] = _entity_project()

    return OpenAI(
        base_url=base_url,
        api_key=api_key,
        default_headers=default_headers or None,
    )


def get_client() -> Any:
    """Return a process-wide OpenAI client pointed at W&B Inference."""
    global _client
    if _client is None:
        _client = _build_client()
    return _client


def available_models() -> list[str]:
    """Return the model ids the endpoint advertises (best effort)."""
    try:
        resp = get_client().models.list()
        return [m.id for m in resp.data]
    except Exception as exc:
        raise LLMError(f"could not list models: {exc}") from exc


def get_model() -> str:
    """Resolve the working model id.

    Uses GLASSBOX_LLM_MODEL if set; otherwise queries /models and picks the
    first available candidate from a preference list.
    """
    global _model
    if _model is not None:
        return _model
    configured = os.environ.get("GLASSBOX_LLM_MODEL", "").strip()
    if configured:
        _model = configured
        return _model
    try:
        offered = set(available_models())
    except LLMError:
        offered = set()
    for cand in _CANDIDATES:
        if cand in offered:
            _model = cand
            return _model
    # Last resort: first offered model, or the top candidate as a label.
    _model = next(iter(offered), _CANDIDATES[0])
    return _model


def chat(messages: list[dict[str, str]], **kw: Any) -> str:
    """Send a chat completion and return the assistant's text content.

    Calls weave.init first so the request is auto-traced. Raises LLMError if the
    endpoint fails or returns no content (reasoning models can emit empty
    content when the token budget is too small, so we default it generously).
    """
    init_weave()
    model = kw.pop("model", None) or get_model()
    params: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "temperature": kw.pop("temperature", 0.2),
        "max_tokens": kw.pop("max_tokens", _DEFAULT_MAX_TOKENS),
    }
    params.update(kw)
    try:
        resp = get_client().chat.completions.create(**params)
    except Exception as exc:
        raise LLMError(f"chat completion failed for model {model!r}: {exc}") from exc

    if not resp.choices:
        raise LLMError(f"chat completion returned no choices (model {model!r})")
    content = resp.choices[0].message.content
    if not content or not content.strip():
        raise LLMError(
            f"chat completion returned empty content (model {model!r}); "
            "increase max_tokens for reasoning models"
        )
    return content


def selftest() -> dict[str, Any]:
    """Probe the endpoint end to end. Returns a small status dict.

    Used by the verify step. Never raises: failures are reported in the dict.
    """
    info: dict[str, Any] = {"model": None, "ok": False, "reply": None, "error": None}
    try:
        info["model"] = get_model()
        info["reply"] = chat(
            [{"role": "user", "content": "Reply with exactly the word PONG and nothing else."}],
            max_tokens=256,
        ).strip()
        info["ok"] = True
    except Exception as exc:
        info["error"] = str(exc)
    return info


if __name__ == "__main__":
    import json

    print(json.dumps(selftest(), indent=2))
