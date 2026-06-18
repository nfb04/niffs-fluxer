#!/usr/bin/env bash
set -euo pipefail

# Build a niffbot-branded Fluxer desktop client (Windows portable or Linux AppImage).
#
# Usage:
#   TARGET=win ./scripts/build-niffbot-desktop.sh
#   TARGET=linux ./scripts/build-niffbot-desktop.sh
#
# Environment:
#   NIFFBOT_INSTANCE_URL  default https://chat.niffbot.com (first-launch default; official still works)
#   NIFFBOT_PRODUCT_NAME  default "Niffs Fluxer"
#   TARGET                win | linux (default: win)
#   DESKTOP_ARCH          x64 (default)
#   OUTPUT_DIR            where to copy release files (default: ../stack/downloads/desktop)
#
# Windows on Linux: experimental cargo-xwin cross-compile (needs clang). If webrtc natives fail,
# use GitHub Actions instead: gh workflow run build-niffbot-desktop.yml -f target=win

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

NIFFBOT_INSTANCE_URL="${NIFFBOT_INSTANCE_URL:-https://chat.niffbot.com}"
NIFFBOT_PRODUCT_NAME="${NIFFBOT_PRODUCT_NAME:-Niffs Fluxer}"
BUILD_CHANNEL="${BUILD_CHANNEL:-stable}"
TARGET="${TARGET:-win}"
DESKTOP_ARCH="${DESKTOP_ARCH:-x64}"
OUTPUT_DIR="${OUTPUT_DIR:-$ROOT/../stack/downloads/desktop}"

export FLUXER_DEFAULT_APP_URL="$NIFFBOT_INSTANCE_URL"
export NIFFBOT_PRODUCT_NAME
export PUBLIC_RELEASE_CHANNEL="$BUILD_CHANNEL"
export RELEASE_CHANNEL="$BUILD_CHANNEL"
export BUILD_CHANNEL
export NODE_ENV=production
export FLUXER_DESKTOP_PRODUCTION=true
export ELECTRON_ARCH="$DESKTOP_ARCH"
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$ROOT/.cargo-target}"
mkdir -p "$CARGO_TARGET_DIR"

echo "==> Building desktop client for ${NIFFBOT_INSTANCE_URL} (TARGET=${TARGET}, ARCH=${DESKTOP_ARCH})"

ensure_pnpm() {
	if command -v pnpm >/dev/null 2>&1; then
		return
	fi
	if ! command -v corepack >/dev/null 2>&1; then
		echo "pnpm is required. Install Node.js with corepack, or install pnpm globally." >&2
		exit 1
	fi
	echo "==> Enabling pnpm via corepack"
	corepack enable
	corepack prepare pnpm@10.29.3 --activate
}

ensure_rust() {
	if command -v cargo >/dev/null 2>&1; then
		return
	fi
	echo "Rust toolchain is required for desktop native modules." >&2
	echo "Install from https://rustup.rs/ then re-run this script." >&2
	exit 1
}

setup_windows_cross_compile() {
	if [[ "$(uname -s)" != "Linux" ]]; then
		return
	fi
	ensure_rust
	rustup target add x86_64-pc-windows-msvc >/dev/null 2>&1 || true
	if ! command -v cargo-xwin >/dev/null 2>&1; then
		echo "==> Installing cargo-xwin for Windows cross-compilation"
		cargo install cargo-xwin --locked
	fi
	export CARGO="${CARGO:-cargo-xwin}"
	if ! command -v clang-cl >/dev/null 2>&1; then
		echo "clang-cl is required for Windows cross-compilation: sudo apt install clang lld llvm" >&2
		exit 1
	fi
	export FLUXER_NATIVE_PACKAGE_PLATFORM=win32
	export FLUXER_NATIVE_TARGET_PLATFORM=win32
	echo "==> Windows natives will cross-compile via cargo-xwin (SDK downloads on first build)"
}

setup_linux_native_deps() {
	if ! command -v pkg-config >/dev/null 2>&1; then
		echo "pkg-config is required for Linux native modules." >&2
		exit 1
	fi
	if ! pkg-config --exists libpipewire-0.3 2>/dev/null; then
		echo "libpipewire-0.3-dev is required: sudo apt install libpipewire-0.3-dev" >&2
		exit 1
	fi
}

package_windows_portable_zip() {
	local dist_dir="$ROOT/fluxer_desktop/dist-electron"
	local unpacked=""
	for candidate in "$dist_dir"/win-unpacked "$dist_dir"/win-"$DESKTOP_ARCH"-unpacked; do
		if [[ -d "$candidate" ]]; then
			unpacked="$candidate"
			break
		fi
	done
	if [[ -z "$unpacked" ]]; then
		echo "Could not find unpacked Windows build in $dist_dir" >&2
		ls -la "$dist_dir" 2>/dev/null || true
		exit 1
	fi
	touch "$unpacked/.portable"
	local zip_name="niffs-fluxer-windows-${DESKTOP_ARCH}-portable.zip"
	local zip_path="$dist_dir/$zip_name"
	rm -f "$zip_path"
	(
		cd "$unpacked"
		zip -r -q "$zip_path" .
	)
	echo "==> Created $zip_path"
}

copy_artifacts_to_downloads() {
	mkdir -p "$OUTPUT_DIR"
	case "$TARGET" in
		win)
			local zip="$ROOT/fluxer_desktop/dist-electron/niffs-fluxer-windows-${DESKTOP_ARCH}-portable.zip"
			if [[ -f "$zip" ]]; then
				cp -f "$zip" "$OUTPUT_DIR/"
			fi
			;;
		linux)
			local appimage
			appimage="$(find "$ROOT/fluxer_desktop/dist-electron" -maxdepth 1 -name '*.AppImage' -print -quit || true)"
			if [[ -n "$appimage" ]]; then
				cp -f "$appimage" "$OUTPUT_DIR/niffs-fluxer-linux-${DESKTOP_ARCH}.AppImage"
			fi
			;;
	esac
	echo "==> Artifacts copied to $OUTPUT_DIR"
	ls -la "$OUTPUT_DIR"
}

ensure_pnpm
ensure_rust

case "$TARGET" in
	win)
		setup_windows_cross_compile
		echo "==> Rebuilding fluxer-ci (desktop native build driver)"
		touch "$ROOT/tools/ci/src/desktop_native.rs"
		cargo build --locked --quiet --manifest-path "$ROOT/tools/ci/Cargo.toml"
		;;
	linux)
		export FLUXER_NATIVE_PACKAGE_PLATFORM=linux
		setup_linux_native_deps
		;;
	*)
		echo "Unsupported TARGET=${TARGET}. Use win or linux." >&2
		exit 1
		;;
esac

echo "==> Installing dependencies"
pnpm install --filter fluxer_desktop... --filter @fluxer/voice_engine_v2...

echo "==> Bundling desktop main/preload (+ native modules)"
pnpm --dir fluxer_desktop build

case "$TARGET" in
	win)
		echo "==> Packaging Windows ${DESKTOP_ARCH} portable build"
		pnpm --dir fluxer_desktop exec electron-builder --win --"${DESKTOP_ARCH}" -c.win.target=dir
		package_windows_portable_zip
		;;
	linux)
		echo "==> Packaging Linux ${DESKTOP_ARCH} AppImage"
		pnpm --dir fluxer_desktop exec electron-builder --linux --"${DESKTOP_ARCH}" -c.linux.target=AppImage
		;;
esac

copy_artifacts_to_downloads
echo "==> Done."
