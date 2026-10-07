#!/bin/zsh
# 打包成本机用的 Desktop Rug.app（不签名、不公证，只在这台机器上用）。
# 应用名按系统语言显示：英文系统叫 Desktop Rug，中文系统叫桌面地毯。设了 RUG_BUILD_DIR 就打包到那个目录。
set -e
cd "${0:A:h}/.."
out="${RUG_BUILD_DIR:-build}"
./scripts/build.sh
app="$out/Desktop Rug.app"
rm -rf "$app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources/web" \
  "$app/Contents/Resources/node_modules/three" "$app/Contents/Resources/node_modules/@paper-design/shaders"
cp "$out/DesktopRug" "$app/Contents/MacOS/DesktopRug"
cp -R Resources/en.lproj Resources/zh-Hans.lproj "$app/Contents/Resources/"
cp web/*.html web/*.js "$app/Contents/Resources/web/"
cp -R node_modules/three/build "$app/Contents/Resources/node_modules/three/"
cp -R node_modules/@paper-design/shaders/dist "$app/Contents/Resources/node_modules/@paper-design/shaders/"
cat > "$app/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>Desktop Rug</string>
  <key>CFBundleDisplayName</key><string>Desktop Rug</string>
  <key>CFBundleDevelopmentRegion</key><string>en</string>
  <key>CFBundleLocalizations</key><array><string>en</string><string>zh-Hans</string></array>
  <key>LSHasLocalizedDisplayName</key><true/>
  <key>CFBundleIdentifier</key><string>local.desktop-rug</string>
  <key>CFBundleExecutable</key><string>DesktopRug</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.1.2</string>
  <key>LSUIElement</key><true/>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>NSAppleEventsUsageDescription</key><string>Reads where your desktop icons are so the rug can bulge over them. It only reads positions and never moves or opens a file.</string>
</dict></plist>
PLIST
echo "已打包：$app"
