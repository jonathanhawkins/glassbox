"""Frozen AlgoTune grader (read-only).

The task definitions below (problem generation, the reference solver, and the
validation) are copied verbatim from AlgoTune
(https://github.com/oripress/AlgoTune, (c) 2025 Ori Press and the AlgoTune
contributors). For each task this generates a problem, times the agent's solver in
solver.py against the reference, verifies the agent's output with the task's own
validation, and reports the speedup. Prints one SPEEDKIT_RESULT json line. Do not edit.
"""
import os
import sys
import time
import json
import random

import numpy as np
import networkx as nx
from scipy.linalg import expm

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)  # so `import solver` (the agent's editable file) resolves
import solver as cand  # noqa: E402


# ---- cholesky_factorization (AlgoTune) ----
def gen_cholesky(n, seed=1):
    random.seed(seed)
    np.random.seed(seed)
    X = np.random.randn(n, n)
    return {"matrix": X.T @ X + n * np.eye(n)}


def ref_cholesky(problem):
    return {"Cholesky": {"L": np.linalg.cholesky(problem["matrix"])}}


def check_cholesky(problem, solution):
    A = problem.get("matrix")
    if A is None or "Cholesky" not in solution or "L" not in solution["Cholesky"]:
        return False
    try:
        L = np.array(solution["Cholesky"]["L"])
    except Exception:
        return False
    n = A.shape[0]
    if L.shape != (n, n) or not np.all(np.isfinite(L)):
        return False
    if not np.allclose(L, np.tril(L)):
        return False
    return bool(np.allclose(A, L @ L.T, atol=1e-6))


# ---- matrix_exponential (AlgoTune) ----
def gen_matrix_exponential(n, seed=1):
    random.seed(seed)
    np.random.seed(seed)
    return {"matrix": np.random.randn(n, n)}


def ref_matrix_exponential(problem):
    return {"exponential": expm(problem["matrix"])}


def check_matrix_exponential(problem, solution):
    A = problem.get("matrix")
    if A is None or not isinstance(solution, dict) or "exponential" not in solution:
        return False
    try:
        expA = np.asarray(solution["exponential"])
    except Exception:
        return False
    if expA.shape != A.shape:
        return False
    return bool(np.allclose(expA, expm(A), rtol=1e-5, atol=1e-8))


# ---- eigenvalues_real (AlgoTune) ----
def gen_eigenvalues_real(n, seed=1):
    random.seed(seed)
    np.random.seed(seed)
    A = np.random.randn(n, n)
    return (A + A.T) / 2.0


def ref_eigenvalues_real(problem):
    return sorted(np.linalg.eigh(problem)[0], reverse=True)


def check_eigenvalues_real(problem, solution):
    n = problem.shape[0]
    tol, eps = 1e-6, 1e-12
    if not isinstance(solution, list) or len(solution) != n:
        return False
    for eig in solution:
        if not np.isfinite(eig):
            return False
    for i in range(1, len(solution)):
        if solution[i - 1] < solution[i] - tol:
            return False
    expected = sorted(np.linalg.eigh(problem)[0], reverse=True)
    max_rel = max(abs(c - e) / max(abs(e), eps) for c, e in zip(solution, expected))
    return bool(max_rel <= tol)


# ---- count_connected_components (AlgoTune) ----
_CC_PROB = 0.2  # probability for edges within a component


def _cc_generate_components(n, rng):
    if n <= 1:
        return nx.empty_graph(n)
    k = rng.randint(2, min(5, n))
    cuts = sorted(rng.sample(range(1, n), k - 1))
    sizes = [b - a for a, b in zip([0] + cuts, cuts + [n])]
    G, base = nx.Graph(), 0
    for size in sizes:
        while True:
            H = nx.fast_gnp_random_graph(size, _CC_PROB, seed=rng.randint(0, 2**32 - 1))
            if size == 1 or nx.is_connected(H):
                break
        G.update(nx.relabel_nodes(H, {i: base + i for i in H.nodes()}))
        base += size
    return G


def gen_count_connected_components(n, seed=1):
    rng = random.Random(seed)
    G = nx.empty_graph(n) if n <= 1 else _cc_generate_components(n, rng)
    perm = list(G.nodes())
    rng.shuffle(perm)
    G = nx.relabel_nodes(G, dict(zip(G.nodes(), perm)))
    return {"edges": list(G.edges()), "num_nodes": n}


def ref_count_connected_components(problem):
    n = problem.get("num_nodes", 0)
    G = nx.Graph()
    G.add_nodes_from(range(n))
    G.add_edges_from(problem["edges"])
    return {"number_connected_components": nx.number_connected_components(G)}


def check_count_connected_components(problem, solution):
    if not isinstance(solution, dict) or solution.get("number_connected_components", -1) == -1:
        return False
    expected = ref_count_connected_components(problem)["number_connected_components"]
    return bool(expected == solution["number_connected_components"])


SUITE = [
    ("cholesky", gen_cholesky, ref_cholesky, check_cholesky, "solve_cholesky", 600, 5),
    ("matrix_exponential", gen_matrix_exponential, ref_matrix_exponential,
     check_matrix_exponential, "solve_matrix_exponential", 150, 3),
    ("eigenvalues_real", gen_eigenvalues_real, ref_eigenvalues_real,
     check_eigenvalues_real, "solve_eigenvalues_real", 400, 5),
    ("count_connected_components", gen_count_connected_components,
     ref_count_connected_components, check_count_connected_components,
     "solve_count_connected_components", 800, 3),
]


def _time(fn, arg, reps):
    fn(arg)  # warmup
    t0 = time.perf_counter()
    for _ in range(reps):
        fn(arg)
    return (time.perf_counter() - t0) / reps


def main():
    results = {}
    for name, gen, ref, check, fn_name, n, reps in SUITE:
        try:
            prob = gen(n, 1)
            fn = getattr(cand, fn_name, None)
            if fn is None:
                results[name] = {"correct": False, "speedup": 0.0, "error": "missing solver"}
                continue
            sol = fn(prob)
            correct = bool(check(prob, sol))
            t_ref = _time(ref, prob, reps)
            t_cand = _time(fn, prob, reps)
            results[name] = {
                "correct": correct,
                "speedup": round(t_ref / max(t_cand, 1e-9), 2),
            }
        except Exception as exc:  # noqa: BLE001 - a broken solver is a fail, not a crash
            results[name] = {"correct": False, "speedup": 0.0, "error": str(exc)[:140]}
    print("SPEEDKIT_RESULT:", json.dumps(results))


if __name__ == "__main__":
    main()
