// nativeIAPBridge.js - iOSアプリ版専用。scripts/build-www.mjs が www/js/ にコピーし、
// アプリ用 index.html にだけ読み込ませる(GitHub Pages の Web版には含まれない)。
//
// ネイティブの KanjiStore プラグイン(ios/App/App/KanjiStorePlugin.swift, StoreKit 2)を、
// kanji_battle/js/entitlementService.js が前提とする window.NativeIAPBridge の形で公開する。
// js/capacitor.js (@capacitor/core) の後、entitlementService.js より前に読み込むこと。

(function () {
  const cap = window.Capacitor;
  if (!cap || !cap.isNativePlatform() || !cap.isPluginAvailable('KanjiStore')) return;

  const KanjiStore = cap.registerPlugin('KanjiStore');

  window.NativeIAPBridge = {
    getEntitlements: () => KanjiStore.getEntitlements(),
    purchase:        () => KanjiStore.purchase(),
    restore:         () => KanjiStore.restore(),
    getProductInfo:  () => KanjiStore.getProductInfo(),
  };

  // 承認待ちだった購入の承認・別端末での購入・返金などで購入状態が変わったら取り直す
  KanjiStore.addListener('entitlementsChanged', () => {
    if (typeof EntitlementService !== 'undefined') EntitlementService.refreshEntitlements();
  });
})();
