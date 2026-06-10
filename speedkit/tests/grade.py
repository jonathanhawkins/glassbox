"""Frozen grader for speedkit (read-only). Imports the candidate kernels, checks each
against a frozen reference on random inputs, times both, and prints a JSON result line
the evaluator parses. Do not edit."""
import os
import sys
import time
import json
import random

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)  # so `import kernels` (the candidate) resolves
import kernels as cand  # noqa: E402


# ---- frozen reference implementations (the ground truth) ----
def ref_matmul(a, b):
    n, p, m = len(a), len(b), len(b[0])
    out = [[0] * m for _ in range(n)]
    for i in range(n):
        for j in range(m):
            s = 0
            for k in range(p):
                s += a[i][k] * b[k][j]
            out[i][j] = s
    return out


def ref_pairwise_sq_dists(pts):
    n = len(pts)
    out = [[0] * n for _ in range(n)]
    for i in range(n):
        for j in range(n):
            d = 0
            for c in range(len(pts[i])):
                diff = pts[i][c] - pts[j][c]
                d += diff * diff
            out[i][j] = d
    return out


def ref_count_pairs_with_sum(xs, target):
    c = 0
    n = len(xs)
    for i in range(n):
        for j in range(i + 1, n):
            if xs[i] + xs[j] == target:
                c += 1
    return c


def _mat(x):
    return [list(map(int, row)) for row in x]


def _rand_mat(r, c):
    return [[random.randint(-5, 5) for _ in range(c)] for _ in range(r)]


def _time(fn, args, reps):
    t0 = time.perf_counter()
    for _ in range(reps):
        fn(*args)
    return time.perf_counter() - t0


def _grade_matmul():
    random.seed(1)
    sa, sb = _rand_mat(6, 9), _rand_mat(9, 7)
    correct = _mat(cand.matmul(sa, sb)) == _mat(ref_matmul(sa, sb))
    ba, bb = _rand_mat(100, 100), _rand_mat(100, 100)
    return correct, _time(ref_matmul, (ba, bb), 2), _time(cand.matmul, (ba, bb), 2)


def _grade_pairwise():
    random.seed(2)
    sp = _rand_mat(10, 4)
    correct = _mat(cand.pairwise_sq_dists(sp)) == _mat(ref_pairwise_sq_dists(sp))
    bp = _rand_mat(150, 6)
    return correct, _time(ref_pairwise_sq_dists, (bp,), 2), _time(cand.pairwise_sq_dists, (bp,), 2)


def _grade_count_pairs():
    random.seed(3)
    sxs = [random.randint(-9, 9) for _ in range(40)]
    correct = int(cand.count_pairs_with_sum(sxs, 3)) == int(ref_count_pairs_with_sum(sxs, 3))
    bxs = [random.randint(-50, 50) for _ in range(2000)]
    return correct, _time(ref_count_pairs_with_sum, (bxs, 7), 2), _time(cand.count_pairs_with_sum, (bxs, 7), 2)


def main():
    graders = [
        ("matmul", _grade_matmul),
        ("pairwise_sq_dists", _grade_pairwise),
        ("count_pairs_with_sum", _grade_count_pairs),
    ]
    results = {}
    for name, fn in graders:
        try:
            correct, t_ref, t_cand = fn()
            results[name] = {
                "correct": bool(correct),
                "speedup": round(t_ref / max(t_cand, 1e-9), 2),
            }
        except Exception as exc:  # noqa: BLE001 - a broken candidate is a fail, not a crash
            results[name] = {"correct": False, "speedup": 0.0, "error": str(exc)[:140]}
    print("SPEEDKIT_RESULT:", json.dumps(results))


if __name__ == "__main__":
    main()
