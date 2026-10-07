#!/bin/zsh
# 把只含地毯的透明窗口截图叠在桌面底色上，裁出地毯周围一块，方便看效果。
# 用法：compose.sh 输入.png 输出.png [x y w h]（裁剪框以 2 倍像素计）
in=$1; out=$2; x=${3:-1400}; y=${4:-700}; w=${5:-2400}; h=${6:-1700}
ffmpeg -loglevel error -y -f lavfi -i "color=c=0x9c7b55:s=5120x2880" -i "$in" \
  -filter_complex "[0][1]overlay=0:0:shortest=1,crop=$w:$h:$x:$y,scale=iw/2:-1" -frames:v 1 "$out"
