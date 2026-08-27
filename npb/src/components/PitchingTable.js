/**
 * 投手成績テーブル。投手 / (ERA) / 回 / 球 / 安 / 振 / 四 / 失 / 自。
 * ERA列は画面が狭い場合CSSで非表示にする(打者側の情報量を優先)。
 */
(function (global) {
  "use strict";

  const { escapeHtml } = global.NPB.domUtils;
  const { formatEra, formatCount } = global.NPB.statsService;

  const DECISION_LABEL = { W: "○", L: "●", S: "S", H: "H" };
  const DECISION_CLASS = { W: "win", L: "loss", S: "save", H: "hold" };

  /** @param {Array} pitchers GamePitchingStats[] */
  function renderPitchingTable(pitchers) {
    if (!pitchers || pitchers.length === 0) {
      return `<p class="empty-note">投手成績データがありません</p>`;
    }

    const rows = pitchers.map(renderPitcherRow).join("");

    return `
      <table class="pitching-table">
        <thead>
          <tr>
            <th class="col-name sr-only">投手</th>
            <th class="col-era">ERA</th>
            <th class="col-num">回</th>
            <th class="col-num">球</th>
            <th class="col-num">安</th>
            <th class="col-num">振</th>
            <th class="col-num">四</th>
            <th class="col-num">失</th>
            <th class="col-num">自</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  function renderPitcherRow(p) {
    const decisionLabel = p.decision ? DECISION_LABEL[p.decision] || p.decision : "";
    const decisionClass = p.decision ? `decision-${DECISION_CLASS[p.decision] || ""}` : "";
    const decisionBadge = decisionLabel ? `<span class="decision-badge ${decisionClass}">${escapeHtml(decisionLabel)}</span>` : "";
    return `
      <tr>
        <td class="col-name">${decisionBadge}${escapeHtml(p.playerName)}</td>
        <td class="col-era">${escapeHtml(formatEra(p.seasonEra))}</td>
        <td class="col-num">${escapeHtml(p.inningsPitched ?? "-")}</td>
        <td class="col-num">${escapeHtml(formatCount(p.pitches))}</td>
        <td class="col-num">${escapeHtml(formatCount(p.hitsAllowed))}</td>
        <td class="col-num">${escapeHtml(formatCount(p.strikeouts))}</td>
        <td class="col-num">${escapeHtml(formatCount(p.walks))}</td>
        <td class="col-num">${escapeHtml(formatCount(p.runs))}</td>
        <td class="col-num">${escapeHtml(formatCount(p.earnedRuns))}</td>
      </tr>`;
  }

  global.NPB = global.NPB || {};
  global.NPB.components = global.NPB.components || {};
  global.NPB.components.renderPitchingTable = renderPitchingTable;
})(window);
