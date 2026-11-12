// SPDX-License-Identifier: BSD-3-Clause
import Cocoa
import WebKit
import Network
import UniformTypeIdentifiers

// A loopback-only immutable asset server supplies a stable origin for workers,
// WebAssembly and IndexedDB. It serves only files in this app's Resources/web.
final class AssetServer {
    private let listener: NWListener
    private let root: URL
    private let queue = DispatchQueue(label: "cad.assets")
    init(root: URL, ready: @escaping (Error?) -> Void) throws {
        self.root = root.resolvingSymlinksInPath()
        let parameters = NWParameters.tcp
        parameters.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: 4318)
        listener = try NWListener(using: parameters)
        listener.stateUpdateHandler = { state in
            switch state {
            case .ready: DispatchQueue.main.async { ready(nil) }
            case .failed(let error): DispatchQueue.main.async { ready(error) }
            default: break
            }
        }
        listener.newConnectionHandler = { [weak self] connection in
            guard let self else { connection.cancel(); return }
            connection.start(queue: self.queue)
            self.receive(connection, accumulated: Data())
        }
        listener.start(queue: queue)
    }
    private func receive(_ connection: NWConnection, accumulated: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 16384) { [weak self] data, _, complete, error in
            guard let self else { connection.cancel(); return }
            var request = accumulated; if let data { request.append(data) }
            if request.count > 16384 || error != nil { connection.cancel(); return }
            guard let headerEnd = request.range(of: Data("\r\n\r\n".utf8)) else {
                if complete { connection.cancel() } else { self.receive(connection, accumulated: request) }
                return
            }
            let header = String(decoding: request[..<headerEnd.lowerBound], as: UTF8.self)
            let lines = header.components(separatedBy: "\r\n")
            let parts = (lines.first ?? "").split(separator: " ")
            let host = lines.dropFirst().first { $0.lowercased().hasPrefix("host:") }?.dropFirst(5).trimmingCharacters(in: .whitespaces)
            guard parts.count == 3, ["GET", "HEAD"].contains(String(parts[0])), host == "127.0.0.1:4318" else {
                self.send(connection, status: "400 Bad Request", data: Data(), type: "text/plain"); return
            }
            let encoded = String(parts[1]).components(separatedBy: "?")[0]
            guard let path = encoded.removingPercentEncoding, path.hasPrefix("/"), !path.contains("\0") else {
                self.send(connection, status: "400 Bad Request", data: Data(), type: "text/plain"); return
            }
            let file = self.root.appendingPathComponent(path == "/" ? "index.html" : String(path.dropFirst())).standardizedFileURL.resolvingSymlinksInPath()
            guard file.path.hasPrefix(self.root.path + "/"), let data = try? Data(contentsOf: file, options: .mappedIfSafe) else {
                self.send(connection, status: "404 Not Found", data: Data(), type: "text/plain"); return
            }
            let types = ["html":"text/html; charset=utf-8", "js":"text/javascript", "css":"text/css", "wasm":"application/wasm", "json":"application/json", "webmanifest":"application/manifest+json", "svg":"image/svg+xml", "png":"image/png", "txt":"text/plain; charset=utf-8"]
            self.send(connection, status: "200 OK", data: data, type: types[file.pathExtension] ?? "application/octet-stream", head: parts[0] == "HEAD")
        }
    }
    private func send(_ connection: NWConnection, status: String, data: Data, type: String, head: Bool = false) {
        var response = Data("HTTP/1.1 \(status)\r\nContent-Type: \(type)\r\nContent-Length: \(data.count)\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n\r\n".utf8)
        if !head { response.append(data) }
        connection.send(content: response, completion: .contentProcessed { _ in connection.cancel() })
    }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandlerWithReply {
    private var window: NSWindow!
    private var webView: WKWebView!
    private var server: AssetServer?
    private let origin = "http://127.0.0.1:4318"
    private let smoke = CommandLine.arguments.contains("--smoke-test")
    private var smokeStage = 0
    private var smokeAttempts = 0
    func applicationDidFinishLaunching(_ notification: Notification) {
        let menu = NSMenu()
        let appItem = NSMenuItem(); menu.addItem(appItem)
        let appMenu = NSMenu(); appItem.submenu = appMenu
        appMenu.addItem(withTitle: "About Brickwright CAD", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Quit Brickwright CAD", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        let editItem = NSMenuItem(); menu.addItem(editItem); let edit = NSMenu(title: "Edit"); editItem.submenu = edit
        for (title, action, key) in [("Undo", "undo:", "z"), ("Redo", "redo:", "Z"), ("Cut", "cut:", "x"), ("Copy", "copy:", "c"), ("Paste", "paste:", "v"), ("Select All", "selectAll:", "a")] {
            edit.addItem(withTitle: title, action: Selector(action), keyEquivalent: key)
        }
        let windowItem = NSMenuItem(); menu.addItem(windowItem); let windowMenu = NSMenu(title: "Window"); windowItem.submenu = windowMenu
        windowMenu.addItem(withTitle: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        NSApp.mainMenu = menu; NSApp.windowsMenu = windowMenu
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = smoke ? .nonPersistent() : .default()
        configuration.userContentController.addScriptMessageHandler(self, contentWorld: .page, name: "cadSave")
        // The capability marker is host-owned; the JS editor stays host independent.
        configuration.userContentController.addUserScript(WKUserScript(source: "window.brickwrightDesktop = true;", injectionTime: .atDocumentStart, forMainFrameOnly: true))
        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self; webView.uiDelegate = self; webView.isInspectable = true
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1440, height: 920), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = smoke ? "Brickwright CAD — verification" : "Brickwright CAD"
        window.minSize = NSSize(width: 800, height: 600); window.contentView = webView
        window.center(); window.setFrameAutosaveName("CADWorkspace"); window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        do {
            guard let root = Bundle.main.resourceURL?.appendingPathComponent("web") else { throw NSError(domain: "CAD", code: 1) }
            server = try AssetServer(root: root) { [weak self] error in
                guard let self else { return }
                if let error { self.fail("Cannot start the local asset server on port 4318. Close other CAD copies and retry. \(error)"); return }
                self.webView.load(URLRequest(url: URL(string: self.origin)!))
            }
        } catch { fail(error.localizedDescription) }
    }
    private func fail(_ message: String) {
        if smoke { fputs("FAIL: \(message)\n", stderr); exit(1) }
        let alert = NSAlert(); alert.messageText = "Brickwright CAD could not start"; alert.informativeText = message; alert.runModal()
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        if url.scheme == "http", url.host == "127.0.0.1", url.port == 4318 { decisionHandler(.allow) }
        else { decisionHandler(.cancel); if navigationAction.navigationType == .linkActivated, ["http", "https"].contains(url.scheme ?? "") { NSWorkspace.shared.open(url) } }
    }
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = NSAlert(); alert.messageText = message; alert.beginSheetModal(for: window) { _ in completionHandler() }
    }
    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = NSAlert(); alert.messageText = message; alert.addButton(withTitle: "Continue"); alert.addButton(withTitle: "Cancel")
        alert.beginSheetModal(for: window) { completionHandler($0 == .alertFirstButtonReturn) }
    }
    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
        let alert = NSAlert(); alert.messageText = prompt; alert.addButton(withTitle: "Save"); alert.addButton(withTitle: "Cancel")
        let field = NSTextField(string: defaultText ?? ""); field.frame = NSRect(x: 0, y: 0, width: 320, height: 24); alert.accessoryView = field
        alert.beginSheetModal(for: window) { completionHandler($0 == .alertFirstButtonReturn ? field.stringValue : nil) }
        alert.window.makeFirstResponder(field)
    }
    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel(); panel.canChooseDirectories = false; panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.beginSheetModal(for: window) { completionHandler($0 == .OK ? panel.urls : nil) }
    }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage, replyHandler: @escaping (Any?, String?) -> Void) {
        guard message.frameInfo.isMainFrame, message.frameInfo.securityOrigin.host == "127.0.0.1", message.frameInfo.securityOrigin.port == 4318,
              let body = message.body as? [String: String], let name = body["name"], let base64 = body["data"], base64.utf8.count <= 90 * 1024 * 1024,
              let bytes = Data(base64Encoded: base64), bytes.count <= 64 * 1024 * 1024 else { replyHandler(nil, "Invalid export request"); return }
        let panel = NSSavePanel(); panel.nameFieldStringValue = URL(fileURLWithPath: name).lastPathComponent; panel.canCreateDirectories = true
        panel.beginSheetModal(for: window) { result in
            guard result == .OK, let url = panel.url else { replyHandler(["saved":false], nil); return }
            do { try bytes.write(to: url, options: .atomic); replyHandler(["saved":true], nil) }
            catch { replyHandler(nil, error.localizedDescription) }
        }
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { if smoke { pollSmoke() } }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { fail(error.localizedDescription) }
    private func pollSmoke() {
        smokeAttempts += 1
        if smokeAttempts > 180 { fail("Timed out waiting for native editor/geometry/history"); return }
        let script = """
        (() => {
          const host = document.querySelector('#cad-root');
          if (host?.dataset.state !== 'ready') return 'waiting';
          const root = host.shadowRoot;
          if (\(smokeStage) === 0) { root.querySelector('button[aria-label="Box"]').click(); return 'added'; }
          const objects = root.querySelectorAll('[data-testid="object-name"]');
          if (objects.length !== 1 || Number(host.dataset.triangles) !== 12) return 'waiting';
          if (!document.querySelector('#save-state').textContent.includes('Saved · iteration')) return 'waiting';
          return window.brickwrightDesktop && !!window.webkit.messageHandlers.cadSave ? 'passed' : 'bridge missing';
        })()
        """
        webView.evaluateJavaScript(script) { [weak self] result, error in
            guard let self else { return }
            if let error { self.fail(error.localizedDescription); return }
            if result as? String == "passed" { print("PASS: native macOS WebKit editor, worker/WASM solid, durable iteration and save bridge"); exit(0) }
            if result as? String == "added" { self.smokeStage = 1 }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { self.pollSmoke() }
        }
    }
}

@main
struct BrickwrightCAD {
    @MainActor static func main() {
        let application = NSApplication.shared
        let delegate = AppDelegate()
        application.delegate = delegate
        application.setActivationPolicy(.regular)
        withExtendedLifetime(delegate) { application.run() }
    }
}
