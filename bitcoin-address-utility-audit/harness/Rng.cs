using System;
using System.Linq;
using Org.BouncyCastle.Crypto.Prng;
using Org.BouncyCastle.Security;
class Rng {
    static void Main() {
        Console.WriteLine("BC version: " + typeof(SecureRandom).Assembly.GetName().Version);
        Console.WriteLine("CryptoApiRandomGenerator present in this BC: " + (Type.GetType("Org.BouncyCastle.Crypto.Prng.CryptoApiRandomGenerator, BouncyCastle.Crypto") != null));
        // What the default SecureRandom() master is seeded from: ThreadedSeedGenerator(24, fast=true) + DateTime ticks
        var t = new ThreadedSeedGenerator();
        int runs = 400; int[] hist = new int[256]; int total = 0;
        var sw = System.Diagnostics.Stopwatch.StartNew();
        for (int r = 0; r < runs; r++) {
            byte[] s = t.GenerateSeed(24, true);
            if (r < 4) Console.WriteLine("  sample seed: " + BitConverter.ToString(s).Replace("-", ""));
            foreach (byte b in s) { hist[b]++; total++; }
        }
        double maxp = hist.Max() / (double)total;
        Console.WriteLine(string.Format("  {0} seeds in {1} ms; most common byte value frequency {2:P2} (uniform = 0.39%) => min-entropy ~{3:F1} bits/byte",
            runs, sw.ElapsedMilliseconds, maxp, -Math.Log(maxp, 2)));
        // the patched generator
        var sr = new SecureRandom(new CryptoApiRandomGenerator());
        byte[] k = new byte[32]; sr.NextBytes(k);
        Console.WriteLine("  OS-backed SecureRandom works on BC 1.7: " + BitConverter.ToString(k).Replace("-", "").Substring(0, 16) + "...");
    }
}
