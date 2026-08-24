// js/config/buildConfigIOSPreview.js - ios-preview.html 専用のBUILD_MODE
//
// このファイルは ios-preview.html からのみ読み込まれる。
// index.html は js/config/buildConfig.js ('web-full' 固定)を読み込み、
// このファイルは絶対に読み込まない。
//
// 'ios-free' : 無料体験版としての画面/ロック/購入導線を確認するための設定。
//              window.NativeIAPBridge が存在しないため、購入状態は
//              常に 'unavailable' として扱われる(=購入情報を取得できない状態)。
//              これは意図的な挙動で、「ブリッジ未接続時にfullへ誤って
//              倒れない」ことを確認するためのもの。

const BUILD_MODE = 'ios-free';
