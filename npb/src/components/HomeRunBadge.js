/**
 * このアプリの最重要UI。
 * 丸の中身は常に「その日時点のシーズン累計本塁打数」。
 * 白丸(hr-badge)  = 表示中の試合ではHRを打っていない
 * 黒丸(hit-today) = 表示中の試合でHRを打った(1本以上)
 * Unicode丸数字には依存せず、CSSで円を描画する。
 */
(function (global) {
  "use strict";

  const { escapeHtml } = global.NPB.domUtils;

  /**
   * @param {number|null} seasonHomeRuns シーズン累計本塁打数(その日時点)
   * @param {number} homeRunsInGame この試合でのHR数
   * @returns {string} HTML文字列
   */
  function renderHomeRunBadge(seasonHomeRuns, homeRunsInGame) {
    const hitToday = homeRunsInGame > 0;
    const label = seasonHomeRuns == null ? "-" : String(seasonHomeRuns);
    const multiHr = hitToday && homeRunsInGame >= 2 ? `<span class="hr-multi">×${homeRunsInGame}</span>` : "";
    const cls = hitToday ? "hr-badge hit-today" : "hr-badge";
    const title = hitToday ? `本塁打あり（今日${homeRunsInGame}本）` : "本塁打なし";
    return `<span class="hr-cell"><span class="${cls}" title="${escapeHtml(title)}">${escapeHtml(label)}</span>${multiHr}</span>`;
  }

  global.NPB = global.NPB || {};
  global.NPB.components = global.NPB.components || {};
  global.NPB.components.renderHomeRunBadge = renderHomeRunBadge;
})(window);
