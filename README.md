<div align="center">

# Desktop Rug

**A rug for your Mac desktop, so you can sweep your mess under it.**

<img src="docs/hero.jpg" alt="A Persian rug lying on a wooden desktop, one corner folded over a pile of icons" width="440">

<br>
<br>

[![Download](https://img.shields.io/badge/Download-0.1.1-b5272f?style=for-the-badge&logo=apple&logoColor=white)](https://github.com/JosssphZhou/desktop-rug/releases/latest)

![macOS 13+](https://img.shields.io/badge/macOS-13%2B-1c2a52?style=flat-square)
![Apple silicon](https://img.shields.io/badge/Apple%20silicon-arm64-1c2a52?style=flat-square)
![License MIT](https://img.shields.io/badge/license-MIT-1c2a52?style=flat-square)

English · [中文](README.zh-CN.md)

</div>

---

Desktop Rug lays a cloth rug across your desktop. It sits above your icons and below every window, so a messy desktop disappears under it. Your files never move. The rug only covers them.

Inspired by [Terkel's video](https://x.com/terkelg/status/2107540718461886464).

## What you can do

| | |
|---|---|
| **Sweep** | Drag the rug over a pile of icons to hide them. |
| **Peek** | Grab an edge or a corner to lift it and see what's underneath. |
| **Fold** | Pull a corner across and the rug folds over itself. |
| **Tuck** | Grab the middle and pull. One half lifts and lies over the other. |
| **Resize** | Hold <kbd>⌥ Option</kbd>, then drag a corner to scale or rotate. It can cover the whole screen. |
| **Restyle** | Pick from five patterns in the menu bar. |

Clicks outside the rug go straight through to your desktop.

## Install

1. Download **DesktopRug-0.1.1.zip** from [Releases](https://github.com/JosssphZhou/desktop-rug/releases/latest).
2. Unzip it and drag **桌面地毯.app** into Applications.
3. Open it. The app lives in the menu bar, not the Dock.

## Optional: bulge over icons

**Read desktop icon positions** in the menu makes the rug bulge where your icons are. macOS will ask for Automation access. The app only reads icon positions. It never moves or opens a file.

## Build from source

```sh
npm install
scripts/make-app.sh
open build/桌面地毯.app
```

## Also by me

[seesee](https://github.com/JosssphZhou/seesee): a native Mac video player your coding agent can control. Paste a link, watch with subtitles, let Claude Code or Codex queue videos and fix subtitles for you.

## License

[MIT](LICENSE). Built with [three.js](https://threejs.org) (MIT) and [Paper Shaders](https://github.com/paper-design/shaders) (Apache-2.0).
