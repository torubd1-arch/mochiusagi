/**
 * 1チーム分（打者成績＋投手成績）のセクション。
 */
(function (global) {
  "use strict";

  const { escapeHtml } = global.NPB.domUtils;
  const { renderBattingTable } = global.NPB.components;
  const { renderPitchingTable } = global.NPB.components;

  /** @param {*} team TeamGameData */
  function renderTeamSection(team) {
    return `
      <div class="team-section">
        <h3 class="team-name">${escapeHtml(team.teamName)}</h3>
        <div class="stat-block">
          <h4 class="stat-label">打者</h4>
          ${renderBattingTable(team.batters)}
        </div>
        <div class="stat-block">
          <h4 class="stat-label">投手</h4>
          ${renderPitchingTable(team.pitchers)}
        </div>
      </div>`;
  }

  global.NPB = global.NPB || {};
  global.NPB.components = global.NPB.components || {};
  global.NPB.components.renderTeamSection = renderTeamSection;
})(window);
