// 桌面地毯：一块铺在桌面图标上面、普通窗口下面的布。
// 窗口全屏透明，只在鼠标落在地毯轮廓里时接收事件，其余位置点击穿透到桌面。
import AppKit
import WebKit
import UniformTypeIdentifiers

// MARK: - 命令行参数

struct Options {
    var material: String? = nil
    var demo = false
    var fakeBumps = false
    var windowIdFile: String? = nil
    var quitAfter: Double? = nil
    var rug: String? = nil
    var record: String? = nil   // 演示时录成视频，写到这个路径
    var selfTest = false
    var pose: String? = nil
    var alwaysRender = false
    var testMenu = false
    var sweep = false
    var evalFile: String? = nil   // 调试：页面加载后执行这个脚本文件
    var snapDir: String? = nil    // 调试：脚本里截的图写到这个目录
    var level: Int? = nil   // 调试用：直接指定窗口层级的数值
    var reset = false
    var extraQuery: [String] = []   // "x,y,w"：地毯中心的屏幕坐标（左上原点）和宽度

    init(_ args: [String]) {
        var i = 1
        while i < args.count {
            let a = args[i]
            func next() -> String? { i += 1; return i < args.count ? args[i] : nil }
            switch a {
            case "--material": material = next()
            case "--demo": demo = true
            case "--fake-bumps": fakeBumps = true
            case "--window-id-file": windowIdFile = next()
            case "--quit-after": quitAfter = next().flatMap(Double.init)
            case "--rug": rug = next()
            case "--record": record = next(); demo = true
            case "--self-test": selfTest = true
            case "--pose": pose = next(); alwaysRender = true
            case "--always-render": alwaysRender = true
            case "--test-menu": testMenu = true
            case "--test-sweep": sweep = true
            case "--eval-file": evalFile = next(); alwaysRender = true
            case "--snap-dir": snapDir = next()
            case "--level": level = next().flatMap { Int($0) }
            case "--reset": reset = true
            case "--plain": extraQuery.append("plain=1")
            case "--debug": extraQuery.append("debug=1")
            case "--q": if let kv = next() { extraQuery.append(kv) }   // 调试：直接给网页加一个查询参数，如 --q fric=0.02
            default: break
            }
            i += 1
        }
    }
}

let options = Options(CommandLine.arguments)

let startTime = Date()
func log(_ s: String) {
    let t = String(format: "%6.2f", Date().timeIntervalSince(startTime))
    FileHandle.standardOutput.write(("[rug \(t)] " + s + "\n").data(using: .utf8)!)
}

// 网页资源根目录：可执行文件在 build/ 下，资源在仓库根目录。
let repoRoot: URL = {
    if let env = ProcessInfo.processInfo.environment["RUG_ROOT"] { return URL(fileURLWithPath: env) }
    // 打包成 .app 时，网页资源在 Contents/Resources 里
    if let res = Bundle.main.resourceURL, FileManager.default.fileExists(atPath: res.appendingPathComponent("web/index.html").path) {
        return res
    }
    let exe = URL(fileURLWithPath: CommandLine.arguments[0]).resolvingSymlinksInPath()
    return exe.deletingLastPathComponent().deletingLastPathComponent()
}()

// MARK: - 自定义协议，让网页用 rug://app/ 读本地文件（避开 file:// 下 ES 模块的限制）

final class LocalSchemeHandler: NSObject, WKURLSchemeHandler {
    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else { return }
        var path = url.path
        if path.isEmpty || path == "/" { path = "/web/index.html" }
        let fileURL = repoRoot.appendingPathComponent(String(path.dropFirst())).standardizedFileURL
        guard fileURL.path.hasPrefix(repoRoot.standardizedFileURL.path),
              let data = try? Data(contentsOf: fileURL) else {
            task.didFailWithError(NSError(domain: "rug", code: 404))
            log("404 \(path)")
            return
        }
        var mime = UTType(filenameExtension: fileURL.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
        if fileURL.pathExtension == "js" || fileURL.pathExtension == "mjs" { mime = "text/javascript" }
        let resp = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1",
                                   headerFields: ["Content-Type": mime, "Content-Length": "\(data.count)"])!
        task.didReceive(resp)
        task.didReceive(data)
        task.didFinish()
    }
    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}

