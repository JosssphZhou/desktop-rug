#!/bin/zsh
# 回归测试：按住 Option 时角外旋转、角上缩放。只在本机临时开一个地毯窗口，不动真鼠标。
set -e
cd "${0:A:h}/.."
./build/DesktopRug --material persian --rug 1280,780,680 --eval-file tests/option-transform.js --quit-after 20 2>&1 | grep "\[回归\]" | sed 's/^.*\[回归\] //'
