"""Deliberately-naive hot functions. Optimize each for speed while keeping the output
identical to the reference. Only this file is editable; tests/ is read-only."""


def matmul(a, b):
    n, p, m = len(a), len(b), len(b[0])
    out = [[0] * m for _ in range(n)]
    for i in range(n):
        for j in range(m):
            s = 0
            for k in range(p):
                s += a[i][k] * b[k][j]
            out[i][j] = s
    return out


def pairwise_sq_dists(pts):
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


def count_pairs_with_sum(xs, target):
    c = 0
    n = len(xs)
    for i in range(n):
        for j in range(i + 1, n):
            if xs[i] + xs[j] == target:
                c += 1
    return c
