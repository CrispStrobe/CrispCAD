import UIKit
import Capacitor
import WebKit

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = CadSafeAreaController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}

final class CadSafeAreaController: UIViewController {
    private let content = CadBridgeController()
    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 16/255, green: 26/255, blue: 36/255, alpha: 1)
        addChild(content)
        view.addSubview(content.view)
        content.view.translatesAutoresizingMaskIntoConstraints = false
        let area = view.safeAreaLayoutGuide
        NSLayoutConstraint.activate([
            content.view.leadingAnchor.constraint(equalTo: area.leadingAnchor),
            content.view.trailingAnchor.constraint(equalTo: area.trailingAnchor),
            content.view.topAnchor.constraint(equalTo: area.topAnchor),
            content.view.bottomAnchor.constraint(equalTo: area.bottomAnchor)
        ])
        content.didMove(toParent: self)
    }
    override var childForStatusBarStyle: UIViewController? { content }
    override var childForStatusBarHidden: UIViewController? { content }
}

final class CadBridgeController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        guard let webView = webView else { return }
        webView.scrollView.isScrollEnabled = false
        webView.scrollView.bounces = false
        webView.scrollView.bouncesZoom = false
        webView.scrollView.minimumZoomScale = 1
        webView.scrollView.maximumZoomScale = 1
        webView.scrollView.pinchGestureRecognizer?.isEnabled = false
        webView.pageZoom = 1
        let info = ["version": Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "unknown", "build": Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "unknown"]
        if let data = try? JSONSerialization.data(withJSONObject: info), let json = String(data: data, encoding: .utf8) {
            let source = "window.brickwrightNativeInfo = \(json);"
            webView.configuration.userContentController.addUserScript(WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: true))
            webView.evaluateJavaScript(source, completionHandler: nil)
        }
    }
}