// MARK: - 网页视图：第一下点击就生效

final class RugWebView: WKWebView {
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
}

final class RugWindow: NSWindow {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
}

// MARK: - 应用

struct Material { let id: String; let name: String }
let materials: [Material] = [
    Material(id: "persian", name: "波斯纹样"),
    Material(id: "warp", name: "条纹流动（Paper Warp）"),
    Material(id: "grain", name: "颗粒渐变（Paper Grain Gradient）"),
    Material(id: "mesh", name: "丝绸渐变（Paper Mesh Gradient）"),
    Material(id: "dots", name: "菱格织纹（Paper Dot Grid）"),
]

final class AppDelegate: NSObject, NSApplicationDelegate, WKScriptMessageHandler {
    var window: RugWindow!
    var webView: RugWebView!
    var statusItem: NSStatusItem!
    var hitPolygon: [CGPoint] = []      // 网页坐标（左上原点，单位为点）
    var hitMask: (w: Int, h: Int, cell: CGFloat, bytes: [UInt8])? = nil   // 布停在叠起样子时，用网格代替轮廓
    var dragging = false
    var optionDown = false
    var timer: Timer?
    var currentMaterial = UserDefaults.standard.string(forKey: "material") ?? "persian"
    var materialItems: [NSMenuItem] = []

    func applicationDidFinishLaunching(_ note: Notification) {
        NSApp.setActivationPolicy(.accessory)
        if options.reset { currentMaterial = "persian"; UserDefaults.standard.set("persian", forKey: "material") }
        if let m = options.material { currentMaterial = m }

        let screen = NSScreen.screens[0]   // 菜单栏所在的主屏。NSScreen.main 跟着键盘焦点走，启动时可能落在副屏上
        let frame = screen.frame
        window = RugWindow(contentRect: frame, styleMask: [.borderless], backing: .buffered, defer: false)
        window.isOpaque = false
        window.backgroundColor = .clear
        window.hasShadow = false
        window.level = NSWindow.Level(rawValue: options.level ?? (Int(CGWindowLevelForKey(.desktopIconWindow)) + 1))
        window.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle, .fullScreenNone]
        window.ignoresMouseEvents = true
        window.acceptsMouseMovedEvents = true
        window.isReleasedWhenClosed = false

        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(LocalSchemeHandler(), forURLScheme: "rug")
        config.userContentController.add(self, name: "rug")
        // 把网页的 console 输出转到标准输出，方便排查
        let consoleBridge = """
        (function(){
          const send = (lvl, args) => { try { window.webkit.messageHandlers.rug.postMessage({type:'log', level:lvl, text: Array.from(args).map(a => { try { return typeof a === 'string' ? a : JSON.stringify(a); } catch(e) { return String(a); } }).join(' ')}); } catch(e) {} };
          ['log','warn','error'].forEach(l => { const o = console[l]; console[l] = function(){ send(l, arguments); o.apply(console, arguments); }; });
          window.addEventListener('error', e => send('error', [e.message + ' @' + e.filename + ':' + e.lineno]));
          window.addEventListener('unhandledrejection', e => send('error', ['unhandled: ' + (e.reason && (e.reason.stack || e.reason))]));
        })();
        """
        config.userContentController.addUserScript(WKUserScript(source: consoleBridge, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        config.preferences.setValue(true, forKey: "developerExtrasEnabled")

        webView = RugWebView(frame: NSRect(origin: .zero, size: frame.size), configuration: config)
        webView.setValue(false, forKey: "drawsBackground")
        if #available(macOS 12.0, *) { webView.underPageBackgroundColor = .clear }
        webView.autoresizingMask = [.width, .height]
        // 被其他窗口挡住时 WebKit 默认暂停提交画面。演示录制时关掉这个检测，截到的才是当前画面；
        // 日常使用保留，被挡住时省电。
        if options.demo || options.alwaysRender || options.sweep {
            webView.setValue(false, forKey: "windowOcclusionDetectionEnabled")
            log("已关闭遮挡检测（演示模式）")
        }
        window.contentView = webView

        var query: [String] = ["material=\(currentMaterial)"]
        if options.demo { query.append("demo=1") }
        if options.fakeBumps { query.append("fakeBumps=1") }
        if options.sweep { query.append("sweep=1") }
        if let r = options.rug { query.append("rug=\(r)") }
        if options.record != nil { query.append("record=1") }
        if let p = options.pose { query.append("pose=\(p)") }
        if options.reset { query.append("reset=1") }
        query.append(contentsOf: options.extraQuery)
        let url = URL(string: "rug://app/web/index.html?" + query.joined(separator: "&"))!
        webView.load(URLRequest(url: url))

        window.orderFrontRegardless()
        log("window \(window.windowNumber) frame \(frame) scale \(screen.backingScaleFactor) root \(repoRoot.path)")
        if let f = options.windowIdFile {
            try? "\(window.windowNumber)".write(toFile: f, atomically: true, encoding: .utf8)
        }

        setupStatusItem()

        // 60 Hz 轮询鼠标位置，决定窗口是否接收鼠标事件。不需要任何系统权限。
        timer = Timer.scheduledTimer(withTimeInterval: 1.0 / 60.0, repeats: true) { [weak self] _ in self?.tick() }
        RunLoop.main.add(timer!, forMode: .common)

        if options.testMenu {
            // 走菜单项的同一个函数切换花样，再让网页测一次 Option 拖中间移动
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
                if let item = self.materialItems.first(where: { ($0.representedObject as? String) == "dots" }) {
                    self.pickMaterial(item)
                    log("测试：已通过菜单函数切到 dots，菜单勾选=\(item.state == .on)")
                }
                self.webView.evaluateJavaScript("window.__testMove && window.__testMove()")
            }
        }
        if let f = options.evalFile, let src = try? String(contentsOfFile: f, encoding: .utf8) {
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { self.webView.evaluateJavaScript(src) }
        }
        if options.selfTest {
            DispatchQueue.main.asyncAfter(deadline: .now() + 2.5) { self.runSelfTest() }
        }
        if let q = options.quitAfter {
            DispatchQueue.main.asyncAfter(deadline: .now() + q) { NSApp.terminate(nil) }
        }
    }

