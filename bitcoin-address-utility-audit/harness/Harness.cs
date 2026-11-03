// Test harness that exercises the real Casascius.Bitcoin model classes.
using System;
using System.Collections.Generic;
using System.Linq;
using Casascius.Bitcoin;

class Harness {
    static int pass = 0, fail = 0;
    static void Check(string name, bool ok, string detail = "") {
        Console.WriteLine((ok ? "  PASS " : "  FAIL ") + name + (detail != "" ? "  [" + detail + "]" : ""));
        if (ok) pass++; else fail++;
    }
    static int bugs = 0;
    static void Bug(string name, bool reproduced, string detail = "") {
        Console.WriteLine((reproduced ? "  BUG REPRODUCED " : "  not reproduced ") + name + (detail != "" ? "  [" + detail + "]" : ""));
        if (reproduced) bugs++;
    }

    static void Main(string[] args) {
        string only = args.Length > 0 ? args[0] : "all";

        if (only == "all" || only == "vectors") {
        Console.WriteLine("== BIP38 official test vectors (decrypt) ==");
        var vec = new[] {
            // encrypted, passphrase, expected WIF, expected address
            new[]{"6PRVWUbkzzsbcVac2qwfssoUJAN1Xhrg6bNk8J7Nzm5H7kxEbn2Nh2ZoGg","TestingOneTwoThree","5KN7MzqK5wt2TP1fQCYyHBtDrXdJuXbUzm4A9rKAteGu3Qi5CVR","1Jq6MksXQVWzrznvZzxkV6oY57oWXD9TXB"},
            new[]{"6PRNFFkZc2NZ6dJqFfhRoFNMR9Lnyj7dYGrzdgXXVMXcxoKTePPX1dWByq","Satoshi","5HtasZ6ofTHP6HCwTqTkLDuLQisYPah7aUnSKfC7h4hMUVw2gi5","1AvKt49sui9zfzGeo8EyL8ypvAhtR2KwbL"},
            new[]{"6PYNKZ1EAgYgmQfmNVamxyXVWHzK5s6DGhwP4J5o44cvXdoY7sRzhtpUeo","TestingOneTwoThree","L44B5gGEpqEDRS9vVPz7QT35jcBG2r3CZwSwQ4fCewXAhAhqGVpP","164MQi977u9GUteHr4EPH27VkkdxmfCvGW"},
            new[]{"6PYLtMnXvfG3oJde97zRyLYFZCYizPU5T3LwgdYJz1fRhh16bU7u6PPmY7","Satoshi","KwYgW8gcxj1JWJXhPSu4Fqwzfhp5Yfi42mdYmMa4XqK7NJxXUSK7","1HmPbwsvG5qJ3KJfxzsZRZWhbm1xBMuS8B"},
            new[]{"6PfQu77ygVyJLZjfvMLyhLMQbYnu5uguoJJ4kMCLqWwPEdfpwANVS76gTX","TestingOneTwoThree","5K4caxezwjGCGfnoPTZ8tMcJBLB7Jvyjv4xxeacadhq8nLisLR2","1PE6TQi6HTVNz5DLwB1LcpMBALubfuN2z2"},
            new[]{"6PfLGnQs6VZnrNpmVKfjotbnQuaJK4KZoPFrAjx1JMJUa1Ft8gnf5WxfKd","Satoshi","5KJ51SgxWaAYR13zd9ReMhJpwrcX47xTJh2D3fGPG9CM8vkv5sH","1CqzrtZC6mXSAhoxtFwVjz8LtwLJjDYU3V"},
            new[]{"6PgNBNNzDkKdhkT6uJntUXwwzQV8Rr2tZcbkDcuC9DZRsS6AtHts4Ypo1j","MOLON LABE","5JLdxTtcTHcfYcmJsNVy1v2PMDx432JPoYcBTVVRHpPaxUrdtf8","1Jscj8ALrYu2y9TD8NrpvDBugPedmbj4Yh"},
            new[]{"6PgGWtx25kUg8QWvwuJAgorN6k9FbE25rv5dMRwu5SKMnfpfVe5mar2ngH","ΜΟΛΩΝ ΛΑΒΕ","5KMKKuUmAkiNbA3DazMQiLfDq47qs8MAEThm4yL8R2PhV1ov33D","1Lurmih3KruL4xDB5FmHof38yawNtP9oGf"},
        };
        foreach (var v in vec) {
            try {
                var k = new Bip38KeyPair(v[0]);
                bool ok = k.DecryptWithPassphrase(v[1]);
                var kp = ok ? k.GetUnencryptedPrivateKey() : null;
                Check(v[0].Substring(0, 12) + "... decrypt", ok && kp.PrivateKeyBase58 == v[2] && kp.AddressBase58 == v[3],
                      ok ? kp.PrivateKeyBase58 + " " + kp.AddressBase58 : "passphrase rejected");
                bool wrong = new Bip38KeyPair(v[0]).DecryptWithPassphrase(v[1] + "x");
                Check(v[0].Substring(0, 12) + "... wrong passphrase rejected", !wrong);
            } catch (Exception e) { Check(v[0].Substring(0, 12), false, e.GetType().Name + ": " + e.Message); }
        }

        Console.WriteLine("== BIP38 non-EC encrypt reproduces vectors ==");
        foreach (var v in vec.Take(4)) {
            var kp = new KeyPair(v[2]);
            var enc = new Bip38KeyPair(kp, v[1]).EncryptedPrivateKey;
            Check("encrypt " + v[2].Substring(0, 8) + "...", enc == v[0], enc);
        }

        Console.WriteLine("== Confirmation code (MOLON LABE vector) ==");
        try {
            var conf = new Bip38Confirmation("cfrm38V8aXBn7JWA1ESmFMUn6erxeBGZGAxJPY4e36S9QWkzZKtaVqLNMgnifETYw7BPwWC9aPD");
            bool ok = conf.DecryptWithPassphrase("MOLON LABE") == null;
            Check("confirmation validates", ok && conf.PublicKey.AddressBase58 == "1Jscj8ALrYu2y9TD8NrpvDBugPedmbj4Yh",
                ok ? conf.PublicKey.AddressBase58 : "rejected");
            Check("confirmation rejects wrong passphrase", new Bip38Confirmation("cfrm38V8aXBn7JWA1ESmFMUn6erxeBGZGAxJPY4e36S9QWkzZKtaVqLNMgnifETYw7BPwWC9aPD").DecryptWithPassphrase("MOLON LABEx") != null);
        } catch (Exception e) { Check("confirmation", false, e.GetType().Name + ": " + e.Message); }

        Console.WriteLine("== EC-multiply round trip: intermediate -> new key -> decrypt ==");
        {
            var inter = new Bip38Intermediate("correct horse", Bip38Intermediate.Interpretation.Passphrase);
            var onlyCode = new Bip38Intermediate(inter.Code, Bip38Intermediate.Interpretation.IntermediateCode);
            var ekp = new Bip38KeyPair(onlyCode);
            var addr = ekp.GetAddress().AddressBase58;
            var back = new Bip38KeyPair(ekp.EncryptedPrivateKey);
            bool ok = back.DecryptWithPassphrase("correct horse");
            Check("generated EC-multiply key decrypts with owner passphrase", ok && back.GetUnencryptedPrivateKey().AddressBase58 == addr);
            Check("lot number in 100000..999999 as the comment intends", inter.LotNumber >= 100000 && inter.LotNumber <= 999999, "lot=" + inter.LotNumber);
        }

        Console.WriteLine("== Minikey ==");
        {
            var mk = new MiniKeyPair("S6c56bnXQiBjk9mqSYE7ykVQ7NzrRy");
            Check("wiki minikey vector", mk.PrivateKeyBase58 == "5JPy8Zg7z4P7RSLsiqcqyeAF1935zjNUdMxcDeVrtU1oarrgnB7", mk.PrivateKeyBase58);
            bool allValid = true;
            for (int i = 0; i < 50; i++) { var r = MiniKeyPair.CreateRandom("x"); if (MiniKeyPair.IsValidMiniKey(r.MiniKey) != 1) allValid = false; }
            Check("50 random minikeys pass the typo check", allValid);
        }
        Console.WriteLine("== Plain key / address ==");
        {
            var kp = new KeyPair("5HueCGU8rMjxEXxiPuD5BDku4MkFqeZyd4dZ1jvhTVqvbTLvyTJ");
            Check("WIF -> address", kp.AddressBase58 == "1GAehh7TsJAHuUAeKZcXf5CnwuGuGgyX2S", kp.AddressBase58);
            // A WIF string carries its own compression flag, so use raw hex to request a compressed key.
            var kpc = new KeyPair("0C28FCA386C7A227600B2FE50B7CAE11EC86D3BF1FBE471BE89827E19D72AA1D", compressed: true);
            Check("compressed address", kpc.AddressBase58 == "1LoVGDgRs9hTfTNJNuXKSpywcbdvwRXpmK", kpc.AddressBase58);
            Check("compressed WIF", kpc.PrivateKeyBase58 == "KwdMAjGmerYanjeui5SHS7JkmpZvVipYvB2LJGU1ZxJwYvP98617", kpc.PrivateKeyBase58);
            // keys with leading zero bytes in X or Y (exercise the uncompressed encoder)
            bool okAll = true; var rnd = new Random(5);
            for (int i = 0; i < 3000; i++) {
                byte[] b = new byte[32]; rnd.NextBytes(b); b[0] &= 0x7f; if (b[0] == 0) b[0] = 1;
                var k1 = new KeyPair(b);
                var pub = k1.PublicKeyBytes;
                var p2 = new PublicKey(pub);         // validates on-curve
                var comp = new PublicKey(p2.GetCompressed());
                if (new PublicKey(comp.GetUncompressed()).PublicKeyHex != k1.PublicKeyHex) { okAll = false; break; }
            }
            Check("3000 random keys: uncompressed pubkey encoding round-trips", okAll);
        }
        }

        if (only == "all" || only == "bugs") {
        Console.WriteLine("== Bug: AddressGen 'Encryption passphrase or Intermediate Code' ==");
        {
            // Owner makes an intermediate code from their secret passphrase and hands only the code to a printer.
            var owner = new Bip38Intermediate("owner's secret passphrase", Bip38Intermediate.Interpretation.Passphrase);
            string pastedCode = owner.Code;
            // AddressGen.GenerationThreadProcess does exactly this with whatever is in the text box:
            var intermediate = new Bip38Intermediate(pastedCode, Bip38Intermediate.Interpretation.Passphrase);
            var ekp = new Bip38KeyPair(intermediate);
            bool ownerCan = new Bip38KeyPair(ekp.EncryptedPrivateKey).DecryptWithPassphrase("owner's secret passphrase");
            bool codeHolderCan = new Bip38KeyPair(ekp.EncryptedPrivateKey).DecryptWithPassphrase(pastedCode);
            Console.WriteLine("    owner's real passphrase decrypts it:           " + ownerCan);
            Console.WriteLine("    the (non-secret) intermediate code decrypts it: " + codeHolderCan);
            Bug("pasted intermediate code is treated as a passphrase", !ownerCan && codeHolderCan);
        }

        Console.WriteLine("== Bug: Util.PassphraseTooSimple is inverted ==");
        foreach (var p in new[] { "password", "correct horse battery staple", "aaaaaaaaaaaaaaaaaaaa", "letmein123" }) {
            Console.WriteLine("    PassphraseTooSimple(\"" + p + "\") = " + Util.PassphraseTooSimple(p));
        }

        Console.WriteLine("== Bip38KeyPair(key, \"\") accepts an empty passphrase ==");
        try {
            var kp = new KeyPair("5HueCGU8rMjxEXxiPuD5BDku4MkFqeZyd4dZ1jvhTVqvbTLvyTJ");
            var e = new Bip38KeyPair(kp, "");
            Console.WriteLine("    produced " + e.EncryptedPrivateKey + ", decrypts with \"\": " + new Bip38KeyPair(e.EncryptedPrivateKey).DecryptWithPassphrase(""));
        } catch (Exception ex) { Console.WriteLine("    threw " + ex.GetType().Name); }

        Console.WriteLine("== ShaPassphraseKeyPair encrypt constructor ==");
        try {
            var kp = new KeyPair("5HueCGU8rMjxEXxiPuD5BDku4MkFqeZyd4dZ1jvhTVqvbTLvyTJ");
            var s = new ShaPassphraseKeyPair(kp, "pw");
            Console.WriteLine("    produced " + s.EncryptedPrivateKey);
        } catch (Exception ex) { Console.WriteLine("    threw " + ex.GetType().Name + " (never copies the private key in)"); }

        Console.WriteLine("== Deterministic seeds overlap (AddressGen/Walletgen: SHA256(seed + n)) ==");
        {
            var a = KeyPair.CreateFromString("mysecret1" + 1);   // seed "mysecret1", key #1
            var b = KeyPair.CreateFromString("mysecret" + 11);   // seed "mysecret",  key #11
            Bug("seed 'mysecret1' key #1 == seed 'mysecret' key #11", a.AddressBase58 == b.AddressBase58, a.AddressBase58);
        }
        }

        if (only == "all" || only == "mofn") {
        Console.WriteLine("== M-of-N decode depends on the order shares are typed in ==");
        var rng = new Random(3);
        for (int M = 2; M <= 8; M++) {
            int N = 8, wrong = 0, total = 0, wrongButChecksumOk = 0, noKey = 0;
            string example = null;
            for (int t = 0; t < 3; t++) {
                var g = new MofN(); g.Generate(M, N);
                var parts = g.GetKeyParts(); string addr = g.BitcoinAddress;
                for (int trial = 0; trial < 400; trial++) {
                    var order = Enumerable.Range(0, N).OrderBy(x => rng.Next()).Take(M).ToList();
                    var d = new MofN();
                    foreach (int i in order) d.AddKeyPart(parts[i]);
                    d.Decode(); total++;
                    if (d.BitcoinAddress != addr) {
                        wrong++;
                        if (d.BitcoinAddress == null) noKey++;
                        if (d.ChecksumMatched) wrongButChecksumOk++;
                        if (example == null) example = string.Join(",", order.Select(x => (x + 1).ToString()));
                    }
                }
            }
            Console.WriteLine(string.Format("    {0}-of-8: {1}/{2} random orderings give the WRONG key ({3} of those show no key at all){4}",
                M, wrong, total, noKey, example != null ? "; e.g. parts entered as " + example : ""));
        }
        }

        if (only == "minibatch") {
        // Same call the bulk generator makes (Forms/AddressGen.cs, GenChoices.Minikey), repeated.
        // Writes minikeys.csv (minikey,address) for analysis/verify_minikeys.py to check independently.
        int count = args.Length > 1 ? int.Parse(args[1]) : 5000;
        Console.WriteLine("== Bulk mini key generation: " + count + " keys ==");
        var sw = System.Diagnostics.Stopwatch.StartNew();
        var seen = new HashSet<string>();
        int invalid = 0, dupes = 0;
        using (var w = new System.IO.StreamWriter("minikeys.csv")) {
            w.WriteLine("minikey,address");
            for (int i = 0; i < count; i++) {
                MiniKeyPair mkp = MiniKeyPair.CreateRandom(ExtraEntropy.GetEntropy());
                string addr = mkp.AddressBase58;
                if (MiniKeyPair.IsValidMiniKey(mkp.MiniKey) != 1 || mkp.MiniKey.Length != 30) invalid++;
                if (!seen.Add(mkp.MiniKey)) dupes++;
                w.WriteLine(mkp.MiniKey + "," + addr);
            }
        }
        Check("all " + count + " keys are valid 30-character mini keys", invalid == 0, invalid + " invalid");
        Check("no duplicate keys", dupes == 0, dupes + " duplicates");
        Console.WriteLine(string.Format("    {0:F1} keys/second; wrote minikeys.csv", count / sw.Elapsed.TotalSeconds));
        }

        Console.WriteLine();
        Console.WriteLine("Checks passed: " + pass + ", failed: " + fail + "; bugs reproduced: " + bugs);
    }
}
