# Desktop Rug

A rug for your Mac desktop, so you can sweep your mess under it.

It sits above your desktop icons and below every window. Drag it over a pile of icons, lift a corner to peek underneath, fold it over itself. Your files never move: the rug only covers them.

Inspired by [Terkel's video](https://x.com/terkelg/status/2107540718461886464). Built by an agent working frame by frame from that video.

[中文说明](#中文)

## Install

1. Download `DesktopRug-0.1.0.zip` from [Releases](../../releases).
2. Unzip it and drag `桌面地毯.app` into Applications.
3. Open it. The app lives in the menu bar, not the Dock.

Requires macOS 13 or later on Apple silicon. The app is signed and notarized.

## Use

- Drag anywhere on the rug to move it. Grab an edge or a corner to lift and fold it.
- Hold Option to select the rug, then drag a corner to resize or rotate it. It can stretch to cover the whole screen.
- The menu bar icon lets you switch patterns, flatten the rug, or move it back to the center.
- Clicks outside the rug go straight through to your desktop.

"Make the rug bulge over icons" is optional. It asks macOS for Automation access so it can read where your icons are. It only reads positions and never moves or opens files.

## Build from source

```sh
npm install
scripts/make-app.sh
open build/桌面地毯.app
```

## License

MIT. Uses [three.js](https://threejs.org) (MIT) and [Paper Shaders](https://github.com/paper-design/shaders) (Apache-2.0).

---

## 中文

一块铺在 Mac 桌面上的地毯，桌面乱了就拿它盖上。

地毯在桌面图标上面、所有窗口下面。拖过去能盖住一堆图标，掀起一角能看到下面，也能整片对折。文件不会被移动，地毯只是盖住它们。

灵感来自 [Terkel 的视频](https://x.com/terkelg/status/2107540718461886464)，由 agent 照着视频逐帧做出来。

### 安装

1. 在 [Releases](../../releases) 下载 `DesktopRug-0.1.0.zip`。
2. 解压，把 `桌面地毯.app` 拖进「应用程序」。
3. 打开。它只在菜单栏出现，不在程序坞里。

需要 macOS 13 或更新版本，Apple 芯片的 Mac。应用已签名并通过苹果公证。

### 用法

- 在地毯上任意位置拖动，地毯跟着走。抓住边或角拖，就能掀起、对折。
- 按住 Option 选中地毯，再拖一个角，可以缩放和旋转，最大能铺满整块屏幕。
- 点菜单栏图标，可以换花样、把地毯放平，或者放回屏幕中间。
- 地毯以外的地方，点击直接落到桌面上。

「让地毯在图标上鼓起来」是可选功能。它需要你在系统弹窗里允许「自动化」，用来读取图标的位置。只读位置，不移动、不打开任何文件。
