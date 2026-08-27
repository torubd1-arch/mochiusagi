/**
 * Provider から生データを取得し、statsService で結合して、画面がそのまま描画できる
 * GameViewModel[] を組み立てる。UIコンポーネントはこのサービスの戻り値だけを見る。
 */
(function (global) {
  "use strict";

  const { statsService, cacheService } = global.NPB;

  function todayString() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function emptyTeam(teamId, teamName) {
    return { teamId, teamName, batters: [], pitchers: [] };
  }

  /**
   * @param {*} provider BaseballDataProvider実装
   * @param {string} date "YYYY-MM-DD"
   * @param {{forceRefresh?: boolean}} [options]
   * @returns {Promise<Array>} GameViewModel[]
   */
  async function getGamesForDate(provider, date, options = {}) {
    const isToday = date === todayString();
    const cacheKind = "games";

    if (!options.forceRefresh && !isToday) {
      const cached = cacheService.read(cacheKind, date);
      // 過去日は試合終了済みなので、一度取れたら期限なしで使い回してよい
      if (cached) return cached.payload;
    }

    const [games, seasonSnapshots] = await Promise.all([provider.getGames(date), provider.getSeasonBattingStats(date)]);

    const viewModels = await Promise.all(
      games.map(async (game) => {
        const [battingByTeam, pitchingByTeam] = await Promise.all([
          safeCall(() => provider.getGameBattingStats(game.gameId), {}),
          safeCall(() => provider.getGamePitchingStats(game.gameId), {}),
        ]);

        const awayBatters = statsService.joinBatterStats(battingByTeam[game.awayTeamId] || [], seasonSnapshots);
        const homeBatters = statsService.joinBatterStats(battingByTeam[game.homeTeamId] || [], seasonSnapshots);

        return {
          gameId: game.gameId,
          date: game.date,
          awayTeam: {
            teamId: game.awayTeamId,
            teamName: game.awayTeamName,
            batters: awayBatters,
            pitchers: pitchingByTeam[game.awayTeamId] || [],
          },
          homeTeam: {
            teamId: game.homeTeamId,
            teamName: game.homeTeamName,
            batters: homeBatters,
            pitchers: pitchingByTeam[game.homeTeamId] || [],
          },
          awayScore: game.awayScore,
          homeScore: game.homeScore,
          status: game.status,
          inning: game.inning,
          startTime: game.startTime,
          lastUpdated: game.lastUpdated,
        };
      })
    );

    if (!isToday) {
      cacheService.write(cacheKind, date, viewModels);
    }

    return viewModels;
  }

  async function safeCall(fn, fallback) {
    try {
      return await fn();
    } catch (e) {
      console.error(e);
      return fallback;
    }
  }

  global.NPB = global.NPB || {};
  global.NPB.gameService = { getGamesForDate, todayString };
})(window);
