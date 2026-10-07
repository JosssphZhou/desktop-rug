#!/bin/zsh
# 截两张对比用的图：掀角姿势和模拟图标鼓包（只截地毯窗口）。用法：shots.sh 输出前缀 [材质]
set -e
cd "${0:A:h}/.."
pre=$1; mat=${2:-persian}; tmp=$(mktemp -d)
./build/DesktopRug --material $mat --pose fold --rug 1280,760,760 --window-id-file $tmp/wid --quit-after 4.5 > $tmp/a.log 2>&1 &
sleep 3.6; screencapture -x -o -l$(cat $tmp/wid) $tmp/fold.png; wait
./build/DesktopRug --material $mat --always-render --fake-bumps --rug 1280,760,760 --window-id-file $tmp/wid --quit-after 4 > $tmp/b.log 2>&1 &
sleep 3.2; screencapture -x -o -l$(cat $tmp/wid) $tmp/bump.png; wait
./scripts/compose.sh $tmp/fold.png ${pre}_fold.png 1700 900 1760 1240
./scripts/compose.sh $tmp/bump.png ${pre}_bump.png 1700 900 1760 1240
grep -ihE "error" $tmp/*.log || true
rm -rf $tmp
