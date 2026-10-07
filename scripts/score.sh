#!/bin/bash
# 一条命令：准备真实参考数据、逐帧重放、评分、导出 60 fps 并排录像。
# 不写 build/；只退出自己启动的临时实例。
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"
mkdir -p "$ROOT/.score-cache/tmp" "$ROOT/.score-cache/home" "$ROOT/.score-cache/clang"
export TMPDIR="$ROOT/.score-cache/tmp/" XDG_CACHE_HOME="$ROOT/.score-cache/home/Library/Caches"
export CLANG_MODULE_CACHE_PATH="$ROOT/.score-cache/clang" PYTHONPYCACHEPREFIX="$ROOT/.score-cache/pycache"
# 本任务运行时由调用者传入 BUILDQ_MIN_FREE_GB=10，不改变全局默认门槛。
PYTHON="${RUG_SCORE_PYTHON:-python3}"
if ! "$PYTHON" -c 'import cv2, numpy' 2>/dev/null; then
  echo '缺少 Python 依赖。安装 scripts/score/requirements.txt，并设置 RUG_SCORE_PYTHON。' >&2
  exit 2
fi
# 资料预处理不启动应用。可在编译和测试队列暂停时先准备参考数据。
if [[ "${1:-}" == --prepare-reference ]]; then
  exec "$PYTHON" scripts/score/score.py "$@"
fi
BIN="${RUG_BIN:-$ROOT/.score-cache/DesktopRug}"
if [[ ! -x "$BIN" ]]; then
  mkdir -p "$ROOT/.score-cache"
  ~/.claude/bin/buildq -- swiftc -O -o "$BIN" Sources/main.swift -framework AppKit -framework WebKit
fi
export RUG_BIN="$BIN" RUG_ROOT="$ROOT"
exec ~/.claude/bin/testq -- "$PYTHON" scripts/score/score.py "$@"
