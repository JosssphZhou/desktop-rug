#!/bin/zsh
# 打包成本机用的 桌面地毯.app（不签名、不公证，只在这台机器上用）。
set -e
cd "${0:A:h}/.."
./scripts/build.sh
app="build/桌面地毯.app"
rm -rf "$app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources/web" \
  "$app/Contents/Resources/node_modules/three" "$app/Contents/Resources/node_modules/@paper-design/shaders"
cp build/DesktopRug "$app/Contents/MacOS/DesktopRug"
cp web/*.html web/*.js "$app/Contents/Resources/web/"
cp -R node_modules/three/build "$app/Contents/Resources/node_modules/three/"
cp -R node_modules/@paper-design/shaders/dist "$app/Contents/Resources/node_modules/@paper-design/shaders/"
cat > "$app/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>桌面地毯</string>
  <key>CFBundleDisplayName</key><string>桌面地毯</string>
  <key>CFBundleIdentifier</key><string>local.desktop-rug</string>
  <key>CFBundleExecutable</key><string>DesktopRug</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.1.1</string>
  <key>LSUIElement</key><true/>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>NSAppleEventsUsageDescription</key><string>读取桌面图标的位置，让地毯在图标上鼓起来。只读位置，不移动、不打开任何文件。</string>
</dict></plist>
PLIST
echo "已打包：$app"
