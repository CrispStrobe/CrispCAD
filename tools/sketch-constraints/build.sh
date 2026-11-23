#!/bin/sh
# SPDX-License-Identifier: BSD-3-Clause
set -eu
cd "$(dirname "$0")"
build="$(mktemp -d)"
trap 'rm -rf "$build"' EXIT
dart pub get --enforce-lockfile
dart compile js -O2 --no-source-maps -o "$build/solver.js" solver.dart
install -m 644 "$build/solver.js" ../../packages/editor/assets/sketch-constraints.dart.js
