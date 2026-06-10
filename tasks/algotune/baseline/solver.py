"""AlgoTune solver suite (the only editable file).

Optimize each solve_* function to beat the reference (numpy/scipy/networkx) while
keeping the output valid per the frozen grader. Each function starts as the reference,
so the baseline speedup is 1.0 and any real gain is the swarm beating a tuned library.
The tasks are from AlgoTune (https://github.com/oripress/AlgoTune). tests/ is read-only.
"""
import networkx as nx
import numpy as np
from scipy.linalg import expm


def solve_cholesky(problem):
    A = problem["matrix"]
    L = np.linalg.cholesky(A)
    return {"Cholesky": {"L": L}}


def solve_matrix_exponential(problem):
    A = problem["matrix"]
    return {"exponential": expm(A)}


def solve_eigenvalues_real(problem):
    eigenvalues = np.linalg.eigh(problem)[0]
    return sorted(eigenvalues, reverse=True)


def solve_count_connected_components(problem):
    n = problem.get("num_nodes", 0)
    G = nx.Graph()
    G.add_nodes_from(range(n))
    G.add_edges_from(problem["edges"])
    return {"number_connected_components": nx.number_connected_components(G)}
