/**
 * 打撃成績の結合・整形ロジック。UI(components)からは呼ばれるが、DOMには一切触れない。
 */
(function (global) {
  "use strict";

  /**
   * GameBattingStats[] と SeasonBattingStatsSnapshot[] を playerId で結合し、
   * 画面表示用の BatterViewModel[] を作る。
   *
   * 同姓の選手を取り違えないよう、結合キーは必ず playerId を使う（名字だけでは結合しない）。
   *
   * @param {import('../providers/BaseballDataProvider.js').GameBattingStats[]} gameBatters
   * @param {import('../providers/BaseballDataProvider.js').SeasonBattingStatsSnapshot[]} seasonSnapshots
   * @returns {Array} BatterViewModel[]
   */
  function joinBatterStats(gameBatters, seasonSnapshots) {
    const seasonByPlayerId = new Map(seasonSnapshots.map((s) => [s.playerId, s]));
    return gameBatters.map((gb) => {
      const season = seasonByPlayerId.get(gb.playerId) || null;
      const ops = season ? computeOps(season) : null;
      return {
        playerId: gb.playerId,
        playerName: gb.playerName,
        battingOrder: gb.battingOrder,
        position: gb.position,
        battingAverage: season ? season.battingAverage : null,
        ops,
        atBats: gb.atBats,
        hits: gb.hits,
        rbi: gb.rbi,
        seasonHomeRuns: season ? season.homeRuns : null,
        homeRunsInGame: gb.homeRunsInGame,
      };
    });
  }

  /** OPS を求める。snapshot に ops があればそれを使い、無ければ OBP+SLG から計算する。 */
  function computeOps(season) {
    if (season.ops != null) return season.ops;
    if (season.obp != null && season.slg != null) return season.obp + season.slg;
    return null;
  }

  /** 打率・OPS表示: ".312" 形式。1.000以上は "1.045" のようにそのまま表示。データなしは "-"。 */
  function formatAvgOrOps(value) {
    if (value == null || Number.isNaN(value)) return "-";
    if (value >= 1) return value.toFixed(3);
    if (value < 0) return "-";
    return value.toFixed(3).replace(/^0/, "");
  }

  /** 防御率表示: "2.31" 形式。データなしは "-"。 */
  function formatEra(value) {
    if (value == null || Number.isNaN(value)) return "-";
    return value.toFixed(2);
  }

  /** 数値表示。null/undefined は "-"（本当の0とは区別する）。 */
  function formatCount(value) {
    if (value == null || Number.isNaN(value)) return "-";
    return String(value);
  }

  global.NPB = global.NPB || {};
  global.NPB.statsService = { joinBatterStats, computeOps, formatAvgOrOps, formatEra, formatCount };
})(window);
