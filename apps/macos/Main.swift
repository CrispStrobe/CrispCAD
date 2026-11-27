// SPDX-License-Identifier: BSD-3-Clause
import Cocoa
import WebKit
import Network
import UniformTypeIdentifiers

// Native WebKit magnification belongs to the 3D camera, never to the app chrome.
@MainActor final class CadWebView: WKWebView {
    func routeCameraMagnification(factor: Double, x: Double, y: Double, completion: ((Any?, Error?) -> Void)? = nil) {
        let payload: [String: Any] = ["kind": "zoom", "factor": max(0.05, min(20, factor)), "x": x, "y": y]
        guard let data = try? JSONSerialization.data(withJSONObject: payload), let json = String(data: data, encoding: .utf8) else { return }
        evaluateJavaScript("window.dispatchEvent(new CustomEvent('brickwright-camera-input', {detail: \(json)}));", completionHandler: completion)
    }
    func routeCameraWheel(_ payload: [String: Any], completion: @escaping (Bool) -> Void) {
        guard let data = try? JSONSerialization.data(withJSONObject: payload), let json = String(data: data, encoding: .utf8) else { completion(false); return }
        evaluateJavaScript("(() => {const detail = \(json); window.dispatchEvent(new CustomEvent('brickwright-camera-input', {detail})); return detail.handled === true;})()") { value, _ in completion(value as? Bool == true) }
    }
    override func magnify(with event: NSEvent) {
        let point = convert(event.locationInWindow, from: nil)
        routeCameraMagnification(factor: 1 + Double(event.magnification), x: Double(point.x), y: Double(isFlipped ? point.y : bounds.height - point.y))
    }
}

