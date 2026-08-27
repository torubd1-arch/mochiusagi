/**
 * 1試合分のカード。スコア見出し＋試合状態＋両チーム(打者・投手)を必ず表示する。
 * 勝利チームだけ、ホームチームだけを表示することはしない。
 */
(function (global) {
  "use strict";

  const { escapeHtml } = global.NPB.domUtils;
  const { renderTeamSection } = global.NPB.components;

  const STATUS_LABEL = { scheduled: "試合前", live: "試合中", finished: "試合終了" };

  /** @param {*} game GameViewModel */
  function renderGameCard(game) {
    const homeScore = game.homeScore ?? 0;
    const awayScore = game.awayScore ?? 0;

    const statusHtml = renderStatus(game);

    return `
      <section class="game-card" data-game-id="${escapeHtml(game.gameId)}" data-status="${escapeHtml(game.status)}">
        <div class="score-line">
          <span class="team-score">
            <span class="score-team-name">${escapeHtml(game.homeTeam.teamName)}</span>
            <span class="score-num">${homeScore}</span>
          </span>
          <span class="score-sep">-</span>
          <span class="team-score">
            <span class="score-num">${awayScore}</span>
            <span class="score-team-name">${escapeHtml(game.awayTeam.teamName)}</span>
          </span>
        </div>
        <div class="game-status">${statusHtml}</div>
        ${renderTeamSection(game.homeTeam)}
        ${renderTeamSection(game.awayTeam)}
      </section>`;
  }

  function renderStatus(game) {
    if (game.status === "scheduled") {
      const start = game.startTime ? `${escapeHtml(game.startTime)}開始` : "";
      return `<span class="status-badge status-scheduled">試合前</span><span class="status-detail">${start}</span>`;
    }
    if (game.status === "live") {
      const inning = game.inning ? escapeHtml(game.inning) : "試合中";
      return `<span class="status-badge status-live">${inning}</span>`;
    }
    return `<span class="status-badge status-finished">試合終了</span>`;
  }

  global.NPB = global.NPB || {};
  global.NPB.components = global.NPB.components || {};
  global.NPB.components.renderGameCard = renderGameCard;
})(window);
