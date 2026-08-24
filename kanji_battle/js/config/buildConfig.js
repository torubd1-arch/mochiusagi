// js/config/buildConfig.js - 配布モードの切り替え
//
// この定数は、各HTMLファイルが個別に持つコピーの中でのみ設定する。
// URLパラメータやLocalStorageなど、実行時に外部から書き換えられる値からは
// 絶対に決定しないこと(本番ページが誤って開発/無料体験モードになる事故を防ぐため)。
//
//   'web-full'    : 従来のWeb版。常に全機能を利用できる(index.html はこれで固定)
//   'ios-free'    : 無料体験版。EntitlementServiceの購入状態により機能が制限される
//   'development' : 課金状態をテストできる開発専用モード(本番では絶対に使用しない)
//
// index.html (GitHub Pagesで公開している本番ページ) は 'web-full' から
// 変更しないこと。ios-free/developmentの動作確認は ios-preview.html
// (トップページからリンクされていない検証用ページ)で行う。

const BUILD_MODE = 'web-full';
