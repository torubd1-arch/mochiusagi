/**
 * 打者成績テーブル。打順 / 選手名 / 打率 / OPS / 打 / 安 / 点 / HR の順で1行に収める。
 * 途中出場選手(battingOrderがnull)は、少しインデントして表示する。
 */
(function (global) {
  "use strict";

  const { escapeHtml } = global.NPB.domUtils;
  const { formatAvgOrOps, formatCount } = global.NPB.statsService;
  const { renderHomeRunBadge } = global.NPB.components;

  /** @param {Array} batters BatterViewModel[] */
  function renderBattingTable(batters) {
    if (!batters || batters.length === 0) {
      return `<p class="empty-note">打撃成績データがありません</p>`;
    }

    const rows = batters.map(renderBatterRow).join("");

    return `
      <table class="batting-table">
        <thead>
          <tr>
            <th class="col-order sr-only">打順</th>
            <th class="col-name sr-only">選手</th>
            <th class="col-avg">打率</th>
            <th class="col-ops">OPS</th>
            <th class="col-num">打</th>
            <th class="col-num">安</th>
            <th class="col-num">点</th>
            <th class="col-hr">HR</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  function renderBatterRow(b) {
    const isSub = b.battingOrder == null;
    const orderLabel = isSub ? "" : String(b.battingOrder);
    const nameNote = isSub && b.position ? `<span class="sub-note">${escapeHtml(b.position)}</span>` : "";
    return `
      <tr class="${isSub ? "sub-row" : ""}">
        <td class="col-order">${orderLabel}</td>
        <td class="col-name">${escapeHtml(b.playerName)}${nameNote}</td>
        <td class="col-avg">${escapeHtml(formatAvgOrOps(b.battingAverage))}</td>
        <td class="col-ops">${escapeHtml(formatAvgOrOps(b.ops))}</td>
        <td class="col-num">${escapeHtml(formatCount(b.atBats))}</td>
        <td class="col-num">${escapeHtml(formatCount(b.hits))}</td>
        <td class="col-num">${escapeHtml(formatCount(b.rbi))}</td>
        <td class="col-hr">${renderHomeRunBadge(b.seasonHomeRuns, b.homeRunsInGame)}</td>
      </tr>`;
  }

  global.NPB = global.NPB || {};
  global.NPB.components = global.NPB.components || {};
  global.NPB.components.renderBattingTable = renderBattingTable;
})(window);
