// js/iapFlow.js - ロックのおしらせ→保護者ゲート→購入画面の一連の画面制御
//
// どの画面も、購入状態の判定はEntitlementServiceだけに問い合わせる。
// このファイル自身もLocalStorage/StoreKitを直接は触らない。

// ロック画面から「もどる」で戻る先(呼び出し元の画面ID)。
let iapReturnScreenId = 'screen-title';

// ========== 保護者ゲート: 二桁の計算問題 ==========
let gateCorrectAnswer = null;
let gateOnSuccess = null;

function generateGateProblem() {
  const a = 10 + Math.floor(Math.random() * 90); // 10〜99
  const b = 10 + Math.floor(Math.random() * 90); // 10〜99
  const useSubtraction = Math.random() < 0.5 && a >= b;
  if (useSubtraction) {
    return { text: `${a} − ${b} = ?`, answer: a - b };
  }
  return { text: `${a} + ${b} = ?`, answer: a + b };
}

// keepMessage: trueのとき gate-message の表示内容をそのまま残す
// (不正解直後に問題を差し替えるときに、直前のメッセージを消さないため)。
function renderNewGateProblem(keepMessage) {
  const problem = generateGateProblem();
  gateCorrectAnswer = problem.answer; // 画面には表示しない(クロージャ内にのみ保持)
  const problemEl = document.getElementById('gate-problem-text');
  const inputEl = document.getElementById('gate-answer-input');
  const msgEl = document.getElementById('gate-message');
  if (problemEl) problemEl.textContent = problem.text;
  if (inputEl) inputEl.value = '';
  if (msgEl && !keepMessage) msgEl.textContent = '';
}

// onSuccess: 正解したときに呼ばれるコールバック。
// returnScreenId: キャンセル/不正解時に「もどる」で戻る画面ID。
function showParentalGate(onSuccess, returnScreenId) {
  iapReturnScreenId = returnScreenId || iapReturnScreenId;
  gateOnSuccess = onSuccess;
  renderNewGateProblem();
  showScreen('screen-parental-gate');
  const inputEl = document.getElementById('gate-answer-input');
  if (inputEl) inputEl.focus();
}

function submitGateAnswer() {
  const inputEl = document.getElementById('gate-answer-input');
  const msgEl = document.getElementById('gate-message');
  if (!inputEl) return;
  const value = inputEl.value.trim();
  if (value === '' || Number(value) !== gateCorrectAnswer) {
    // 不正解: 次に進めない。新しい問題に差し替える(連打での突破を防ぐ)。
    if (msgEl) msgEl.textContent = 'こたえが ちがうみたい。もう一度どうぞ。';
    renderNewGateProblem(true);
    const inputEl2 = document.getElementById('gate-answer-input');
    if (inputEl2) inputEl2.focus();
    return;
  }
  const cb = gateOnSuccess;
  gateOnSuccess = null;
  gateCorrectAnswer = null;
  if (cb) cb();
}

// ========== ロックのおしらせ画面 ==========
// returnScreenId: 「もどる」で戻る画面ID(ロックされた操作をした場所)。
function showLockNotice(returnScreenId) {
  iapReturnScreenId = returnScreenId || iapReturnScreenId;
  showScreen('screen-lock-notice');
}

// ========== 保護者向け購入画面 ==========
function setPurchaseStatus(text, kind) {
  const el = document.getElementById('purchase-status');
  if (!el) return;
  el.textContent = text || '';
  el.className = 'purchase-status' + (kind ? ` is-${kind}` : '');
}

function renderPurchaseFreeKanjiList() {
  const listEl = document.getElementById('purchase-free-kanji-list');
  const countEl = document.getElementById('purchase-free-kanji-count');
  if (typeof FREE_KANJI === 'undefined') return;
  if (listEl) listEl.textContent = FREE_KANJI.join('・');
  if (countEl) countEl.textContent = String(FREE_KANJI.length);
}

async function showPurchaseScreen() {
  renderPurchaseFreeKanjiList();
  showScreen('screen-purchase');

  const status = EntitlementService.getEntitlementStatus();
  if (status === 'unknown') {
    setPurchaseStatus('こうにゅうじょうほうを かくにんしています…');
  } else if (status === 'unavailable') {
    setPurchaseStatus('こうにゅうじょうほうを かくにんできませんでした。しばらくしてから もう一度お試しください。', 'error');
  } else if (status === 'full') {
    setPurchaseStatus('すでに全機能を ご利用いただけます。ありがとうございます！', 'success');
  } else {
    setPurchaseStatus('');
  }
}

async function handlePurchaseBuy() {
  setPurchaseStatus('しょりちゅうです…');
  const result = await EntitlementService.purchaseFullVersion();
  if (result.outcome === 'purchased') {
    setPurchaseStatus('こうにゅうが かんりょうしました。すべての かんじで あそべます！', 'success');
  } else if (result.outcome === 'pending') {
    setPurchaseStatus('しょうにんを まっています…');
  } else if (result.outcome === 'cancelled') {
    setPurchaseStatus('');
  } else if (result.outcome === 'unavailable-here') {
    setPurchaseStatus(result.message || 'この機能は iPhoneアプリ版で ご利用いただけます。');
  } else {
    setPurchaseStatus('こうにゅう処理を かんりょうできませんでした。時間をおいて もう一度お試しください。', 'error');
  }
}

