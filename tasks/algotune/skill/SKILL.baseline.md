# algotune: planner skill

Beat the numpy/scipy reference solvers in `solver.py` for three real AlgoTune problems
while keeping each output valid. One bead per task: Cholesky factorization, the matrix
exponential, and real symmetric eigenvalues. The eval reports each solver's measured
speedup over the reference, and the `tests/` folder is read-only.

<!-- coverage:start -->
cholesky
matrix_exponential
eigenvalues_real
count_connected_components
<!-- coverage:end -->
