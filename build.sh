#!/bin/sh
# Build the SDK and pack it for download from the docs site:
#   services/site/downloads/valtu-wallet-kit-<version>.tgz (+ -latest.tgz)
set -eu
cd "$(dirname "$0")"
TSC="${TSC:-./node_modules/.bin/tsc}"
[ -x "$TSC" ] || TSC="npx --yes -p typescript@5.9 tsc"
rm -rf dist
$TSC -p tsconfig.json
# No chmod: npm marks the bin executable on install, and leaving modes alone keeps this file
# byte-for-byte the tarball published to npm (npm publish packs the same way).
OUT="${1:-../../services/site/downloads}"
mkdir -p "$OUT"
VERSION=$(node -p "require('./package.json').version")
npm pack --silent --pack-destination "$OUT" >/dev/null
cp "$OUT/valtu-wallet-kit-$VERSION.tgz" "$OUT/valtu-wallet-kit-latest.tgz"
# Checksums next to the downloads (the pack is reproducible: same commit, same bytes).
(cd "$OUT" && shasum -a 256 "valtu-wallet-kit-$VERSION.tgz" "valtu-wallet-kit-latest.tgz" > SHA256SUMS.txt 2>/dev/null || sha256sum "valtu-wallet-kit-$VERSION.tgz" "valtu-wallet-kit-latest.tgz" > SHA256SUMS.txt)
echo "$OUT/valtu-wallet-kit-$VERSION.tgz"
