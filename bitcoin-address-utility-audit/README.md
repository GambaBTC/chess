# Security review: Bitcoin Address Utility (casascius)

Review of [casascius/Bitcoin-Address-Utility](https://github.com/casascius/Bitcoin-Address-Utility)
at commit `dcfc3b99a3df1427fc19fcfbe18c1bfedfdad4eb` (3 Feb 2013, the latest).
The question: can its address and key generation be trusted, and is there anything that could expose the keys?

**Verdict:** the core cryptography is correct, but I would not use the tool as-is to create keys for real funds.
One bug can leave keys "encrypted" with a code that isn't secret, and every random number comes from a weak
generator in the 2013 version of its crypto library.

## What's in this folder

| Path | What it is |
| --- | --- |
| `upstream/` | Unmodified copy of the reviewed source (GPLv3, see file headers), without its `.git` folder |
| `build-and-test.sh` | Compiles `upstream/Model` + `upstream/CryptSharp` against BouncyCastle 1.7 under Mono and runs the harness |
| `harness/Harness.cs` | Runs the real classes against official test vectors and reproduces the bugs below |
| `harness/Rng.cs` | Checks what BouncyCastle 1.7's default random generator is seeded from |
| `analysis/mofn_leak.py` | How much of the key M-1 shares of the M-of-N scheme reveal |
| `analysis/mofn_decode.py` | Python port of the M-of-N decoder, including C# 64-bit overflow |
| `analysis/mofn_order_test.py` | Tries every share order through that port (`python3 mofn_order_test.py mofn_decode.py`) |
| `analysis/verify_minikeys.py` | Independent checker for a list of mini keys and addresses: run it before funding coins |

To rerun everything: `./build-and-test.sh` (needs `mono-mcs mono-runtime curl unzip`). The build makes two
non-functional edits to copies of the sources so they compile on Mono: it removes an unused `using System.Drawing;`
and adds an alias for `ECPoint`. `upstream/` itself is not changed.

## Verified correct

- **BIP38 encryption:** all 8 official test vectors decrypt to the right key and address (plain, compressed,
  EC-multiply, lot/sequence, Greek passphrase), and wrong passphrases are rejected. Encrypting the plain-mode
  vectors reproduces the official ciphertexts exactly, and the confirmation-code vector validates.
- **Address derivation:** WIF → address, compressed and uncompressed public keys (3,000 random keys round-trip),
  Base58Check, and the published mini-key example.
- **Public keys** typed in are checked to be on the curve.
- **Plain random keys** (`KeyPair.Create`, mini keys) mix the generator's output with a SHA-256 of mouse moves,
  keystrokes and timestamps, which softens problem 2.

## Findings, most serious first

### 1. High: an intermediate code pasted into "Encrypted" mode is used as the passphrase
`upstream/Forms/AddressGen.cs:190` (label at line 70)

An intermediate code is the `passphrase…` code a key owner gives someone so they can generate keys only the owner
can unlock. The box is labelled "Encryption passphrase or Intermediate Code", but the code always calls
`new Bip38Intermediate(UserText, Interpretation.Passphrase)`. The harness reproduces it: the owner's real
passphrase can't decrypt the keys, and the intermediate code string itself can. The owner thinks the funds are
locked, while anyone who saw the code can take them.
**Workaround:** put intermediate codes on the clipboard and use the two-factor mode.
**Fix:** detect a valid intermediate code and use `Interpretation.IntermediateCode`.

### 2. High (design): no operating-system randomness
9 call sites of `new SecureRandom()`, for example `upstream/Model/KeyPair.cs:66`, `Model/EscrowCode.cs:83,170`,
`Model/MofN.cs:132`, `Model/Bip38KeyPair.cs:316`

In BouncyCastle C# before 1.8.0 (2014), the default `SecureRandom()` was seeded only from `DateTime.Now.Ticks` and a
thread-timing counter (`ThreadedSeedGenerator`). It never read the OS random source; that was added in BouncyCastle
commits `8accb371` and `b494cecf` (2014). Escrow codes and M-of-N splits get all of their key material from it.
In BIP38 EC-multiply mode the key also depends on the passphrase, and plain keys are partly protected by the
mouse/keyboard mixing.

On the test machine the timing seed looked statistically random (about 7.5 bits per byte), so no practical attack
was shown. It is still not an acceptable source for keys, and its quality depends on the hardware.

Upgrading the library isn't an option: the code does not compile against BouncyCastle 1.8.9 or 2.4.0
(`ECPoint.X`/`Y` and other APIs were removed). **Fix:** `new SecureRandom(new CryptoApiRandomGenerator())` at each
call site. That class exists in 1.7 and was confirmed to work.

### 3. Medium: brain-wallet modes, and the strength check is inverted
- Three features hash user text straight into keys, with no salt or slowdown. Keys made from human-chosen phrases
  are swept by bots:
  - the main window's SHA256 → private key button (`Forms/Form1.cs:153`)
  - the wallet generator, `SHA256(passphrase + n)` (`Forms/Walletgen.cs:100`)
  - the address generator's deterministic mode (`Forms/AddressGen.cs:209`)
- `Util.PassphraseTooSimple` returns false for every input that isn't a mini key (`Model/Bitcoin.cs:360`:
  `!= 1` should be `== 1`). Reproduced: `"password"`, `"letmein123"` and `"correct horse battery staple"` all pass.
  Only a "shorter than 20 characters" warning remains.
