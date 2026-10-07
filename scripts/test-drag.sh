#!/bin/zsh
# 回归测试：拉地毯边时布不能被拉长，松手后不留破布。只在本机临时开一个地毯窗口，不动真鼠标。
set -e
cd "${0:A:h}/.."
./build/DesktopRug --material persian --rug 1280,780,680 --eval-file tests/pull-edge.js --quit-after 20 2>&1 | grep "\[回归\]" | sed 's/^.*\[回归\] //'
