#!/bin/bash
# 在外层 testq 内运行，四项串行；只重跑一次已知会受实时帧间隔影响的拖动测试。
set -euo pipefail
cd "$(dirname "$0")/../.."
ROOT="$PWD"
export RUG_BIN="${RUG_BIN:-$ROOT/.score-cache/DesktopRug}" RUG_ROOT="$ROOT"
export TMPDIR="$ROOT/.score-cache/tmp/" XDG_CACHE_HOME="$ROOT/.score-cache/home/Library/Caches"
export CFFIXED_USER_HOME="$ROOT/.score-cache/home"
OUT="${1:?提供本轮日志目录}"
mkdir -p "$OUT"
for test in drag middle flatten option fold; do
  python3 -c 'import os; s=os.statvfs("/"); assert s.f_bavail*s.f_frsize>=11e9, "内置盘低于11GB，停止"'
  for attempt in 1 2; do
    ./scripts/test-"$test".sh > "$OUT/$test-$attempt.txt" 2>&1
    if grep -q '全部通过' "$OUT/$test-$attempt.txt" && ! grep -q '不通过' "$OUT/$test-$attempt.txt"; then
      echo "${test}：通过（第${attempt}次）"
      break
    fi
    if [[ "$test" != drag || "$attempt" == 2 ]]; then
      echo "${test}：失败，见 $OUT/$test-$attempt.txt" >&2
      exit 1
    fi
    echo 'drag 实时帧间隔可能抖动，按任务书重跑一次。'
  done
done