    // MARK: 点击穿透

    func tick() {
        let p = NSEvent.mouseLocation
        let f = window.frame
        let local = CGPoint(x: p.x - f.minX, y: f.height - (p.y - f.minY))
        // 按住 Option 且鼠标在地毯上时选中地毯；在别的应用里按 Option 不会惊动地毯
        let opt = NSEvent.modifierFlags.contains(.option)
        let want = opt && (optionDown || dragging || inHitArea(local))
        if want != optionDown {
            optionDown = want
            webView.evaluateJavaScript("window.rugSetOption && window.rugSetOption(\(want))")
        }
        if dragging { setAccept(true); return }
        // 鼠标已经按着（在别处开始的拖动）时不改变状态，免得半路抢走桌面的拖动
        if NSEvent.pressedMouseButtons != 0 { return }
        setAccept(inHitArea(local))
    }

    func inHitArea(_ p: CGPoint) -> Bool {
        if let m = hitMask {
            let cx = Int(p.x / m.cell), cy = Int(p.y / m.cell)
            guard cx >= 0, cy >= 0, cx < m.w, cy < m.h else { return false }
            return m.bytes[cy * m.w + cx] != 0
        }
        return pointInPolygon(p, hitPolygon)
    }

    func setAccept(_ accept: Bool) {
        if window.ignoresMouseEvents == accept {
            window.ignoresMouseEvents = !accept
        }
    }

