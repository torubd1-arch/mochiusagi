// js/entitlementService.js - 購入状態(entitlement)の一元管理
//
// 「無料版か、全機能購入済みか」の判定は必ずこのサービスを経由すること。
// 各画面がLocalStorageやStoreKit(将来のネイティブブリッジ)を直接参照しては
// いけない。無料対象コンテンツは js/config/freeContent.js の
// FREE_GRADE / FREE_KANJI が唯一の情報源。
//
// 状態:
//   unknown     : 購入状態を確認中
//   free        : 未購入
//   full        : 全機能購入済み(検証済みトランザクションに基づく)
//   unavailable : 購入情報を取得できない(ネットワーク不通・ブリッジ未実装など)
//
// 重要: このファイルはLocalStorageに「購入済みフラグ」を書き込まない。
// 最終的な購入判定は、将来接続するStoreKitの検証済みトランザクション
// (window.NativeIAPBridge、まだ実装されていない)にのみ基づく。
// window.NativeIAPBridge が存在しない環境(現状のWeb版・このプレビュー環境)
// では、購入を「成功した」ことには絶対にしない。
//
// window.NativeIAPBridge の想定インターフェース(将来、iOS側のネイティブ
// ブリッジがこの形で window に注入する想定。今回は実装しない):
//   getEntitlements() => Promise<{ verified: boolean, status: 'full'|'free' }>
//   purchase()        => Promise<{ verified: boolean, status: 'full'|'pending'|'cancelled'|'failed' }>
//   restore()         => Promise<{ verified: boolean, status: 'full'|'free'|'failed' }>

const EntitlementService = (() => {
  const UNAVAILABLE_MESSAGE = 'この機能は iPhoneアプリ版で ご利用いただけます。';

  // BUILD_MODE が読み込まれていない環境(未接続のテスト等)への防御的フォールバック。
  // 本番(index.html)では必ず js/config/buildConfig.js が先に読み込まれ、
  // BUILD_MODE = 'web-full' が定義されている。
  const mode = (typeof BUILD_MODE !== 'undefined') ? BUILD_MODE : 'web-full';

  let status = (mode === 'web-full') ? 'full' : 'unknown';
  let devOverrideStatus = null; // 'development' モードでのみ有効
  const listeners = new Set();

  function notify() {
    listeners.forEach(fn => {
      try { fn(status); } catch (e) {}
    });
  }

  function getBridge() {
    return (typeof window !== 'undefined' && window.NativeIAPBridge) ? window.NativeIAPBridge : null;
  }

  async function refreshEntitlements() {
    if (mode === 'web-full') {
      status = 'full';
      notify();
      return status;
    }

    status = 'unknown';
    notify();

    const bridge = getBridge();
    if (bridge && typeof bridge.getEntitlements === 'function') {
      try {
        const result = await bridge.getEntitlements();
        status = (result && result.verified && result.status === 'full') ? 'full' : 'free';
      } catch (e) {
        status = 'unavailable';
      }
    } else if (mode === 'development' && devOverrideStatus) {
      // 開発専用モードでのみ、StoreKit未接続でも状態をテストできる。
      status = devOverrideStatus;
    } else {
      // ブリッジが存在しない = 購入情報を取得できない。
      // 「未購入(free)」と断定せず、区別できる状態として扱う。
      status = 'unavailable';
    }

    notify();
    return status;
  }

  async function purchaseFullVersion() {
    if (mode === 'web-full') {
      return { outcome: 'unavailable-here', message: UNAVAILABLE_MESSAGE };
    }

    const bridge = getBridge();
    if (!bridge || typeof bridge.purchase !== 'function') {
      return { outcome: 'unavailable-here', message: UNAVAILABLE_MESSAGE };
    }

    try {
      const result = await bridge.purchase();
      if (result && result.verified && result.status === 'full') {
        status = 'full';
        notify();
        return { outcome: 'purchased' };
      }
      if (result && result.status === 'pending') return { outcome: 'pending' };
      if (result && result.status === 'cancelled') return { outcome: 'cancelled' };
      return { outcome: 'failed' };
    } catch (e) {
      return { outcome: 'failed' };
    }
  }

  async function restorePurchases() {
    if (mode === 'web-full') {
      return { outcome: 'unavailable-here', message: UNAVAILABLE_MESSAGE };
    }

    const bridge = getBridge();
    if (!bridge || typeof bridge.restore !== 'function') {
      return { outcome: 'unavailable-here', message: UNAVAILABLE_MESSAGE };
    }

    try {
      const result = await bridge.restore();
      if (result && result.verified && result.status === 'full') {
        status = 'full';
        notify();
        return { outcome: 'restored' };
      }
      if (result && result.verified && result.status === 'free') {
        status = 'free';
        notify();
        return { outcome: 'nothing-to-restore' };
      }
      return { outcome: 'failed' };
    } catch (e) {
      return { outcome: 'failed' };
    }
  }

  function getEntitlementStatus() {
    return status;
  }

  function hasFullAccess() {
    return status === 'full';
  }

  function canUseKanji(kanji) {
    if (hasFullAccess()) return true;
    return (typeof FREE_KANJI !== 'undefined') && FREE_KANJI.includes(kanji);
  }

  // grade: 1〜6 の数値、または 'all'。
  // 「そのタブ/その学年に入れるか」の判定であり、grade内の個々の漢字が
  // すべて遊べるとは限らない(無料学年でも canUseKanji で個別に絞られる)。
  function canUseGrade(grade) {
    if (hasFullAccess()) return true;
    if (grade === 'all') return false;
    return (typeof FREE_GRADE !== 'undefined') && grade === FREE_GRADE;
  }

  // UIが購入状態の変化を検知して再描画するための購読。
  // (画面を再読み込みしなくてもロック解除できるようにするため)
  function onStatusChange(fn) {
    if (typeof fn !== 'function') return () => {};
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  // 'development' モード専用。StoreKit未接続でも購入状態をテストするための
  // デバッグ用フック。他のモードでは何もしない(本番へ混入しても無効)。
  function _setDevStatus(nextStatus) {
    if (mode !== 'development') return false;
    devOverrideStatus = nextStatus;
    status = nextStatus;
    notify();
    return true;
  }

  return {
    getEntitlementStatus,
    hasFullAccess,
    canUseKanji,
    canUseGrade,
    purchaseFullVersion,
    restorePurchases,
    refreshEntitlements,
    onStatusChange,
    _setDevStatus,
  };
})();
