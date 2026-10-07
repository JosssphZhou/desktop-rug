#!/bin/zsh
# 回归测试：抓边往地毯里拉不折出像第二张地毯的平躺矩形，抓角仍然对折。窗口放在墙纸下面，不写回平时的摆放。
set -euo pipefail
cd "${0:A:h}/.."
export RUG_ROOT="${RUG_ROOT:-$PWD}"
"${RUG_BIN:-./build/DesktopRug}" --material persian --rug 1280,720,632 --level -2147483630 --eval-file tests/edge-across.js --quit-after 30 2>&1 | grep '\[回归\]' | sed 's/^.*\[回归\] //'
