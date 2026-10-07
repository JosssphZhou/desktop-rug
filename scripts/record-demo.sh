#!/bin/zsh
# 启动地毯并跑演示脚本，连续截取地毯窗口（只截这个窗口，不录桌面上的其他东西），拼成视频。
# 用法：record-demo.sh 输出目录 [材质] [其他参数...]
set -e
out=${1:?输出目录}; mat=${2:-persian}; shift 2 || true
root="${0:A:h}/.."
mkdir -p "$out/frames"; rm -rf "$out/frames"; mkdir -p "$out/frames"
"$root/build/DesktopRug" --material "$mat" --demo --window-id-file "$out/wid.txt" --quit-after 17 "$@" > "$out/run.log" 2>&1 &
pid=$!
sleep 1.5
wid=$(cat "$out/wid.txt")
start=$(date +%s.%N)
n=0
while kill -0 $pid 2>/dev/null; do
  n=$((n+1)); screencapture -x -o -t png -l$wid "$out/frames/$(printf %04d $n).png" 2>/dev/null || true
done
end=$(date +%s.%N)
echo "截了 $n 帧，用时 $(( end - start )) 秒"
