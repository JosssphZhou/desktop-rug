#!/bin/zsh
set -euo pipefail
cd "${0:A:h}/.."
export RUG_ROOT="$PWD"
"${RUG_BIN:-./build/DesktopRug}" --material persian --rug 1280,780,680 --level -2147483648 --eval-file tests/fold-hold.js --quit-after 90 2>&1 | grep '\[回归\]' | sed 's/^.*\[回归\] //'
