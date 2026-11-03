# Faithful port of MofN.Generate/Decode (Model/MofN.cs) incl. C# 64-bit 'long' wraparound,
# to test whether decoding returns the right key for every M, N and choice of parts.
import random, itertools, sys
def wrap(x):  # C# unchecked long arithmetic
    x &= (1 << 64) - 1
    return x - (1 << 64) if x >> 63 else x
def tdiv(a, b):  # truncating division (C# long / and BouncyCastle BigInteger.Divide)
    q = abs(a) // abs(b)
    return q if (a >= 0) == (b > 0) else -q

class Co:
    def __init__(s, m, v): s.m, s.v = m, v
class Eq:
    def __init__(s, partnumber0=None, partcount=None, seq0=None):
        s.left, s.right, s.sub, s.div = [], [], 0, 1
        if partnumber0 is None: return
        for i in range(partcount):
            f = 1
            for _ in range(seq0 + 1): f = wrap(f * (i + 1))
            s.left.append(Co(f, i))
        s.right.append(Co(1, partnumber0))
    def kill(s):
        primes = [2, 3, 5, 7, 11, 13, 17]; i = 0
        while i < len(primes):
            p = primes[i]
            if all(abs(c.m) % p == 0 for c in s.left) and all(abs(c.m) % p == 0 for c in s.right):
                for c in s.left + s.right: c.m = tdiv(c.m, p)
                i = 0; continue
            i += 1
    def combine(s, o):
        n = Eq(); o.kill(); tm = bm = 0
        for i in range(len(s.left)):
            t, b = s.left[i], o.left[i]
            if i == 0: tm, bm = b.m, t.m
            else: n.left.append(Co(wrap(wrap(t.m * tm) - wrap(b.m * bm)), t.v))
        for i in range(8):
            m = 0
            for r in s.right:
                if r.v == i: m = wrap(m + wrap(r.m * tm))
            for r in o.right:
                if r.v == i: m = wrap(m - wrap(r.m * bm))
            if m != 0: n.right.append(Co(m, i))
        n.kill(); return n
    def solve_right(s, pc):
        acc = sum(pc[c.v] * c.m for c in s.right)
        return tdiv(acc - s.sub, s.div)
    def solve_left(s, v):
        for i in range(8):
            if v[i] is not None and v[i] != 0:
                j = 0
                while j < len(s.left):
                    c = s.left[j]
                    if c.v == i:
                        s.sub += v[i] * c.m; s.left.pop(j); continue
                    j += 1

def generate(M, N, rng):
    v = []
    for i in range(8):
        b = rng.getrandbits(256)
        if i >= 7: b &= (1 << 255) - 1
        v.append(b)
    secret = 0
    for i in range(M): secret ^= v[i]
    parts = []
    for i in range(N):
        parts.append((i, sum(v[j] * (j + 1) ** (i + 1) for j in range(M))))
    return secret, parts

def decode(M, parts):
    pc = [p[1] for p in parts]
    eqs = [Eq(i, M, parts[i][0]) for i in range(M)]
    steps = [eqs]
    while len(eqs) > 1:
        eqs = [eqs[i].combine(eqs[0]) for i in range(1, len(eqs))]
        steps.append(eqs)
    v = [None] * 8
    while steps:
        last = steps.pop()[0]
        last.div = last.left[0].m; last.left[0].m = 1
        idx = last.left[0].v
        v[idx] = last.solve_right(pc)
        for eqbl in steps:
            for e in eqbl: e.solve_left(v)
    acc = 0
    for i in range(M): acc ^= v[i]
    return acc

rng = random.Random(1)
for M in range(1, 9):
    for N in range(M, 9):
        bad = total = 0
        for trial in range(3):
            secret, parts = generate(M, N, rng)
            for sub in itertools.permutations(range(N), M) if M <= 3 else itertools.combinations(range(N), M):
                total += 1
                if decode(M, [parts[k] for k in sub]) != secret: bad += 1
        if bad: print(f"M={M} N={N}: {bad}/{total} decodes WRONG")
print("done")
