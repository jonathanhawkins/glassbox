"""Regression tests: the bring-your-own-repo worker is HONEST (no safety net).

A BYO task ships no reference solution, so progress can come only from the LLM
genuinely making a real test pass. These tests pin the three guarantees of
``worker._author_source_byo`` against the real pytest evaluator and the vetted
``_fixtures/demo`` repo (which has two deliberately-broken modules: calc, textutil):

  * KEEP   a correct fix that strictly raises the score is kept.
  * BOUNCE a non-improving edit is reverted and the score stays flat.
  * TAMPER an attempt to edit a test file is blocked by the allow-list (bounce),
           and the test file is left byte-for-byte unchanged.

The LLM is stubbed (no network); everything else (clone, pytest grading, revert)
is real, so the tests assert the honest contract deterministically.
"""
from __future__ import annotations

import json

from agents import llm
from agents import worker
from tasks.byo import build_task

_GOOD_CALC = "def add(a, b):\n    return a + b\n\n\ndef double(a):\n    return a * 2\n"


def _build():
    return build_task({"id": "byo-pytest-test", "repo": "demo", "goal": "fix it"})


def _stub_llm(monkeypatch, files: dict[str, str]) -> None:
    payload = json.dumps({"files": files})
    monkeypatch.setattr(llm, "chat", lambda *a, **k: payload)


def test_byo_discovers_failing_modules():
    task = _build()
    assert task.kind == "byo"
    assert task.groups == ["calc", "textutil"]
    # The test files are not editable; the source modules are.
    assert "tests/test_calc.py" not in task.edit_targets
    assert "calc.py" in task.edit_targets


def test_byo_keeps_a_real_fix(monkeypatch):
    task = _build()
    _stub_llm(monkeypatch, {"calc.py": _GOOD_CALC})
    res = worker._author_source_byo(task, "calc")
    assert res["source_kind"] == "llm"
    assert res["score_after"] > res["score_before"]
    assert "a + b" in task.read_target("calc.py")


def test_byo_bounces_a_non_improving_edit(monkeypatch):
    task = _build()
    before = task.read_target("textutil.py")
    # An edit that does not make the failing shout() test pass.
    _stub_llm(monkeypatch, {"textutil.py": "def shout(s):\n    return s\n\n\ndef repeat(s, n):\n    return s * n\n"})
    res = worker._author_source_byo(task, "textutil")
    assert res["source_kind"] == "bounced"
    assert res["score_after"] == res["score_before"]
    assert task.read_target("textutil.py") == before  # reverted


def test_byo_blocks_test_file_edits(monkeypatch):
    task = _build()
    test_before = task.read_target("tests/test_textutil.py")
    _stub_llm(monkeypatch, {"tests/test_textutil.py": "def test_shout():\n    assert True\n"})
    res = worker._author_source_byo(task, "textutil")
    assert res["source_kind"] == "bounced"
    assert task.read_target("tests/test_textutil.py") == test_before  # untouched
