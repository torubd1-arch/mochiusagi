// js/supporterReaction.js - おうえんキャラクターのUI表示
// supportersData.js(データ)・supporterSelector.js(抽選・判定)を使って、
// 画面にキャラクター画像・表示名・セリフを描画する。
// 全モード(本編/れんしゅう/よみかた/かんじをえらぶ)から同じ関数を呼び出す。
//
// 学習情報(正誤・正答)は既存のsetLog/setYomikataFeedback等が必ず表示する。
// ここで描画するセリフだけで正答を説明することはない(演出のみ)。

let supporterPopupTimer = null;

// セリフ(ポップアップ)の表示時間。元の1300ms→1560ms→1.2倍(1872ms)→さらに1.5倍。
const SUPPORTER_POPUP_DURATION_MS = 2808;

function supporterEscapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function attachSupporterImgFallback(img, wrapEl) {
  if (!img || !wrapEl) return;
  img.addEventListener('error', () => {
    img.style.display = 'none';
    wrapEl.classList.add('yomi-cheer-noimg');
  }, { once: true });
}

// 正解・不正解のたびに、目立つ位置へ一時的なポップアップとして表示する。
// (本編/れんしゅう/よみかた/かんじをえらぶの1問ごとの反応)
function renderSupporterPopup(reaction, eventType) {
  const layer = document.getElementById('yomikata-cheer-layer');
  if (!layer) return;

  if (supporterPopupTimer) { clearTimeout(supporterPopupTimer); supporterPopupTimer = null; }
  layer.innerHTML = '';

  const isWrong = eventType === 'incorrect';
  const isBig = eventType === 'streakCorrect' || eventType === 'retrySuccess';

  const popup = document.createElement('div');
  popup.className = 'yomi-cheer-popup' +
    (isWrong ? ' yomi-cheer-wrong' : ' yomi-cheer-correct') +
    (isBig ? ' yomi-cheer-big' : '');
  popup.innerHTML = `
    <div class="yomi-cheer-bubble">${supporterEscapeHtml(reaction.message)}</div>
    <div class="yomi-cheer-figure">
      <img class="yomi-cheer-img" src="${supporterEscapeHtml(reaction.image)}" alt="${supporterEscapeHtml(reaction.alt || reaction.displayName)}">
      <div class="yomi-cheer-name">${supporterEscapeHtml(reaction.displayName)}</div>
    </div>`;
  attachSupporterImgFallback(popup.querySelector('.yomi-cheer-img'), popup);

  layer.appendChild(popup);

  supporterPopupTimer = setTimeout(() => {
    popup.classList.add('yomi-cheer-out');
    setTimeout(() => popup.remove(), 250);
    supporterPopupTimer = null;
  }, SUPPORTER_POPUP_DURATION_MS);
}

// eventType: 'normalCorrect'|'incorrect'|'retrySuccess'|'streakCorrect'
// 応援表示自体で例外が発生しても、呼び出し側の正誤判定・履歴保存・次問遷移は
// 継続させる(14章 フォールバック仕様)。
function showSupporterReaction(eventType, state) {
  try {
    const reaction = selectSupportReaction(eventType, state);
    renderSupporterPopup(reaction, eventType);
  } catch (e) {
    // 応援表示のみ諦める。ゲーム進行は呼び出し側の処理を継続させる。
  }
}

// セッション終了時、結果画面の常設領域にキャラクターを表示する(ポップアップではない)。
function renderSupporterOnResult(containerId, state) {
  const container = document.getElementById(containerId);
  if (!container) return;
  try {
    const reaction = selectSupportReaction('sessionComplete', state);
    container.innerHTML = `
      <div class="supporter-static">
        <img class="supporter-static-img" src="${supporterEscapeHtml(reaction.image)}" alt="${supporterEscapeHtml(reaction.alt || reaction.displayName)}">
        <div class="supporter-static-name">${supporterEscapeHtml(reaction.displayName)}</div>
        <div class="supporter-static-bubble">${supporterEscapeHtml(reaction.message)}</div>
      </div>`;
    attachSupporterImgFallback(
      container.querySelector('.supporter-static-img'),
      container.querySelector('.supporter-static')
    );
  } catch (e) {
    container.innerHTML = '';
  }
}
