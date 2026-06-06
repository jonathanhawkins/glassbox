"""Glassbox harness: the oracle (exact token-ID diff vs tiktoken gpt2) and the
Weave Evaluation that grades each planner version.

Public surface:
  - oracle.run_oracle(bin_path=None, caps=None, fixtures=...) -> dict
  - eval.evaluate(planner_version, caps=None, run_id="") -> dict
"""
