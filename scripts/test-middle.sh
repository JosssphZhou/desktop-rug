#!/bin/zsh
# 回归测试：照视频抓中间拖来拖去，松手后不会揉成一团。只在本机临时开一个地毯窗口，不动真鼠标。
set -euo pipefail
cd "${0:A:h}/.."
export RUG_ROOT="$PWD"
"${RUG_BIN:-./build/DesktopRug}" --material persian --rug 1280,780,680 --eval-file tests/middle-grab.js --quit-after 90 2>&1 | grep "\[回归\]" | sed 's/^.*\[回归\] //'
