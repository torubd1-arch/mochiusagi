// js/config/buildConfigIOSApp.js - iOSアプリ版(Capacitor)専用のBUILD_MODE
//
// このファイルは ios-app/scripts/build-www.mjs がアプリ用にコピーした
// index.html からのみ読み込まれる(コピー時に buildConfig.js の読み込みを
// このファイルへ差し替える)。GitHub Pagesの index.html は引き続き
// js/config/buildConfig.js ('web-full' 固定)を読み込み、このファイルは読み込まない。
//
// 'ios-free' : 無料体験版。購入状態は window.NativeIAPBridge(ネイティブ側で注入)
//              から取得する。ブリッジ未接続の間は 'unavailable' として扱われる。

const BUILD_MODE = 'ios-free';
