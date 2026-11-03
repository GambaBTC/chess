import sys, random, itertools
src = open(sys.argv[1]).read().split("rng = random.Random(1)")[0]
ns = {}; exec(src, ns)
orig = ns['wrap']; ovf = [0]
def wrap2(x):
    r = orig(x)
    if r != x: ovf[0] += 1
    return r
ns['wrap'] = wrap2
rng = random.Random(7)
for M in range(2, 9):
    for N in range(M, 9):
        bad = tot = 0; ovf_bad = 0
        for t in range(2):
            secret, parts = ns['generate'](M, N, rng)
            for sub in itertools.permutations(range(N), M):
                tot += 1
                ovf[0] = 0
                ok = ns['decode'](M, [parts[k] for k in sub]) == secret
                if not ok:
                    bad += 1
                    if ovf[0]: ovf_bad += 1
                    if bad == 1 and t == 0: ex = tuple(s + 1 for s in sub)
            if tot > 60000: break
        if bad:
            print(f"M={M} N={N}: {bad}/{tot} orderings decode to WRONG key ({ovf_bad} with 64-bit overflow); e.g. parts entered in order {ex}")
print("done")