    func pointInPolygon(_ p: CGPoint, _ poly: [CGPoint]) -> Bool {
        guard poly.count >= 3 else { return false }
        var inside = false
        var j = poly.count - 1
        for i in 0..<poly.count {
            let a = poly[i], b = poly[j]
            if (a.y > p.y) != (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x {
                inside.toggle()
            }
            j = i
        }
        return inside
    }

    // 自检：用网页报来的地毯轮廓判断几个点，确认中心接收鼠标、四周穿透。不移动真鼠标。
    func runSelfTest() {
        guard hitPolygon.count >= 3 else { log("自检失败：还没收到地毯轮廓"); return }
        let cx = hitPolygon.map(\.x).reduce(0, +) / CGFloat(hitPolygon.count)
        let cy = hitPolygon.map(\.y).reduce(0, +) / CGFloat(hitPolygon.count)
        let minX = hitPolygon.map(\.x).min()!, maxX = hitPolygon.map(\.x).max()!
        let cases: [(String, CGPoint, Bool)] = [
            ("地毯中心", CGPoint(x: cx, y: cy), true),
            ("地毯左边缘内侧", CGPoint(x: minX + 30, y: cy), true),
            ("地毯左边外侧", CGPoint(x: minX - 30, y: cy), false),
            ("地毯右边外侧", CGPoint(x: maxX + 30, y: cy), false),
            ("屏幕左上角", CGPoint(x: 10, y: 10), false),
        ]
        var ok = true
        for (name, p, expect) in cases {
            let got = pointInPolygon(p, hitPolygon)
            ok = ok && got == expect
            log("自检 \(name) (\(Int(p.x)),\(Int(p.y)))：\(got ? "接收鼠标" : "穿透") \(got == expect ? "通过" : "不通过")")
        }
        log("当前窗口 ignoresMouseEvents=\(window.ignoresMouseEvents)，鼠标位置 \(NSEvent.mouseLocation)")
        log(ok ? "自检全部通过" : "自检有不通过的项")
    }

    // MARK: 网页消息

    func userContentController(_ uc: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
        switch type {
        case "log":
            log("js \(body["level"] as? String ?? "log"): \(body["text"] as? String ?? "")")
        case "hit":
            if let flat = body["poly"] as? [Double] {
                var pts: [CGPoint] = []
                pts.reserveCapacity(flat.count / 2)
                var i = 0
                while i + 1 < flat.count { pts.append(CGPoint(x: flat[i], y: flat[i + 1])); i += 2 }
                hitPolygon = pts
                hitMask = nil
            }
        case "hitMask":
            if let w = body["w"] as? Int, let h = body["h"] as? Int, let cell = body["cell"] as? Double,
               let b64 = body["data"] as? String, let data = Data(base64Encoded: b64), data.count == w * h {
                hitMask = (w, h, CGFloat(cell), [UInt8](data))
            }
        case "probe":
            // 测试：网页给出几个屏幕点和期望，用宿主真正使用的判断函数核对
            if let pts = body["pts"] as? [[Any]] {
                for q in pts {
                    guard q.count == 4, let name = q[0] as? String, let x = (q[1] as? NSNumber)?.doubleValue, let y = (q[2] as? NSNumber)?.doubleValue, let e = (q[3] as? NSNumber)?.intValue else { continue }
                    let got = inHitArea(CGPoint(x: x, y: y))
                    log("宿主点击判断 \(name) (\(Int(x)),\(Int(y)))：\(got ? "接收鼠标" : "穿透") \(got == (e == 1) ? "通过" : "不通过")")
                }
            }
        case "snap":
            if let dir = options.snapDir, let name = body["name"] as? String, let b64 = body["data"] as? String, let data = Data(base64Encoded: b64) {
                try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
                try? data.write(to: URL(fileURLWithPath: dir + "/" + name + ".png"))
            }
        case "sweepDone":
            if options.sweep { DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { NSApp.terminate(nil) } }
        case "drag":
            dragging = (body["active"] as? Bool) ?? false
        case "material":
            if let id = body["id"] as? String { markMaterial(id) }
        case "recording":
            if let b64 = body["data"] as? String, let data = Data(base64Encoded: b64), let path = options.record {
                do { try data.write(to: URL(fileURLWithPath: path)); log("视频已写入 \(path)（\(data.count) 字节，\(body["mime"] ?? "")）") }
                catch { log("视频写入失败：\(error)") }
            }
        case "demoDone":
            if options.record != nil || options.quitAfter == nil {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { if options.record != nil { NSApp.terminate(nil) } }
            }
        case "quit":
            NSApp.terminate(nil)
        default:
            break
        }
    }

    // MARK: 菜单栏

    func setupStatusItem() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        if let button = statusItem.button {
            button.image = NSImage(systemSymbolName: "rectangle.checkered", accessibilityDescription: "桌面地毯")
                ?? NSImage(systemSymbolName: "square.grid.2x2", accessibilityDescription: "桌面地毯")
        }
        let menu = NSMenu()
        let header = NSMenuItem(title: "地毯花样", action: nil, keyEquivalent: "")
        header.isEnabled = false
        menu.addItem(header)
        for m in materials {
            let item = NSMenuItem(title: m.name, action: #selector(pickMaterial(_:)), keyEquivalent: "")
            item.target = self
            item.representedObject = m.id
            item.state = m.id == currentMaterial ? .on : .off
            menu.addItem(item)
            materialItems.append(item)
        }
        menu.addItem(.separator())
        let flat = NSMenuItem(title: "把地毯放平", action: #selector(flattenRug), keyEquivalent: "")
        flat.target = self
        menu.addItem(flat)
        let reset = NSMenuItem(title: "地毯放回屏幕中间", action: #selector(resetRug), keyEquivalent: "")
        reset.target = self
        menu.addItem(reset)
        let demo = NSMenuItem(title: "演示一遍掀起和落回", action: #selector(runDemo), keyEquivalent: "")
        demo.target = self
        menu.addItem(demo)
        let icons = NSMenuItem(title: "读取桌面图标位置，让地毯鼓起来", action: #selector(readDesktopIcons), keyEquivalent: "")
        icons.target = self
        menu.addItem(icons)
        menu.addItem(.separator())
        let quit = NSMenuItem(title: "退出桌面地毯", action: #selector(quitApp), keyEquivalent: "q")
        quit.target = self
        menu.addItem(quit)
        statusItem.menu = menu
    }

    func markMaterial(_ id: String) {
        currentMaterial = id
        UserDefaults.standard.set(id, forKey: "material")
        for item in materialItems { item.state = (item.representedObject as? String) == id ? .on : .off }
    }

    @objc func pickMaterial(_ sender: NSMenuItem) {
        guard let id = sender.representedObject as? String else { return }
        markMaterial(id)
        webView.evaluateJavaScript("window.rugSetMaterial && window.rugSetMaterial('\(id)')")
    }

    @objc func flattenRug() { webView.evaluateJavaScript("window.rugFlatten && window.rugFlatten()") }
    @objc func resetRug() { webView.evaluateJavaScript("window.rugReset && window.rugReset()") }
    @objc func runDemo() { webView.evaluateJavaScript("window.rugDemo && window.rugDemo()") }
    @objc func quitApp() { NSApp.terminate(nil) }

    // 只读取 Finder 里桌面各项的位置，不移动、不打开任何文件。
    // 第一次运行会弹出「自动化」授权框，由用户决定是否允许。
    @objc func readDesktopIcons() {
        let source = """
        tell application "Finder"
            set out to ""
            repeat with i in (items of desktop)
                set p to desktop position of i
                set out to out & (item 1 of p) & "," & (item 2 of p) & ";"
            end repeat
            return out
        end tell
        """
        DispatchQueue.global().async {
            var err: NSDictionary?
            let result = NSAppleScript(source: source)?.executeAndReturnError(&err)
            DispatchQueue.main.async {
                if let err = err { log("读取桌面图标位置失败：\(err)"); return }
                let text = result?.stringValue ?? ""
                let pts = text.split(separator: ";").compactMap { pair -> [Double]? in
                    let v = pair.split(separator: ",").compactMap { Double($0.trimmingCharacters(in: .whitespaces)) }
                    return v.count == 2 ? v : nil
                }
                log("读到 \(pts.count) 个桌面图标位置")
                let json = "[" + pts.map { "[\($0[0]),\($0[1])]" }.joined(separator: ",") + "]"
                self.webView.evaluateJavaScript("window.rugSetIcons && window.rugSetIcons(\(json))")
            }
        }
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
