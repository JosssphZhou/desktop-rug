#!/bin/zsh
# 本机编译，不签名。产物在 build/DesktopRug；设了 RUG_BUILD_DIR 就放到那个目录。
set -e
cd "${0:A:h}/.."
out="${RUG_BUILD_DIR:-build}"
mkdir -p "$out"
~/.claude/bin/buildq -- swiftc -O -o "$out/DesktopRug" Sources/main.swift -framework AppKit -framework WebKit
echo "编译完成：$out/DesktopRug"
