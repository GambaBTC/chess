#!/usr/bin/env python3
"""Independently check a list of mini private keys before funding them.

Usage:  python3 verify_minikeys.py keys.csv
The file has one key per line as  minikey,address  or  minikey address  (the format of the app's
"Save private keys" export). A header line is fine. For each line it checks:
  * the mini key is well formed and passes its typo check: SHA256(key + "?") starts with 0x00
  * SHA256(key) is a valid secp256k1 private key
  * the address printed next to it really belongs to that key (uncompressed P2PKH, as mini keys use)
  * no key or address appears twice
It then tests each character position for bias with a chi-square test.

Shares no code with Bitcoin Address Utility: Python standard library only, with its own secp256k1 math.
Run it on the offline machine that holds the keys.
"""
import hashlib, math, re, sys
from collections import Counter

P = 2**256 - 2**32 - 977
N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141
G = (0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798,
     0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8)
B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"

def _jdouble(p):
    x, y, z = p
    if y == 0: return (0, 0, 0)
    s = 4 * x * y * y % P; m = 3 * x * x % P
    nx = (m * m - 2 * s) % P
    return (nx, (m * (s - nx) - 8 * pow(y, 4, P)) % P, 2 * y * z % P)

def _jadd(p, q):
    if p[2] == 0: return q
    if q[2] == 0: return p
    z1s, z2s = p[2] * p[2] % P, q[2] * q[2] % P
    u1, u2 = p[0] * z2s % P, q[0] * z1s % P
    s1, s2 = p[1] * z2s * q[2] % P, q[1] * z1s * p[2] % P
    if u1 == u2:
        return _jdouble(p) if s1 == s2 else (0, 0, 0)
    h, r = (u2 - u1) % P, (s2 - s1) % P
    h2 = h * h % P; h3 = h * h2 % P; u1h2 = u1 * h2 % P
    nx = (r * r - h3 - 2 * u1h2) % P
    return (nx, (r * (u1h2 - nx) - s1 * h3) % P, h * p[2] * q[2] % P)

def point_mul(k):
    acc, add = (0, 0, 0), (G[0], G[1], 1)
    while k:
        if k & 1: acc = _jadd(acc, add)
        add = _jdouble(add); k >>= 1
    zi = pow(acc[2], -1, P)
    return (acc[0] * zi * zi % P, acc[1] * zi * zi * zi % P)

def b58check(payload):
    data = payload + hashlib.sha256(hashlib.sha256(payload).digest()).digest()[:4]
    n, out = int.from_bytes(data, "big"), ""
    while n: n, r = divmod(n, 58); out = B58[r] + out
    return "1" * (len(data) - len(data.lstrip(b"\0"))) + out

def address_of_privkey(k):
    x, y = point_mul(k)
    pub = b"\x04" + x.to_bytes(32, "big") + y.to_bytes(32, "big")
    h160 = hashlib.new("ripemd160", hashlib.sha256(pub).digest()).digest()
    return b58check(b"\x00" + h160)

def wilson_hilferty_p(x, k):
    """Upper-tail p-value of a chi-square statistic x with k degrees of freedom (approximation)."""
    z = ((x / k) ** (1 / 3) - (1 - 2 / (9 * k))) / math.sqrt(2 / (9 * k))
    return 0.5 * math.erfc(z / math.sqrt(2))

def self_test():
    # Bitcoin wiki example key, and the WIF example key 5HueCGU8...
    assert address_of_privkey(0x18E14A7B6A307F426A94F8114701E7C8E774E7F9A47E2C2035DB29A206321725) == "16UwLL9Risc3QfPqBUvKofHmBQ7wMtjvM"
    assert address_of_privkey(0x0C28FCA386C7A227600B2FE50B7CAE11EC86D3BF1FBE471BE89827E19D72AA1D) == "1GAehh7TsJAHuUAeKZcXf5CnwuGuGgyX2S"

def main(path):
    self_test()
    rows = []
    with open(path) as f:
        for line in f:
            row = [x for x in re.split(r"[,;\s]+", line.strip()) if x]
            if not row or row[0].lower() == "minikey": continue
            rows.append((row[0], row[1] if len(row) > 1 else ""))
    problems = 0
    keys, addrs = Counter(), Counter()
    fmt = re.compile(r"^S[1-9A-HJ-NP-Za-km-z]{21}([1-9A-HJ-NP-Za-km-z]{4}){0,2}$")
    for i, (mk, addr) in enumerate(rows, 1):
        keys[mk] += 1; addrs[addr] += 1
        if not fmt.match(mk):
            print(f"line {i}: {mk!r} is not a well-formed mini key"); problems += 1; continue
        if hashlib.sha256((mk + "?").encode()).digest()[0] != 0:
            print(f"line {i}: {mk} fails the typo check"); problems += 1; continue
        k = int.from_bytes(hashlib.sha256(mk.encode()).digest(), "big")
        if not 0 < k < N:
            print(f"line {i}: {mk} gives an out-of-range private key"); problems += 1; continue
        if addr:
            real = address_of_privkey(k)
            if real != addr:
                print(f"line {i}: {mk} belongs to {real}, NOT the listed {addr}"); problems += 1
        if i % 1000 == 0: print(f"  ...{i} checked", flush=True)
    for mk, c in keys.items():
        if c > 1: print(f"duplicate key ({c}x): {mk}"); problems += 1
    for a, c in addrs.items():
        if a and c > 1: print(f"duplicate address ({c}x): {a}"); problems += 1
    print(f"{len(rows)} keys checked, {problems} problems")

    # Character bias per position (only meaningful for a few hundred keys or more of one length).
    length = Counter(len(mk) for mk, _ in rows).most_common(1)[0][0]
    same = [mk for mk, _ in rows if len(mk) == length]
    if len(same) >= 500:
        alphabet = sorted(set("".join(mk[1:] for mk in same)))
        worst = (1.0, 0)
        for pos in range(1, length):
            cnt = Counter(mk[pos] for mk in same)
            exp = len(same) / len(alphabet)
            chi = sum((cnt.get(ch, 0) - exp) ** 2 / exp for ch in alphabet)
            p = wilson_hilferty_p(chi, len(alphabet) - 1)
            worst = min(worst, (p, pos))
        adj = min(1.0, worst[0] * (length - 1))
        print(f"character bias: {len(alphabet)} symbols used; least uniform position is #{worst[1] + 1} "
              f"(p = {worst[0]:.3g}, {adj:.3g} after correcting for {length - 1} positions)"
              + ("  <-- looks biased" if adj < 0.01 else "  -> no sign of bias"))
    return 1 if problems else 0

if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("usage: python3 verify_minikeys.py keys.txt   (lines of: minikey,address  or  minikey address)")
    sys.exit(main(sys.argv[1]))
