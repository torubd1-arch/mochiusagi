import UIKit
import Capacitor

/// アプリの起点の画面(SceneDelegate が生成する)。アプリ専用のプラグインをここで Capacitor に登録する。
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(KanjiStorePlugin())
    }
}
