#!/bin/zsh
# 回归测试：掀皱以后按 Option 放平，地毯不会突然转向或跳走。只在本机临时开一个地毯窗口，不动真鼠标。
set -euo pipefail
cd "${0:A:h}/.."
export RUG_ROOT="$PWD"
"${RUG_BIN:-./build/DesktopRug}" --material persian --rug 1280,780,680 --eval-file tests/flatten-crumpled.js --quit-after 90 2>&1 | grep "\[回归\]" | sed 's/^.*\[回归\] //'
