#!/bin/zsh
# 本机编译，不签名。产物在 build/DesktopRug。
set -e
cd "${0:A:h}/.."
mkdir -p build
~/.claude/bin/buildq -- swiftc -O -o build/DesktopRug Sources/main.swift -framework AppKit -framework WebKit
echo "编译完成：build/DesktopRug"
