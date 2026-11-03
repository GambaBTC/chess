# For the M-of-N scheme in Model/MofN.cs:
#   v[0..M-1] random 256-bit integers, secret = XOR(v[0..M-1])
#   share i (i=0..7) = sum_j v[j] * (j+1)^(i+1)   -- plain integers, no modulus
# With M-1 shares the integer solutions form a line x0 + k*d (d = primitive kernel vector).
# Candidates left for the attacker ~= 2^256 / max|d_j|.  Report log2 of that.
from fractions import Fraction
from itertools import combinations
from math import gcd, log2
from functools import reduce

def kernel_vector(rows, ncols):
    # Gaussian elimination over Q, return primitive integer kernel vector (1-dim kernel assumed)
    A = [[Fraction(x) for x in r] for r in rows]
    piv_cols = []
    r = 0
    for c in range(ncols):
        p = next((i for i in range(r, len(A)) if A[i][c] != 0), None)
        if p is None: continue
        A[r], A[p] = A[p], A[r]
        pv = A[r][c]
        A[r] = [x / pv for x in A[r]]
        for i in range(len(A)):
            if i != r and A[i][c] != 0:
                f = A[i][c]
                A[i] = [a - f * b for a, b in zip(A[i], A[r])]
        piv_cols.append(c); r += 1
    free = [c for c in range(ncols) if c not in piv_cols]
    assert len(free) == 1, free
    f = free[0]
    vec = [Fraction(0)] * ncols
    vec[f] = Fraction(1)
    for i, c in enumerate(piv_cols):
        vec[c] = -A[i][f]
    den = reduce(lambda a, b: a * b // gcd(a, b), [x.denominator for x in vec])
    iv = [int(x * den) for x in vec]
    g = reduce(gcd, [abs(x) for x in iv])
    return [x // g for x in iv]

print("M  shares-held(M-1)          bits of key left (ideal = 256)")
for M in range(2, 9):
    worst = None
    for S in combinations(range(8), M - 1):
        rows = [[(j + 1) ** (i + 1) for j in range(M)] for i in S]
        d = kernel_vector(rows, M)
        left = 256 - log2(max(abs(x) for x in d))
        if worst is None or left < worst[0]:
            worst = (left, S)
    # also the "natural" first M-1 parts
    S0 = tuple(range(M - 1))
    d0 = kernel_vector([[(j + 1) ** (i + 1) for j in range(M)] for i in S0], M)
    left0 = 256 - log2(max(abs(x) for x in d0))
    print(f"{M}  parts #1..#{M-1}: {left0:6.1f} bits    worst subset {tuple(s+1 for s in worst[1])}: {worst[0]:6.1f} bits")
