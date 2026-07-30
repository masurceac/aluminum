#!/usr/bin/env bash
# Compiles the macOS selection helper. Requires Xcode Command Line Tools
# (xcode-select --install if swiftc is missing).
set -euo pipefail
cd "$(dirname "$0")"
if ! command -v swiftc >/dev/null 2>&1; then
  echo "swiftc not found — install Xcode Command Line Tools: xcode-select --install" >&2
  exit 1
fi
swiftc -O SelectionHelper.swift -o SelectionHelper
echo "built $(pwd)/SelectionHelper"
