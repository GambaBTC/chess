#!/usr/bin/env bash
# Rebuilds the key-handling classes of Bitcoin Address Utility (Model/ + CryptSharp/)
# against BouncyCastle 1.7 under Mono, then runs harness/Harness.cs against them.
#
#   ./build-and-test.sh            run everything
#   ./build-and-test.sh vectors    official BIP38 / address test vectors only
#   ./build-and-test.sh bugs       bug reproductions only
#   ./build-and-test.sh mofn       M-of-N decode-order test only
#   ./build-and-test.sh rng        BouncyCastle 1.7 random-seed check
#
# Needs: mono-mcs, mono-runtime, curl, unzip (Debian/Ubuntu: apt-get install mono-mcs mono-runtime curl unzip)
# Uses GNU sed. Output goes to ./build (git-ignored).
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="$HERE/upstream"
OUT="${OUT:-$HERE/build}"
WHAT="${1:-all}"

command -v mcs >/dev/null || { echo "mcs not found: install Mono (apt-get install mono-mcs mono-runtime)"; exit 1; }
mkdir -p "$OUT/src" "$OUT/nuget"

# BouncyCastle 1.7.0, the version this 2013 code was written against (newer versions do not compile with it).
if [ ! -f "$OUT/BouncyCastle.Crypto.dll" ]; then
  curl -sSL -o "$OUT/nuget/bc17.nupkg" https://www.nuget.org/api/v2/package/BouncyCastle/1.7.0
  (cd "$OUT/nuget" && unzip -qo bc17.nupkg lib/Net40-Client/BouncyCastle.Crypto.dll)
  cp "$OUT/nuget/lib/Net40-Client/BouncyCastle.Crypto.dll" "$OUT/"
fi

# Copy the sources and make two non-functional edits so they compile on Mono's newer framework:
# drop an unused System.Drawing import, and alias ECPoint (newer System.Core also defines one).
rm -f "$OUT"/src/*.cs
cp "$SRC"/Model/*.cs "$SRC"/CryptSharp/*.cs "$OUT/src/"
for f in "$OUT"/src/*.cs; do
  sed -i 's/^using System\.Drawing;//' "$f"
  if grep -q ECPoint "$f"; then
    sed -i '0,/^namespace/s//using ECPoint = Org.BouncyCastle.Math.EC.ECPoint;\nnamespace/' "$f"
  fi
done

NOWARN="-nowarn:162,168,219,414,169,649"
mcs $NOWARN -target:library -out:"$OUT/Casascius.dll" -r:"$OUT/BouncyCastle.Crypto.dll" -r:System.Core.dll "$OUT"/src/*.cs
mcs $NOWARN -out:"$OUT/Harness.exe" -r:"$OUT/Casascius.dll" -r:"$OUT/BouncyCastle.Crypto.dll" -r:System.Core.dll "$HERE/harness/Harness.cs"
mcs $NOWARN -out:"$OUT/Rng.exe" -r:"$OUT/BouncyCastle.Crypto.dll" -r:System.Core.dll "$HERE/harness/Rng.cs"

cd "$OUT"
if [ "$WHAT" = "rng" ]; then
  mono Rng.exe
elif [ "$WHAT" = "all" ]; then
  mono Harness.exe all
  mono Rng.exe
else
  mono Harness.exe "$WHAT"
fi
