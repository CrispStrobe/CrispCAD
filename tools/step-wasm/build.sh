#!/bin/sh
# SPDX-License-Identifier: BSD-3-Clause
set -eu
repo="$(cd "$(dirname "$0")/../.." && pwd)"
target="$(mktemp -d)"
trap 'rm -rf "$target"' EXIT
toolchain=1.100.0
rustc="$(rustup which --toolchain "$toolchain" rustc)"
RUSTC="$rustc" rustup run "$toolchain" cargo build --release --locked --target wasm32-unknown-unknown \
 --manifest-path "$repo/tools/step-wasm/Cargo.toml" --target-dir "$target"
install -m 644 "$target/wasm32-unknown-unknown/release/brickwright_step.wasm" \
 "$repo/packages/editor/assets/step-tessellator.wasm"
