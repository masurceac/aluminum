#!/usr/bin/env bash
# Compiles the macOS selection helper. Requires Xcode Command Line Tools
# (xcode-select --install if swiftc is missing).
set -euo pipefail
cd "$(dirname "$0")"
swiftc -O SelectionHelper.swift -o SelectionHelper
echo "built $(pwd)/SelectionHelper"
