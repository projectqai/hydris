#!/bin/bash
# Download and prepare the CEF binary distribution for macOS.
# Run once before building the shim.
#
# Usage: ./fetch_cef.sh [arm64|x86_64]

set -euo pipefail

ARCH="${1:-arm64}"
CEF_VERSION="${CEF_VERSION:-138.0.59+g21d63d5+chromium-138.0.7204.306}"

case "$ARCH" in
	arm64|aarch64) CEF_ARCH="macosarm64" ;;
	x86_64|amd64)  CEF_ARCH="macosx64"   ;;
	*) echo "unsupported arch: $ARCH" >&2; exit 1 ;;
esac

DIR="$(cd "$(dirname "$0")" && pwd)"
CEF_DIR="$DIR/cef"

WRAPPER_A="$CEF_DIR/build/libcef_dll_wrapper/libcef_dll_wrapper.a"

if [ -f "$CEF_DIR/Release/Chromium Embedded Framework.framework/Chromium Embedded Framework" ]; then
	echo "CEF already present at $CEF_DIR"
	exit 0
fi

CEF_NAME="cef_binary_${CEF_VERSION}_${CEF_ARCH}_minimal"
CEF_URL_VERSION="${CEF_VERSION//+/%2B}"
CEF_URL="https://cef-builds.spotifycdn.com/cef_binary_${CEF_URL_VERSION}_${CEF_ARCH}_minimal.tar.bz2"

# Download if not already present
if [ ! -d "$CEF_DIR/include" ]; then
	echo "Downloading CEF ($CEF_ARCH)..."
	TMPDIR=$(mktemp -d)
	trap 'rm -rf "$TMPDIR"' EXIT

	curl -fSL --progress-bar -o "$TMPDIR/cef.tar.bz2" "$CEF_URL"

	echo "Extracting..."
	tar -xjf "$TMPDIR/cef.tar.bz2" -C "$TMPDIR"

	rm -rf "$CEF_DIR"
	mv "$TMPDIR/$CEF_NAME" "$CEF_DIR"
fi

# The wrapper is only needed when compiling the shim on macOS.
# On other platforms we only need the framework for bundling.
if [ "$(uname -s)" != "Darwin" ]; then
	echo "CEF framework downloaded (wrapper build skipped — not on macOS)"
	exit 0
fi

if [ -f "$WRAPPER_A" ]; then
	echo "CEF wrapper already built"
	exit 0
fi

echo "Building libcef_dll_wrapper..."
cmake -S "$CEF_DIR" -B "$CEF_DIR/build" \
	-DCMAKE_BUILD_TYPE=Release \
	-DPROJECT_ARCH="$ARCH" \
	-DCEF_RUNTIME_LIBRARY_FLAG="/MD" 2>/dev/null

cmake --build "$CEF_DIR/build" --target libcef_dll_wrapper --config Release -j "$(sysctl -n hw.ncpu)"

echo "CEF ready at $CEF_DIR"
