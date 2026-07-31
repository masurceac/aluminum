#!/bin/bash
# Rebuilds assets/icon.icns from scripts/gen-icon.swift. One-time output is
# committed; rerun only when the icon design changes.
set -euo pipefail
cd "$(dirname "$0")/.."

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

swift scripts/gen-icon.swift "$tmp"

iconset="$tmp/icon.iconset"
mkdir "$iconset"
for s in 16 32 128 256 512; do
  sips -z $s $s "$tmp/icon-1024.png" --out "$iconset/icon_${s}x${s}.png" > /dev/null
  d=$((s * 2))
  sips -z $d $d "$tmp/icon-1024.png" --out "$iconset/icon_${s}x${s}@2x.png" > /dev/null
done

iconutil -c icns "$iconset" -o assets/icon.icns
echo "wrote assets/icon.icns"