async function handlePurchaseRestore() {
  setPurchaseStatus('こうにゅうじょうほうを かくにんしています…');
  const result = await EntitlementService.restorePurchases();
  if (result.outcome === 'restored') {
    setPurchaseStatus('購入内容を ふっきゅうしました。すべての かんじで あそべます！', 'success');
  } else if (result.outcome === 'nothing-to-restore') {
    setPurchaseStatus('復元できる購入が 見つかりませんでした。');
  } else if (result.outcome === 'unavailable-here') {
    setPurchaseStatus(result.message || 'この機能は iPhoneアプリ版で ご利用いただけます。');
  } else {
    setPurchaseStatus('ふっきゅう処理を かんりょうできませんでした。時間をおいて もう一度お試しください。', 'error');
  }
}

// ========== タイトル画面の学年ロック表示 ==========
function refreshTitleGradeLocks() {
  document.querySelectorAll('#title-grade-tabs .grade-tab').forEach(tab => {
    const raw = tab.dataset.grade;
    const grade = raw === 'all' ? 'all' : parseInt(raw);
    const lockIcon = tab.querySelector('.grade-lock-icon');
    const locked = !EntitlementService.canUseGrade(grade);
    if (lockIcon) lockIcon.hidden = !locked;
    tab.classList.toggle('grade-tab-locked', locked);
  });
}

// ========== 初期化 ==========
document.addEventListener('DOMContentLoaded', () => {
  EntitlementService.onStatusChange(() => {
    refreshTitleGradeLocks();
  });
  EntitlementService.refreshEntitlements().then(() => {
    refreshTitleGradeLocks();
  });

  const askParentBtn = document.getElementById('btn-lock-ask-parent');
  if (askParentBtn) {
    askParentBtn.addEventListener('click', () => {
      Audio.playSelect();
      showParentalGate(() => { showPurchaseScreen(); }, iapReturnScreenId);
    });
  }

  const lockBackBtn = document.getElementById('btn-lock-notice-back');
  if (lockBackBtn) {
    lockBackBtn.addEventListener('click', () => {
      Audio.playSelect();
      showScreen(iapReturnScreenId);
    });
  }

  const gateSubmitBtn = document.getElementById('btn-gate-submit');
  if (gateSubmitBtn) {
    gateSubmitBtn.addEventListener('click', () => {
      Audio.playSelect();
      submitGateAnswer();
    });
  }
  const gateInput = document.getElementById('gate-answer-input');
  if (gateInput) {
    gateInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        Audio.playSelect();
        submitGateAnswer();
      }
    });
  }
  const gateCancelBtn = document.getElementById('btn-gate-cancel');
  if (gateCancelBtn) {
    gateCancelBtn.addEventListener('click', () => {
      Audio.playSelect();
      gateOnSuccess = null;
      gateCorrectAnswer = null;
      showScreen(iapReturnScreenId);
    });
  }

  const purchaseBackBtn = document.getElementById('btn-purchase-back');
  if (purchaseBackBtn) {
    purchaseBackBtn.addEventListener('click', () => {
      Audio.playSelect();
      showScreen(iapReturnScreenId);
    });
  }
  const purchaseNotNowBtn = document.getElementById('btn-purchase-notnow');
  if (purchaseNotNowBtn) {
    purchaseNotNowBtn.addEventListener('click', () => {
      Audio.playSelect();
      showScreen(iapReturnScreenId);
    });
  }
  const purchaseBuyBtn = document.getElementById('btn-purchase-buy');
  if (purchaseBuyBtn) {
    purchaseBuyBtn.addEventListener('click', () => {
      Audio.playSelect();
      handlePurchaseBuy();
    });
  }
  const purchaseRestoreBtn = document.getElementById('btn-purchase-restore');
  if (purchaseRestoreBtn) {
    purchaseRestoreBtn.addEventListener('click', () => {
      Audio.playSelect();
      handlePurchaseRestore();
    });
  }
  const purchasePrivacyBtn = document.getElementById('btn-purchase-privacy');
  if (purchasePrivacyBtn) {
    purchasePrivacyBtn.addEventListener('click', () => {
      Audio.playSelect();
      showScreen('screen-privacy');
    });
  }
  const purchaseLicenseBtn = document.getElementById('btn-purchase-license');
  if (purchaseLicenseBtn) {
    purchaseLicenseBtn.addEventListener('click', () => {
      Audio.playSelect();
      showScreen('screen-license');
    });
  }
  const licenseBackBtn = document.getElementById('btn-license-back');
  if (licenseBackBtn) {
    licenseBackBtn.addEventListener('click', () => {
      Audio.playSelect();
      showScreen('screen-purchase');
    });
  }

  // タイトル学年タブ: ロックされている学年/ぜんぶを選んだら、既存の
  // 選択処理の代わりにロックのおしらせへ誘導する。
  document.querySelectorAll('#title-grade-tabs .grade-tab').forEach(tab => {
    tab.addEventListener('click', (e) => {
      const raw = tab.dataset.grade;
      const grade = raw === 'all' ? 'all' : parseInt(raw);
      if (!EntitlementService.canUseGrade(grade)) {
        e.stopImmediatePropagation();
        Audio.playSelect();
        showLockNotice('screen-title');
      }
    }, true); // capture: main.js側の選択処理より先に判定する
  });
});