// A loopback-only immutable asset server supplies a stable origin for workers,
// WebAssembly and IndexedDB. It serves only files in this app's Resources/web.
final class AssetServer {
    private let listener: NWListener
    private let root: URL
    private let port: UInt16
    private let queue = DispatchQueue(label: "cad.assets")
    init(root: URL, port: UInt16, ready: @escaping (Error?) -> Void) throws {
        self.root = root.resolvingSymlinksInPath()
        self.port = port
        let parameters = NWParameters.tcp
        parameters.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: NWEndpoint.Port(rawValue: port)!)
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
            guard parts.count == 3, ["GET", "HEAD"].contains(String(parts[0])), host == "127.0.0.1:\(self.port)" else {
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
final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandlerWithReply, NSMenuItemValidation {
    private var language: String { smoke ? "en" : (UserDefaults.standard.string(forKey:"CADLanguage") ?? (Locale.preferredLanguages.first ?? "en")).lowercased().hasPrefix("de") ? "de" : "en" }
    private func L(_ key:String)->String {
        guard let path=Bundle.main.path(forResource:language,ofType:"lproj"),let bundle=Bundle(path:path) else {return key}
        return bundle.localizedString(forKey:key,value:key,table:nil)
    }
    private var menuTitles: [ObjectIdentifier:String] = [:]
    private func localizeMenu(_ menu:NSMenu) {
        for item in menu.items {
            let id=ObjectIdentifier(item)
            if menuTitles[id] == nil { menuTitles[id]=item.title }
            if let source=menuTitles[id], !source.isEmpty { item.title=L(source) }
            if let submenu=item.submenu { localizeMenu(submenu) }
        }
    }
    private var window: NSWindow!
    private var webView: WKWebView!
    private var server: AssetServer?
    private let smoke = CommandLine.arguments.contains("--smoke-test")
    private var port: UInt16 { smoke ? 4319 : 4318 }
    private var origin: String { "http://127.0.0.1:\(port)" }
    private var smokeStage = 0
    private var smokeAttempts = 0
    private var magnificationMonitor: Any?
    private var wheelMonitor: Any?
    private var forwardingWheel = false
    private var cameraSmokeDone = false
    private var pageLoaded = false
    private var editorState:[String:Bool]=[:]
    private lazy var pasteboard:NSPasteboard = smoke ? .withUniqueName() : .general
    private let clipboardType=NSPasteboard.PasteboardType("com.crispstrobe.brickwrightcad.objects")
    func applicationDidFinishLaunching(_ notification: Notification) {
        let menu = NSMenu()
        let appItem = NSMenuItem(); menu.addItem(appItem)
        let appMenu = NSMenu(); appItem.submenu = appMenu
        let about=appMenu.addItem(withTitle: "About CrispCAD", action: #selector(showAbout), keyEquivalent: "");about.target=self
        let preferences=appMenu.addItem(withTitle:"Settings…",action:#selector(showSettings),keyEquivalent:",");preferences.target=self
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle:"Hide CrispCAD",action:#selector(NSApplication.hide(_:)),keyEquivalent:"h")
        let hideOthers=appMenu.addItem(withTitle:"Hide Others",action:#selector(NSApplication.hideOtherApplications(_:)),keyEquivalent:"h");hideOthers.keyEquivalentModifierMask=[.command,.option]
        appMenu.addItem(withTitle:"Show All",action:#selector(NSApplication.unhideAllApplications(_:)),keyEquivalent:"");appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Quit CrispCAD", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        func section(_ title:String)->NSMenu {let item=NSMenuItem(title:title,action:nil,keyEquivalent:"");menu.addItem(item);let submenu=NSMenu(title:title);item.submenu=submenu;return submenu}
        let file=section("File")
        addCommand(file,"New Project","new","n");addCommand(file,"Open Project…","open","o");addCommand(file,"Project Library…","projects","o",[.command,.shift]);file.addItem(.separator())
        addCommand(file,"Model Library…","model-library");file.addItem(.separator());addCommand(file,"Save Project…","save","s");file.addItem(.separator());addCommand(file,"Import STL or STEP…","import","i");addCommand(file,"Export…","export","e",[.command,.shift]);addCommand(file,"Check Printability…","printability");addCommand(file,"Check for Manufacturing…","manufacturing")
        let edit=section("Edit")
        addCommand(edit,"Undo","undo","z");addCommand(edit,"Redo","redo","z",[.command,.shift]);edit.addItem(.separator())
        addCommand(edit,"Cut","cut","x");addCommand(edit,"Copy","copy","c");addCommand(edit,"Paste","paste","v");addCommand(edit,"Duplicate","duplicate","d");addCommand(edit,"Delete","delete","\u{7f}",[]);edit.addItem(.separator());addCommand(edit,"Select All","select-all","a");addCommand(edit,"Deselect All","deselect")
        let view=section("View")
        addCommand(view,"Fit Model","fit","0");addCommand(view,"Home View","home","0",[.command,.shift]);view.addItem(.separator());addCommand(view,"Top","top","1");addCommand(view,"Front","front","2");addCommand(view,"Right","right","3");addCommand(view,"Back","back");addCommand(view,"Left","left");addCommand(view,"Bottom","bottom");view.addItem(.separator());addCommand(view,"Toggle Orthographic Projection","projection");addCommand(view,"Show / Hide Workplane","workplane");addCommand(view,"On-canvas Parameters","readout");addCommand(view,"Show / Hide Objects","objects");addCommand(view,"Show / Hide Properties","properties");addCommand(view,"Model Source","model-source")
        let object=section("Object")
        addCommand(object,"Add Shape…","shapes","a",[.command,.shift]);addCommand(object,"Sketch and Extrude…","sketch");addCommand(object,"Code an Object…","code");object.addItem(.separator())
        addCommand(object,"Select / Drag","select");addCommand(object,"Move","move");addCommand(object,"Rotate","rotate");addCommand(object,"Scale","scale");addCommand(object,"Drop to Workplane","drop");object.addItem(.separator());addCommand(object,"Union","union");addCommand(object,"Subtract","subtract");addCommand(object,"Intersect","intersect");object.addItem(.separator());addCommand(object,"Model Parameters…","parameters")
        let windowItem = NSMenuItem(title:"Window",action:nil,keyEquivalent:""); menu.addItem(windowItem); let windowMenu = NSMenu(title: "Window"); windowItem.submenu = windowMenu
        windowMenu.addItem(withTitle: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        let help=section("Help");addCommand(help,"Workbench Help","help");NSApp.helpMenu=help
        NSApp.mainMenu = menu; NSApp.windowsMenu = windowMenu; localizeMenu(menu)
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = smoke ? .nonPersistent() : .default()
        configuration.userContentController.addScriptMessageHandler(self, contentWorld: .page, name: "cadSave")
        configuration.userContentController.addScriptMessageHandler(self, contentWorld: .page, name: "cadLibrary")
        configuration.userContentController.addScriptMessageHandler(self, contentWorld: .page, name: "cadHost")
        // The capability marker is host-owned; the JS editor stays host independent.
        let info=["version":Bundle.main.object(forInfoDictionaryKey:"CFBundleShortVersionString") as? String ?? "0.1.0","build":Bundle.main.object(forInfoDictionaryKey:"CFBundleVersion") as? String ?? "dev"]
        let infoJSON=String(data:try! JSONSerialization.data(withJSONObject:info),encoding:.utf8)!
        configuration.userContentController.addUserScript(WKUserScript(source: "window.brickwrightDesktop = true;window.brickwrightDesktopInfo=\(infoJSON);\(smoke ? "localStorage.setItem('brickwright-cad:locale','en');" : "")", injectionTime: .atDocumentStart, forMainFrameOnly: true))
        webView = CadWebView(frame: .zero, configuration: configuration)
        webView.allowsBackForwardNavigationGestures = false
        webView.navigationDelegate = self; webView.uiDelegate = self; webView.isInspectable = true
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1440, height: 920), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = smoke ? "CrispCAD — verification" : "CrispCAD"
        window.minSize = NSSize(width: 800, height: 600); window.contentView = webView
        window.center(); if !smoke { window.setFrameAutosaveName("CADWorkspace") }; window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        // Intercept before WebKit's internal content view can consume magnify.
        // WebKit's content subview can consume trackpad scrolling before a
        // WKWebView override sees it. Route it before that view, then forward
        // unhandled control/panel scrolling once without re-entering the monitor.
        wheelMonitor = NSEvent.addLocalMonitorForEvents(matching: .scrollWheel) { [weak self] event in
            guard let self, !self.forwardingWheel, event.window === self.window, let view = self.webView as? CadWebView else { return event }
            let point = view.convert(event.locationInWindow, from: nil)
            let payload: [String: Any] = ["kind":"wheel", "deltaX":-Double(event.scrollingDeltaX), "deltaY":-Double(event.scrollingDeltaY), "deltaMode":0, "precise":event.hasPreciseScrollingDeltas, "shiftKey":event.modifierFlags.contains(.shift), "altKey":event.modifierFlags.contains(.option), "ctrlKey":event.modifierFlags.contains(.control), "x":Double(point.x), "y":Double(view.isFlipped ? point.y : view.bounds.height - point.y)]
            view.routeCameraWheel(payload) { [weak self] handled in
                guard let self, !handled else { return }
                self.forwardingWheel = true
                event.window?.sendEvent(event)
                self.forwardingWheel = false
            }
            return nil
        }
        magnificationMonitor = NSEvent.addLocalMonitorForEvents(matching: .magnify) { [weak self] event in
            guard let self, event.window === self.window, let view = self.webView as? CadWebView else { return event }
            let point = view.convert(event.locationInWindow, from: nil)
            guard view.bounds.contains(point) else { return event }
            view.magnify(with: event)
            return nil
        }
        do {
            guard let root = Bundle.main.resourceURL?.appendingPathComponent("web") else { throw NSError(domain: "CAD", code: 1) }
            server = try AssetServer(root: root, port: port) { [weak self] error in
                guard let self else { return }
                if let error { self.fail(String(format:self.L("Cannot start the local asset server on port %d. Close other CAD copies and retry. %@"),Int(self.port),String(describing:error))); return }
                self.webView.load(URLRequest(url: URL(string: self.origin)!))
            }
        } catch { fail(error.localizedDescription) }
    }
    private func fail(_ message: String) {
        if smoke { fputs("FAIL: \(message)\n", stderr); exit(1) }
        let alert = NSAlert(); alert.messageText = L("CrispCAD could not start"); alert.informativeText = message; alert.runModal()
    }
    @objc private func showAbout(){webView?.evaluateJavaScript("document.querySelector('#cad-root')?.shadowRoot?.querySelector('#about')?.click();")}
    @objc private func showSettings(){webView?.evaluateJavaScript("document.querySelector('#cad-root')?.shadowRoot?.querySelector('#settings')?.click();")}
    private func modelUndoRedo(redo:Bool){
        webView?.evaluateJavaScript("""
        (()=>{let active=document.activeElement;while(active?.shadowRoot?.activeElement)active=active.shadowRoot.activeElement;
        if(active instanceof HTMLInputElement||active instanceof HTMLTextAreaElement||active?.isContentEditable){document.execCommand('\(redo ? "redo" : "undo")');return;}
        const canvas=document.querySelector('#cad-root')?.shadowRoot?.querySelector('canvas');canvas?.dispatchEvent(new KeyboardEvent('keydown',{key:'z',metaKey:true,shiftKey:\(redo ? "true" : "false"),bubbles:true,composed:true}));})()
        """)
    }
    @objc private func modelUndo(){modelUndoRedo(redo:false)}
    @objc private func modelRedo(){modelUndoRedo(redo:true)}
    private func addCommand(_ menu:NSMenu,_ title:String,_ command:String,_ key:String="",_ modifiers:NSEvent.ModifierFlags=[.command]){
        let item=menu.addItem(withTitle:title,action:#selector(performEditorCommand(_:)),keyEquivalent:key);item.target=self;item.representedObject=command;item.keyEquivalentModifierMask=key.isEmpty ? [] : modifiers
    }
    @objc private func performEditorCommand(_ sender:NSMenuItem){
        guard let command=sender.representedObject as? String else{return}
        let selectors=["undo":"undo:","redo":"redo:","cut":"cut:","copy":"copy:","paste":"paste:","delete":"deleteBackward:","select-all":"selectAll:"]
        let execute={self.webView.callAsyncJavaScript("await window.brickwrightExecuteCommand(command);",arguments:["command":command],in:nil,in:.page){result in if case .failure(let error)=result {fputs("CAD command failed: \(error.localizedDescription)\n",stderr)}}}
        guard let selector=selectors[command] else {execute();return}
        if !smoke && NSApp.keyWindow !== window {_ = NSApp.sendAction(Selector(selector),to:nil,from:sender);return}
        webView.evaluateJavaScript("(()=>{let e=document.activeElement;while(e?.shadowRoot?.activeElement)e=e.shadowRoot.activeElement;return e instanceof HTMLTextAreaElement||(e instanceof HTMLInputElement&&!['checkbox','color','file','button','range'].includes(e.type))||!!e?.isContentEditable||!!window.getSelection()?.toString();})()") {result,error in
            if result as? Bool == true {_ = NSApp.sendAction(Selector(selector),to:nil,from:sender)}else{execute()}
        }
    }
    func validateMenuItem(_ menuItem:NSMenuItem)->Bool {
        guard let command=menuItem.representedObject as? String else{return true}
        guard pageLoaded else{return false}
        if window.attachedSheet != nil {return ["cut","copy","paste","delete","undo","redo","select-all"].contains(command)}
        let editing=editorState["editingText"] ?? false
        if editorState["modalOpen"] == true {return editing && ["cut","copy","paste","delete","undo","redo","select-all"].contains(command)}
        switch command {
        case "undo":return editing || editorState["canUndo"] == true
        case "redo":return editing || editorState["canRedo"] == true
        case "cut","copy","delete":return editing || editorState["canDelete"] == true
        case "duplicate","drop":return editorState["canDelete"] == true
        case "union","subtract","intersect":return editorState["canCombine"] == true
        case "export":return editorState["canExport"] == true
        case "printability","manufacturing":return editorState["hasBodies"] == true && editorState["ready"] == true
        case "deselect":return editorState["hasSelection"] == true
        case "paste":return editing || pasteboard.availableType(from:[clipboardType,.string]) != nil
        default:return true
        }
    }
    func applicationWillTerminate(_ notification: Notification) {
        if let monitor = magnificationMonitor { NSEvent.removeMonitor(monitor); magnificationMonitor = nil }
        if let monitor = wheelMonitor { NSEvent.removeMonitor(monitor); wheelMonitor = nil }
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard pageLoaded && !smoke else { return .terminateNow }
        webView.callAsyncJavaScript("if (window.brickwrightPrepareToClose) await window.brickwrightPrepareToClose();", arguments: [:], in: nil, in: .page) { result in
            switch result {
            case .success: sender.reply(toApplicationShouldTerminate: true)
            case .failure(let error):
                let alert = NSAlert(); alert.messageText = self.L("The last model save could not finish")
                alert.informativeText = "\(error.localizedDescription) \(self.L("You can keep editing and export a project file."))"
                alert.addButton(withTitle: self.L("Keep editing")); alert.addButton(withTitle: self.L("Quit anyway"))
                alert.beginSheetModal(for: self.window) { sender.reply(toApplicationShouldTerminate: $0 == .alertSecondButtonReturn) }
            }
        }
        return .terminateLater
    }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        if url.scheme == "http", url.host == "127.0.0.1", url.port == Int(port) { decisionHandler(.allow) }
        else { decisionHandler(.cancel); if navigationAction.navigationType == .linkActivated, ["http", "https"].contains(url.scheme ?? "") { NSWorkspace.shared.open(url) } }
    }
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = NSAlert(); alert.messageText = message; alert.beginSheetModal(for: window) { _ in completionHandler() }
    }
    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = NSAlert(); alert.messageText = message; alert.addButton(withTitle: L("Continue")); alert.addButton(withTitle: L("Cancel"))
        alert.beginSheetModal(for: window) { completionHandler($0 == .alertFirstButtonReturn) }
    }
    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
        let alert = NSAlert(); alert.messageText = prompt; alert.addButton(withTitle: L("Save")); alert.addButton(withTitle: L("Cancel"))
        let field = NSTextField(string: defaultText ?? ""); field.frame = NSRect(x: 0, y: 0, width: 320, height: 24); alert.accessoryView = field
        alert.beginSheetModal(for: window) { completionHandler($0 == .alertFirstButtonReturn ? field.stringValue : nil) }
        alert.window.makeFirstResponder(field)
    }
    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel(); panel.canChooseDirectories = false; panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.beginSheetModal(for: window) { completionHandler($0 == .OK ? panel.urls : nil) }
    }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage, replyHandler: @escaping (Any?, String?) -> Void) {
        if message.name == "cadHost" {
            guard message.frameInfo.isMainFrame,message.frameInfo.securityOrigin.host == "127.0.0.1",message.frameInfo.securityOrigin.port == Int(port),message.frameInfo.securityOrigin.protocol == "http",let body=message.body as? [String:String] else{replyHandler(nil,L("Invalid host request"));return}
            hostRequest(body,reply:replyHandler);return
        }
        if message.name == "cadLibrary" {
            guard message.frameInfo.isMainFrame, message.frameInfo.securityOrigin.host == "127.0.0.1", message.frameInfo.securityOrigin.port == Int(port), message.frameInfo.securityOrigin.protocol == "http", let body = message.body as? [String:String] else { replyHandler(nil,L("Invalid library request")); return }
            libraryRequest(body, reply: replyHandler); return
        }
        guard message.frameInfo.isMainFrame, message.frameInfo.securityOrigin.protocol == "http", message.frameInfo.securityOrigin.host == "127.0.0.1", message.frameInfo.securityOrigin.port == Int(port),
              let body = message.body as? [String: String], let name = body["name"], let base64 = body["data"], base64.utf8.count <= 90 * 1024 * 1024,
              let bytes = Data(base64Encoded: base64), bytes.count <= 64 * 1024 * 1024 else { replyHandler(nil, L("Invalid export request")); return }
        let panel = NSSavePanel(); panel.nameFieldStringValue = URL(fileURLWithPath: name).lastPathComponent; panel.canCreateDirectories = true
        panel.beginSheetModal(for: window) { result in
            guard result == .OK, let url = panel.url else { replyHandler(["saved":false], nil); return }
            do { try bytes.write(to: url, options: .atomic); replyHandler(["saved":true], nil) }
            catch { replyHandler(nil, error.localizedDescription) }
        }
    }
    private func hostRequest(_ body:[String:String],reply:@escaping(Any?,String?)->Void){
        switch body["action"] {
        case "locale":
            guard let value=body["data"], ["en","de"].contains(value) else {reply(nil,L("Invalid language"));return}
            if !smoke {UserDefaults.standard.set(value,forKey:"CADLanguage")}
            if let menu=NSApp.mainMenu {localizeMenu(menu)}
            reply(true,nil)
        case "state":
            if let text=body["data"],text.utf8.count<4096,let data=text.data(using:.utf8),let value=(try? JSONSerialization.jsonObject(with:data)) as? [String:Bool] {editorState=value};reply(true,nil)
        case "clipboard-read":
            let text=pasteboard.string(forType:clipboardType) ?? pasteboard.string(forType:.string)
            if let text,text.utf8.count>16*1024*1024 {reply(nil,L("Clipboard selection exceeds 16 MiB"))}else{reply(text as Any?,nil)}
        case "clipboard-write":
            guard let text=body["data"],text.utf8.count<=16*1024*1024 else {reply(nil,L("Clipboard selection exceeds 16 MiB"));return}
            let item=NSPasteboardItem();item.setString(text,forType:clipboardType);item.setString(text,forType:.string);pasteboard.clearContents();guard pasteboard.writeObjects([item]) else{reply(nil,L("The clipboard could not be written; the model was kept"));return};reply(true,nil)
        case "open":
            let panel=NSOpenPanel();panel.canChooseDirectories=false;panel.allowsMultipleSelection=false
            let geometry=body["mode"] == "geometry";panel.title=geometry ? L("Import STL or STEP Geometry") : L("Open CAD Project")
            panel.allowedContentTypes=geometry ? ["stl","step","stp"].compactMap { UTType(filenameExtension:$0) } : [.json,UTType(filenameExtension:"bcad") ?? .data,UTType(filenameExtension:"bcadhistory") ?? .data]
            panel.beginSheetModal(for:window){result in guard result == .OK,let url=panel.url else{reply(NSNull(),nil);return};do{let size=try url.resourceValues(forKeys:[.fileSizeKey]).fileSize ?? 0;guard size<=(geometry ? 16:64)*1024*1024 else{reply(nil,self.L("File exceeds the import limit"));return};reply(["name":url.lastPathComponent,"data":try Data(contentsOf:url).base64EncodedString()],nil)}catch{reply(nil,error.localizedDescription)}}
        default:reply(nil,L("Unknown host request"))
        }
    }
    private func libraryFolder() throws -> URL {
        let folder: URL
        if smoke { folder = FileManager.default.temporaryDirectory.appendingPathComponent("bw-cad-smoke-\(ProcessInfo.processInfo.processIdentifier)") }
        else if let path = UserDefaults.standard.string(forKey:"CADLibraryFolder") { folder = URL(fileURLWithPath:path,isDirectory:true) }
        // The folder keeps its pre-CrispCAD name so existing projects and histories stay where users saved them.
        else { folder = FileManager.default.urls(for:.documentDirectory,in:.userDomainMask)[0].appendingPathComponent("Brickwright CAD",isDirectory:true) }
        try FileManager.default.createDirectory(at:folder,withIntermediateDirectories:true)
        return folder.resolvingSymlinksInPath()
    }
    private func libraryRequest(_ body: [String:String], reply: @escaping (Any?,String?) -> Void) {
        do {
            let folder = try libraryFolder()
            switch body["action"] {
            case "settings": reply(["path":folder.path],nil)
            case "choose-folder":
                let panel = NSOpenPanel(); panel.canChooseFiles=false;panel.canChooseDirectories=true;panel.canCreateDirectories=true;panel.allowsMultipleSelection=false;panel.directoryURL=folder;panel.prompt=L("Use as library")
                panel.beginSheetModal(for:window) { result in
                    guard result == .OK, let selected=panel.url else { reply(["path":folder.path,"canceled":true],nil); return }
                    UserDefaults.standard.set(selected.path,forKey:"CADLibraryFolder");reply(["path":selected.path],nil)
                }
            case "list":
                let files=try FileManager.default.contentsOfDirectory(at:folder,includingPropertiesForKeys:[.isRegularFileKey,.fileSizeKey],options:.skipsHiddenFiles)
                var result:[[String:String]]=[]
                for file in files where file.pathExtension == "bcad" {
                    guard file.resolvingSymlinksInPath().deletingLastPathComponent() == folder,let size=try file.resourceValues(forKeys:[.fileSizeKey]).fileSize,size <= 64*1024*1024,
                          let object=try? JSONSerialization.jsonObject(with:Data(contentsOf:file)) as? [String:Any],let project=object["project"] as? [String:Any],let id=project["id"] as? String else { continue }
                    result.append(["name":file.lastPathComponent,"id":id])
                };reply(result,nil)
            case "read":
                guard let name=body["name"],URL(fileURLWithPath:name).lastPathComponent == name,name.hasSuffix(".bcad") else { throw NSError(domain:"CAD",code:1,userInfo:[NSLocalizedDescriptionKey:L("Invalid library filename")]) }
                let file=folder.appendingPathComponent(name).resolvingSymlinksInPath()
                guard file.deletingLastPathComponent() == folder,let size=try file.resourceValues(forKeys:[.fileSizeKey]).fileSize,size <= 64*1024*1024 else { throw NSError(domain:"CAD",code:1,userInfo:[NSLocalizedDescriptionKey:L("Library project exceeds the file limit")]) }
                reply(try Data(contentsOf:file).base64EncodedString(),nil)
            case "write":
                guard let id=body["id"],id.range(of:"^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$",options:.regularExpression) != nil,
                      let encoded=body["data"],encoded.utf8.count<=90*1024*1024,let data=Data(base64Encoded:encoded),data.count<=64*1024*1024,
                      let archive=try JSONSerialization.jsonObject(with:data) as? [String:Any],archive["format"] as? String == "brickwright-cad-history",let project=archive["project"] as? [String:Any],project["id"] as? String == id,let revisions=archive["revisions"] as? [[String:Any]] else { throw NSError(domain:"CAD",code:1,userInfo:[NSLocalizedDescriptionKey:L("Invalid library project")]) }
                let file=folder.appendingPathComponent(id+".bcad")
                guard file.resolvingSymlinksInPath().deletingLastPathComponent() == folder else {throw NSError(domain:"CAD",code:1,userInfo:[NSLocalizedDescriptionKey:L("Library file points outside its folder")])}
                if FileManager.default.fileExists(atPath:file.path) {
                    guard let existing=try JSONSerialization.jsonObject(with:Data(contentsOf:file)) as? [String:Any],existing["format"] as? String == "brickwright-cad-history",let oldProject=existing["project"] as? [String:Any],oldProject["id"] as? String == id,let oldRevisions=existing["revisions"] as? [[String:Any]] else {throw NSError(domain:"CAD",code:1,userInfo:[NSLocalizedDescriptionKey:L("Existing library file needs recovery; it was not overwritten")])}
                    var incoming:[String:String]=[:];for revision in revisions{if let key=revision["id"] as? String,let hash=revision["snapshotHash"] as? String {incoming[key]=hash}}
                    guard oldRevisions.allSatisfy({old in guard let key=old["id"] as? String,let hash=old["snapshotHash"] as? String else{return false};return incoming[key]==hash}) else {throw NSError(domain:"CAD",code:1,userInfo:[NSLocalizedDescriptionKey:L("Library file has another history branch. Open it as a separate project before saving; existing history was preserved")])}
                }
                try data.write(to:file,options:.atomic);reply(["saved":true],nil)
            default: reply(nil,L("Unknown library operation"))
            }
        } catch { reply(nil,error.localizedDescription) }
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { pageLoaded = true; if smoke { pollSmoke() } }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { fail(error.localizedDescription) }
    private func pollSmoke() {
        smokeAttempts += 1
        if smokeAttempts > 180 { fail("Timed out waiting for native editor/geometry/history"); return }
        let script = """
        (() => {
          const host = document.querySelector('#cad-root');
          if (host?.dataset.state !== 'ready') return 'waiting';
          const root = host.shadowRoot;
          if(root.querySelectorAll('.project-actions button').length!==3||[...root.querySelectorAll('.project-actions button')].some(b=>b.getBoundingClientRect().width<30))return 'waiting';
          if (\(smokeStage) === 0 && !\(cameraSmokeDone)) {
            if (!root.querySelector('#save-state').textContent.includes('Saved · iteration')) return 'waiting';
            const canvas=root.querySelector('canvas[data-testid="cad-canvas"]'),box=canvas.getBoundingClientRect();
            return {kind:'camera-proof',x:box.x+box.width/2,y:box.y+box.height/2,zoom:Number(canvas.dataset.cameraZoom),saved:localStorage.getItem('brickwright-cad:standalone:v1')};
          }
          if (\(smokeStage) === 0) { root.querySelector('button[aria-label="Shapes"]').click();root.querySelector('button[aria-label="Add Box"]').click(); return 'added'; }
          const objects = root.querySelectorAll('[data-testid="object-name"]');
          if ((\(smokeStage) < 6 && objects.length !== 1) || (\(smokeStage) < 14 && Number(host.dataset.triangles) !== objects.length * 12)) return 'waiting';
          if (!root.querySelector('#save-state').textContent.includes('Saved · iteration')) return 'waiting';
          if (\(smokeStage) === 1) {
            root.querySelector('button[aria-label="Parameters"]').click();
            const panel = root.querySelector('.parameters-dialog');
            const click = label => Array.from(panel.querySelectorAll('button')).find(b => b.textContent === label).click();
            click('Add parameter');
            panel.querySelector('[aria-label="Parameter name"]').value = 'width';
            panel.querySelector('[aria-label="Parameter expression"]').value = '40';
            click('Drive a property');
            panel.querySelector('[aria-label="Driving expression"]').value = 'width';
            click('Apply parameters');
            if (!panel.querySelector('.parameter-status').textContent.includes('Parameters applied')) return 'parameter failure';
            panel.close(); return 'parameterized';
          }
          const doc = JSON.parse(localStorage.getItem('brickwright-cad:standalone:v1'));
          if ((doc.version !== 2 && doc.version !== 3 && doc.version !== 4) || doc.nodes[doc.roots[0]].size[0] !== 40) return 'parameter failure';
          if (\(smokeStage) === 2) return 'reload';
          if (\(smokeStage) === 3) { root.querySelector('#library').click(); return 'history'; }
          if (\(smokeStage) === 4) {document.querySelector('.library-dialog')?.close();root.querySelector('[data-testid="object-name"]').click();return 'commands';}
          if (\(smokeStage) === 5) return 'copy-poll';
          if (\(smokeStage) === 6) return objects.length === 2 ? 'paste-ready' : 'waiting';
          if (\(smokeStage) === 7) return objects.length === 3 ? 'duplicate-ready' : 'waiting';
          if (\(smokeStage) === 8) return objects.length === 2 ? 'delete-ready' : 'waiting';
          if (\(smokeStage) === 9) return objects.length === 3 ? 'undo-ready' : 'waiting';
          if (\(smokeStage) === 10) return objects.length === 2 ? 'sketch-command' : 'waiting';
          if (\(smokeStage) === 11) {
            const sketch = root.querySelector('.sketch-dialog[open]');if (!sketch) return 'waiting';
            for (const [label,value] of [['Sketch width (mm)','width'],['Sketch depth (mm)','width / 2'],['Extrusion distance (mm)','width / 8']]) {const input=sketch.querySelector('[aria-label="'+label+'"]');input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));}
            Array.from(sketch.querySelectorAll('button')).find(b=>b.textContent==='Create extrusion').click();return 'sketch-created';
          }
          if (\(smokeStage) === 12) {
            if (objects.length !== 3 || doc.version !== 3) return 'waiting';
            const extrusion = Object.values(doc.nodes).find(n=>n.kind==='extrusion');
            return extrusion?.distance==='width / 8' && doc.sketches?.[extrusion.sketchId]?.profile.width==='width' ? 'code-command' : 'feature failure';
          }
          if (\(smokeStage) === 13) {const panel=root.querySelector('.code-dialog[open]');if(!panel)return 'waiting';Array.from(panel.querySelectorAll('button')).find(b=>b.textContent==='Create code object').click();return 'code-created';}
          if (\(smokeStage) === 14) {const code=Object.values(doc.nodes).find(n=>n.kind==='code');return objects.length===4 && doc.version===4 && code?.program.language==='brickwright-cad-script' ? 'model-source-command':'waiting';}
          if (\(smokeStage) === 15) {const pane=root.querySelector('.model-source-pane:not([hidden])');return pane?.querySelector('textarea')?.value.includes('cad`') && doc.version===4 ? 'model-library-command':'waiting';}
          if (\(smokeStage) === 16) {const gallery=root.querySelector('.model-library-dialog[open]');if(!gallery||gallery.querySelectorAll('.model-library-card img').length<149||!root.querySelector('.file-tools')?.hidden)return 'waiting';gallery.close();return 'passed';}
          if (!Array.from(root.querySelectorAll('#iterations option')).some(option => option.textContent.startsWith('#3 ·'))) return 'waiting';
          if (!document.querySelector('.library-dialog .project-card')) return 'waiting';
          return window.brickwrightDesktop && !!window.webkit.messageHandlers.cadSave && !!window.brickwrightPrepareToClose ? 'passed' : 'bridge missing';
        })()
        """
        webView.evaluateJavaScript(script) { [weak self] result, error in
            guard let self else { return }
            if let error { self.fail(error.localizedDescription); return }
            if let info = result as? [String: Any], info["kind"] as? String == "camera-proof", let x = info["x"] as? Double, let y = info["y"] as? Double, let before = info["zoom"] as? Double, let saved = info["saved"] as? String, let view = self.webView as? CadWebView {
                guard self.magnificationMonitor != nil else { self.fail("Native magnification monitor missing"); return }
                view.routeCameraMagnification(factor: 1.2, x: x, y: y) { _, error in
                    if let error { self.fail(error.localizedDescription); return }
                    self.webView.callAsyncJavaScript("const c=document.querySelector('#cad-root').shadowRoot.querySelector('canvas[data-testid=\"cad-canvas\"]');return Number(c.dataset.cameraZoom)<before && (window.visualViewport?.scale??1)===1 && localStorage.getItem('brickwright-cad:standalone:v1')===saved;", arguments:["before":before,"saved":saved],in:nil,in:.page) { result in
                        guard case .success(let value) = result, value as? Bool == true else { self.fail("Native magnification did not zoom only the camera"); return }
                        print("PASS: native magnification route zooms camera at 1x page scale without changing project data")
                        guard self.wheelMonitor != nil else { self.fail("Native wheel monitor missing"); return }
                        self.webView.evaluateJavaScript("({target:document.querySelector('#cad-root').shadowRoot.querySelector('canvas[data-testid=\"cad-canvas\"]').dataset.cameraTarget,origin:performance.timeOrigin})") { value, error in
                            guard error == nil, let state = value as? [String:Any], let target = state["target"] as? String, let origin = state["origin"] as? Double else { self.fail("Missing camera pan state"); return }
                            view.routeCameraWheel(["kind":"wheel","x":x,"y":y,"deltaX":24,"deltaY":8,"deltaMode":0,"precise":true,"shiftKey":false,"altKey":false,"ctrlKey":false]) { handled in
                                guard handled else { self.fail("Native trackpad event was not consumed by camera"); return }
                                self.webView.callAsyncJavaScript("const c=document.querySelector('#cad-root').shadowRoot.querySelector('canvas[data-testid=\"cad-canvas\"]');return c.dataset.cameraTarget!==target && performance.timeOrigin===origin && (window.visualViewport?.scale??1)===1 && localStorage.getItem('brickwright-cad:standalone:v1')===saved;",arguments:["target":target,"origin":origin,"saved":saved],in:nil,in:.page) { result in
                                    guard case .success(let value) = result,value as? Bool == true else {self.fail("Native two-finger route did not pan without reloading");return}
                                    print("PASS: native precise scrolling pans camera without reload, page zoom or model edits")
                                    self.cameraSmokeDone=true
                                    self.pollSmoke()
                                }
                            }
                        }
                    }
                }
                return
            }
            if result as? String == "passed" {
                self.webView.callAsyncJavaScript("await window.brickwrightPrepareToClose();",arguments:[:],in:nil,in:.page){result in
                    do {
                        if case .failure(let error)=result { throw error }
                        let folder=try self.libraryFolder(),files=try FileManager.default.contentsOfDirectory(at:folder,includingPropertiesForKeys:nil).filter{$0.pathExtension=="bcad"}
                        guard files.count==1,let archive=try JSONSerialization.jsonObject(with:Data(contentsOf:files[0])) as? [String:Any],archive["format"] as? String == "brickwright-cad-history",let revisions=archive["revisions"] as? [Any],revisions.count>=3 else {self.fail("Native library file/history verification failed");return}
                        let original=try Data(contentsOf:files[0]);var pruned=archive;pruned["revisions"]=Array(revisions.dropFirst());let encoded=try JSONSerialization.data(withJSONObject:pruned).base64EncodedString();let project=archive["project"] as! [String:Any]
                        self.webView.callAsyncJavaScript("try {await window.webkit.messageHandlers.cadLibrary.postMessage({action:'write',id,data});return false;} catch(error){return true;}",arguments:["id":project["id"]!,"data":encoded],in:nil,in:.page){result in
                            do {guard case .success(let value)=result,value as? Bool == true,try Data(contentsOf:files[0])==original else {self.fail("Native library accepted a history-pruning write");return};try FileManager.default.removeItem(at:folder);self.pasteboard.releaseGlobally();print("PASS: native menus, private system clipboard Copy/Paste, Duplicate/Delete/Undo/Redo, parameters, native sketch/extrusion and coded-object creation, model-source menu/dock without a modeling edit, sole native File menu and model gallery thumbnails, library files and refusal to prune history");exit(0)}catch{self.fail(error.localizedDescription)}
                        };return
                    }catch{self.fail(error.localizedDescription)}
                };return
            }
            if result as? String == "added" { self.smokeStage = 1 }
            if result as? String == "parameterized" { self.smokeStage = 2 }
            if result as? String == "reload" { self.smokeStage = 3; self.webView.reload(); return }
            if result as? String == "history" { self.smokeStage = 4 }
            let itemFor:(String)->NSMenuItem?={command in NSApp.mainMenu?.items.compactMap{$0.submenu}.flatMap{$0.items}.first{$0.representedObject as? String == command}}
            @MainActor func perform(_ command:String){guard let item=itemFor(command),item.action == #selector(AppDelegate.performEditorCommand(_:)) else{self.fail("Native command missing: \(command)");return};self.performEditorCommand(item)}
            if result as? String == "commands" {
                for command in ["open","save","import","export","cut","copy","paste","duplicate","delete","fit","parameters","sketch","readout","code"]{if itemFor(command)==nil{self.fail("Native command missing: \(command)");return}}
                self.smokeStage=5;perform("copy")
            }
            if result as? String == "copy-poll",self.pasteboard.string(forType:self.clipboardType)?.contains("brickwright-cad-clipboard") == true {self.smokeStage=6;perform("paste")}
            if result as? String == "paste-ready" {self.smokeStage=7;perform("duplicate")}
            if result as? String == "duplicate-ready" {self.smokeStage=8;perform("delete")}
            if result as? String == "delete-ready" {self.smokeStage=9;perform("undo")}
            if result as? String == "undo-ready" {self.smokeStage=10;perform("redo")}
            if result as? String == "sketch-command" {self.smokeStage=11;perform("sketch")}
            if result as? String == "sketch-created" {self.smokeStage=12}
            if result as? String == "code-command" {self.smokeStage=13;perform("code")}
            if result as? String == "code-created" {self.smokeStage=14}
            if result as? String == "model-source-command" {self.smokeStage=15;perform("model-source")}
            if result as? String == "model-library-command" {self.smokeStage=16;perform("model-library")}
            if ["parameter failure", "feature failure", "bridge missing"].contains(result as? String ?? "") { self.fail(result as? String ?? "Verification failed"); return }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { self.pollSmoke() }
        }
    }
}

@main
struct CrispCAD {
    @MainActor static func main() {
        let application = NSApplication.shared
        let delegate = AppDelegate()
        application.delegate = delegate
        application.setActivationPolicy(.regular)
        withExtendedLifetime(delegate) { application.run() }
    }
}
