import Foundation
import Capacitor
import StoreKit

/// かんじバトルの買い切り課金(非消耗型1商品)を StoreKit 2 で扱う最小限のプラグイン。
///
/// JS側では www/js/nativeIAPBridge.js がこのプラグインを window.NativeIAPBridge として
/// 公開し、kanji_battle/js/entitlementService.js から呼ばれる。
/// 返す値の形は entitlementService.js 冒頭のインターフェースに合わせている。
///
/// verified: true を返すのは、StoreKit の VerificationResult が .verified のときだけ。
/// .unverified の取引は購入済み(full)として扱わない。
@objc(KanjiStorePlugin)
public class KanjiStorePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "KanjiStorePlugin"
    public let jsName = "KanjiStore"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getEntitlements", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "purchase", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "restore", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getProductInfo", returnType: CAPPluginReturnPromise)
    ]

    /// App Store Connect に登録する非消耗型商品のID。
    /// 商品登録時はこの値と完全に一致させること(KanjiBattle.storekit の productID も同じ値)。
    static let fullVersionProductID = "io.github.torubd1arch.kanjibattle.fullversion"

    private var updatesTask: Task<Void, Never>?

    override public func load() {
        // アプリ外で完了した取引(承認待ちの承認・別端末での購入・返金など)を受け取り、
        // JS側に購入状態の再取得を促す。
        updatesTask = Task { [weak self] in
            for await result in Transaction.updates {
                if case .verified(let transaction) = result {
                    await transaction.finish()
                }
                self?.notifyListeners("entitlementsChanged", data: [:])
            }
        }
    }

    deinit {
        updatesTask?.cancel()
    }

    @objc func getEntitlements(_ call: CAPPluginCall) {
        Task {
            let hasFullVersion = await Self.hasVerifiedFullVersion()
            call.resolve(["verified": true, "status": hasFullVersion ? "full" : "free"])
        }
    }

    @objc func purchase(_ call: CAPPluginCall) {
        Task {
            do {
                guard let product = try await Self.fullVersionProduct() else {
                    call.resolve(["verified": false, "status": "failed"])
                    return
                }
                switch try await product.purchase() {
                case .success(.verified(let transaction)):
                    await transaction.finish()
                    call.resolve(["verified": true, "status": "full"])
                case .success(.unverified):
                    call.resolve(["verified": false, "status": "failed"])
                case .pending:
                    call.resolve(["verified": false, "status": "pending"])
                case .userCancelled:
                    call.resolve(["verified": false, "status": "cancelled"])
                @unknown default:
                    call.resolve(["verified": false, "status": "failed"])
                }
            } catch {
                call.resolve(["verified": false, "status": "failed"])
            }
        }
    }

    @objc func restore(_ call: CAPPluginCall) {
        Task {
            do {
                try await AppStore.sync()
            } catch {
                call.resolve(["verified": false, "status": "failed"])
                return
            }
            let hasFullVersion = await Self.hasVerifiedFullVersion()
            call.resolve(["verified": true, "status": hasFullVersion ? "full" : "free"])
        }
    }

    /// 購入画面に表示する価格。StoreKit がローカライズ済みの文字列(例: ¥600)をそのまま返す。
    @objc func getProductInfo(_ call: CAPPluginCall) {
        Task {
            guard let product = try? await Self.fullVersionProduct() else {
                call.reject("product not found")
                return
            }
            call.resolve(["displayPrice": product.displayPrice, "displayName": product.displayName])
        }
    }

    private static func fullVersionProduct() async throws -> Product? {
        try await Product.products(for: [fullVersionProductID]).first
    }

    private static func hasVerifiedFullVersion() async -> Bool {
        for await result in Transaction.currentEntitlements {
            if case .verified(let transaction) = result,
               transaction.productID == fullVersionProductID,
               transaction.revocationDate == nil {
                return true
            }
        }
        return false
    }
}