- Seeds overlap: seed `mysecret1` key #1 is the same key as seed `mysecret` key #11 (reproduced).
- The wallet generator's default passphrase is fine: 80 characters from the OS random source.

### 4. Medium: M-of-N key splitting is homemade and unreliable
The app itself warns that this feature is experimental.
- Decoding keeps its coefficients in 64-bit `long`s that overflow (`Model/MofN.cs:446`). Out of 1,200 random entry
  orders each, using the real code, decoding failed 16% of the time for 6-of-8, 38% for 7-of-8 and 56% for 8-of-8.
  2- to 5-of-N never failed. Almost every failure shows a blank key, but in one run 1 of the 196 failed 6-of-8
  decodes produced a different, wrong key. Entering parts in order 1, 2, 3… works, so a backup isn't lost, but it
  can look lost or show the wrong key.
- The window ignores the scheme's 9-bit checksum, so a wrong key is shown with no warning (`Forms/MofNcalc.cs:121`).
- Shares are sums over plain integers, not over a finite field, so holding one share fewer than needed reveals up to
  about 26 of the 256 key bits (`analysis/mofn_leak.py`). That's not exploitable, but a real threshold scheme reveals
  nothing.

### 5. Low: other bugs
- **Empty passphrase:** `Bip38KeyPair(key, passphrase)` accepts `""` (`Model/Bip38KeyPair.cs:258`, `&&` should be
  `||`). Reproduced. The windows block empty passphrases, so this only matters if the class is reused.
- **Mislabelled box:** for encrypted items, the "private key hex" box shows the public key (`Forms/Form1.cs:63`).
- **"6p…" format:** `ShaPassphraseKeyPair` encryption throws because it never copies the key in
  (`Model/ShaPassphraseKeyPair.cs:92`). That fails safe, but the format is unsalted SHA-256 with a 15-bit
  passphrase check, so it's fast to brute-force. Don't trust "6p…" keys from elsewhere.
- **Escrow:**
  - The confirmation-code header is masked with `0x7F` instead of `0xFF` (`Model/EscrowCode.cs:376`).
  - Three-code redemption never checks the result against the address stored in the payment code
    (`Model/EscrowCode.cs:359`).
- **Paper Wallet Printer:** it never stores the keys it generates, so it prints nothing
  (`Forms/PaperWalletPrinter.cs:160`).
