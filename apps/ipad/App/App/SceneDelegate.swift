import UIKit
import Capacitor

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
    private let content = CAPBridgeViewController()
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
