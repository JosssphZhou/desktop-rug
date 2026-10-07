#!/bin/zsh
# 回归测试：地毯能放到盖住整块主屏的大小。窗口放在墙纸下面，老板看不到；只用测试位置，不写回平时的摆放。
set -e
cd "${0:A:h}/.."
./build/DesktopRug --material persian --rug 1280,720,680 --level -2147483630 --eval-file tests/full-screen.js --quit-after 15 2>&1 | grep "\[回归\]" | sed 's/^.*\[回归\] //'