- **Lenient input:**
  - A trailing `?` disables the Base58Check checksum (`Model/Bitcoin.cs:154`).
  - Hex parsing drops invalid characters and zero-pads short input, so a typo gives a different valid key.
- **Lot numbers:** BIP38 lot numbers can fall outside the intended 100000–999999 range because `NextLong()` can be
  negative (`Model/Bip38Intermediate.cs:96`). Cosmetic.

### 6. Operational risks
- "Copy QR" puts private keys on the clipboard (`Forms/Form1.cs:733`), where Windows clipboard history can keep them.
- "Save private keys" writes a plain `.txt` file (`Forms/KeyCollectionView.cs:373`).
- The block explorer button sends your address to a third party over plain HTTP (`Forms/Form1.cs:333`).
- Debug builds print M-of-N secret parts to debug output (`Model/MofN.cs:147`).
- The code has been unmaintained since February 2013, makes only legacy `1…` addresses, and needs Windows with
  .NET Framework.

## Bulk mini key generation (for physical coins)

The "Mini keys" option in the address generator (`Forms/AddressGen.cs:199`) calls `MiniKeyPair.CreateRandom` once
per key.

**Correct:**
- 30-character `S…` keys with the standard typo check (SHA256(key + "?") starts with 0x00).
- The private key is SHA256(key), with an uncompressed legacy address.
- About 160 bits of key space per key, which is plenty.
- `./build-and-test.sh minibatch` generated 5,000 keys with the real code: all valid, no duplicates, and no
  character bias in any position.
- `analysis/verify_minikeys.py`, a separate implementation, re-derived every address and they all matched. The Bitcoin
  wiki's example key also checks out.

**Not safe as-is:** the randomness. Each key is SHA256 of a timestamp, the app's mouse-movement string and 64
characters from BouncyCastle 1.7's `SecureRandom` (`Model/MiniKeyPair.cs:93`). During a bulk run, the generator
dialog collects no mouse movement, and the main window only collects it over its menu bar
(`Forms/KeyCollectionView.cs:333`). So apart from `SecureRandom`, each key gets only a fresh timestamp.

All keys in a run come from one generator state, seeded once per program start from the clock and thread timing
(problem 2). If that seed were ever guessable, every coin in the batch would fall together. The funded addresses are
public, so an attacker can check guesses offline. No attack was demonstrated, but coins are long-lived, public and
made in batches, which is exactly the case to rule out. Fix `Model/MiniKeyPair.cs:93` as in problem 2, or generate
the keys with a separate tool that uses the OS random source.

**Before funding coins:**
- Generate and print on an offline computer, with the printer on USB rather than the network. Print jobs and any
  saved key list are copies of the keys.
- Export the list ("Save private keys" writes `minikey address` lines) and run
  `python3 analysis/verify_minikeys.py keys.txt`. It confirms each key controls the address listed next to it and
  flags typos and duplicates. Then delete the file.
- The coin-insert layout prints the key in 4.5 pt text inside a 7/16" circle (`Reports/CoinInsert.cs:94-114`).
  Make a test print and type a few keys back into the verifier, because confusable characters (`C`/`c`, `K`/`k`,
  `Z`/`2`, `S`/`5`) can slip past the 1-in-256 typo check.
- Recipients need a wallet that can sweep mini keys (Electrum can; many wallets can't). Uncompressed legacy addresses
  also cost a little more in fees to redeem.

## Recommendations

If you use it at all:
- Apply the fix for problem 2.
- Run it on an offline computer.
- Stick to plain random keys or BIP38 encryption.
- Never paste intermediate codes into "Encrypted" mode.
- Avoid the brain-wallet, deterministic, M-of-N and escrow features.

For real funds, a maintained wallet (a hardware wallet, Bitcoin Core or Sparrow) is the safer choice.

None of the fixes above have been applied yet; `upstream/` is the original code.
