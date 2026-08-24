# iPhoneアプリ版 実装計画 (無料体験版 + 買い切り課金)

このドキュメントは、Mac / Apple Developer Program 登録後に着手する作業をまとめたものです。
今回のセッションでは、この計画に基づく **土台のみ** を実装しています。実際の決済処理・
StoreKitとの接続・アプリのネイティブビルドは今回のスコープ外です(下記「今回やらないこと」参照)。

## 今回のセッションで実装した土台

- `js/config/buildConfig.js` … 配布モード定数 `BUILD_MODE`(`web-full` / `ios-free` / `development`)。
  各HTMLファイルが個別に持つハードコードされたコピーで、実行時に書き換え不可能。
- `js/config/freeContent.js` … 無料体験版で遊べる範囲の単一情報源(`FREE_GRADE` / `FREE_KANJI`)。
- `js/entitlementService.js` … 購入状態の一元管理(`EntitlementService`)。将来
  `window.NativeIAPBridge` が接続されるまでは、`ios-free`/`development` モードで
  「購入情報を取得できない(unavailable)」として扱い、絶対に `full` を偽装しない。
- `js/iapFlow.js` … 保護者ゲート・ロックのおしらせ・購入画面の画面遷移制御。
- `index.html` の新規画面: ロックのおしらせ / 保護者ゲート / 購入画面 / ライセンス画面。
- `main.js` / `readingMode.js` / `kanjiSelectMode.js` の各コンテンツ取得箇所に
  `EntitlementService.canUseKanji()` / `canUseGrade()` によるフィルタとロック表示を追加。
- `ios-preview.html`(トップページから未リンク)… `BUILD_MODE = 'ios-free'` で
  無料体験版の画面・ロック導線を確認するための検証用ページ。

## 今回やらないこと(意図的にスコープ外)

- Capacitor 等によるネイティブアプリ化、iOSプロジェクトの生成
- Swiftコードの実装、StoreKit 2 の実処理
- App Store Connect でのApp内課金プロダクト登録・価格設定
- 実際の商品ID・価格のハードコード
- サーバーサイドのレシート検証基盤の構築
- サードパーティ製IAPライブラリの導入

---

## フェーズ1: Apple Developer 環境の準備 (Mac入手後)

1. Apple Developer Program へ登録(個人 or 法人、年会費の支払い)。
2. Xcode のインストール、Apple ID でのサインイン。
3. App Store Connect で新規Appレコードを作成(Bundle ID・SKU・対応言語など)。
4. アプリのプライバシー情報(App Privacy)の入力方針を決める
   (現状 `kanji_battle` はLocalStorageのみで外部送信なし → 「データを収集しない」で申告できる見込み。
   実装後に実際の通信有無を再確認すること)。

## フェーズ2: ネイティブアプリの土台作成

1. Capacitor(または類似のWebViewラッパー)で `kanji_battle/` 一式をiOSプロジェクト化する。
   - Web版(`index.html`)とは別に、`BUILD_MODE = 'ios-free'` を設定したエントリファイルを
     アプリ側の起点にする(今回作成した `ios-preview.html` の考え方をベースに、
     アプリ用に整理する)。
2. アプリアイコン・起動画面・iPhone実機/シミュレータでの表示確認(セーフエリア対応など)。
3. `window.NativeIAPBridge` を注入するネイティブブリッジ層を実装する場所を確保する
   (Capacitorプラグイン、または `WKScriptMessageHandler` を使った最小限の橋渡し)。

## フェーズ3: StoreKit 2 ブリッジの実装(最小構成を推奨)

サードパーティのIAPライブラリではなく、**最小限のStoreKit 2ブリッジを自前実装すること**を推奨する。
このアプリは「買い切り1商品のみ」というシンプルな要件のため、外部ライブラリの学習・保守コストが
過剰になりやすい。

1. App Store Connect で非消耗型(Non-Consumable)のApp内課金商品を1つ登録する
   (商品IDは実装時に決定。価格は「価格帯」から選択し、JS側には一切ハードコードしない)。
2. Swift側で `StoreKit 2` の `Product.products(for:)` / `Product.purchase()` /
   `Transaction.currentEntitlements` / `Transaction.updates` を使い、以下3関数を実装する。
   これは `js/entitlementService.js` が既に前提として定義済みのインターフェースと一致させる:
   ```
   window.NativeIAPBridge = {
     getEntitlements: () => Promise<{ verified: boolean, status: 'full' | 'free' }>,
     purchase:        () => Promise<{ verified: boolean, status: 'full' | 'pending' | 'cancelled' | 'failed' }>,
     restore:         () => Promise<{ verified: boolean, status: 'full' | 'free' | 'failed' }>,
   };
   ```
3. `verified` は、StoreKit 2 の `VerificationResult` が `.verified` であることを確認した場合のみ
   `true` にする(`.unverified` は `false` として扱い、`full` にしない)。
4. アプリ起動時・フォアグラウンド復帰時に `Transaction.updates` を購読し、
   購入状態が変化したら `EntitlementService.refreshEntitlements()` に相当する処理を
   JS側から再度呼び出す(WebView→JSのブリッジコール)。
5. 価格表示は `Product.displayPrice`(StoreKitがローカライズ済みの文字列を返す)を使う。
   `purchase-price-placeholder` (`#purchase-price`) の中身をこの値に差し替える形にする。

## フェーズ4: 動作確認(Mac/実機/Sandboxで)

- Sandboxテスターアカウントでの購入・復元テスト。
- 購入キャンセル・失敗・pending(承認待ち、ファミリー共有の「承認と購入のリクエスト」など)の
  各分岐が `js/iapFlow.js` の `handlePurchaseBuy` / `handlePurchaseRestore` で
  正しくハンドリングされることを確認する(既に文言は実装済み、実際の分岐が正しく届くか確認)。
- 再インストール後の「購入を復元」導線の確認。
- 機内モード等、通信不可時に `unavailable` 状態になり、`full` を誤って返さないことの確認。
- 保護者ゲート・ロック導線・LocalStorageの学習記録が実機でも壊れていないことの確認。

## フェーズ5: 申請・審査

1. スクリーンショット・プレビュー動画・Appの説明文・キーワードの準備。
2. 年齢区分(Kids Category / Age rating)の申告。教育アプリ・保護者ゲートの実装内容を
   審査ノートに明記する(「保護者ゲート実装済み」であることはガイドライン4.8 kids category対応上、重要)。
3. プライバシーポリシーURL(現状アプリ内 `#screen-privacy` にのみ存在。App Store Connect提出用に、
   ホスティングされたURLが別途必要になる可能性が高いため、GitHub Pages等での公開を検討する)。
4. TestFlightで内部テスト → 外部テスト(必要なら)→ 本審査提出。
5. リジェクト対応(課金関連は特に「復元ボタンの有無」「サブスクでないことの明記」等が
   審査対象になりやすいため、今回実装済みの購入画面の文言をそのまま維持する)。

## 保留・要検討事項

- 無料版の範囲(現在10字)を審査後に変更したくなった場合、`js/config/freeContent.js` のみを
  更新すれば全画面に反映される設計にしてある。
- ファミリー共有(Family Sharing)対応の要否は商品登録時に選択する。
- 価格改定時の扱い(StoreKitの価格は自動的にローカライズされるため、コード変更は不要な想定)。
