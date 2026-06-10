# speedkit: planner skill

Optimize the naive functions in `kernels.py` for speed while keeping each output
identical to the reference. One bead per function: speed up matmul, the pairwise
squared distances, and the pair-sum counter. The eval reports each function's measured
speedup and which are still slow, and the `tests/` folder is read-only.

<!-- coverage:start -->
matmul
pairwise_sq_dists
count_pairs_with_sum
<!-- coverage:end -->
