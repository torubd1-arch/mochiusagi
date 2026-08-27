/**
 * オフラインのサンプルデータを返す BaseballDataProvider 実装。
 *
 * 実データ提供元(NPB公式・スポナビ等)の調査・利用規約確認が済むまでの間、
 * このアプリの画面・組み立てロジックを最初から最後まで確認できるようにする。
 * "today"(=当日) だけ、ポーリングのたびにスコア・イニング・打撃成績が進行する
 * ライブ速報のデモになっている。
 */
(function (global) {
  "use strict";

  const data = global.NPB.sampleData;

  class MockProvider {
    constructor() {
      /** @type {Map<string, number>} gameId -> 現在のステージindex(ポーリング進行度) */
      this._stageByGame = new Map();
    }

    /**
     * 当日(TODAY_FIXTURE)のカードだけ、呼び出すたびにステージを1つ進める。
     * これにより 30秒〜2分間隔の自動更新で「速報が進む」様子を再現する。
     */
    _advanceStage(game) {
      const stages = game.stages;
      const current = this._stageByGame.get(game.gameId) ?? 0;
      const next = Math.min(current + 1, stages.length - 1);
      // 初回呼び出し(current未登録)はstage0のまま返し、以降の呼び出しで進める
      const useIndex = this._stageByGame.has(game.gameId) ? next : current;
      this._stageByGame.set(game.gameId, useIndex);
      return useIndex;
    }

    async getGames(date) {
      const games = data.gamesByDate[date] || [];
      const isToday = date === todayString();
      return games.map((game) => {
        const stageIndex = isToday ? this._advanceStage(game) : game.stages.length - 1;
        const stage = game.stages[stageIndex];
        return {
          gameId: game.gameId,
          date: game.date,
          awayTeamId: game.awayTeamId,
          awayTeamName: game.awayTeamName,
          homeTeamId: game.homeTeamId,
          homeTeamName: game.homeTeamName,
          awayScore: stage.awayScore,
          homeScore: stage.homeScore,
          status: stage.status,
          inning: stage.inning,
          startTime: game.startTime,
          lastUpdated: new Date().toISOString(),
          _stageIndex: stageIndex,
        };
      });
    }

    async getGameBattingStats(gameId) {
      const stageIndex = this._stageByGame.get(gameId);
      const overrides = data.battingStageOverrides[gameId];
      if (overrides && stageIndex != null && overrides[stageIndex]) {
        return overrides[stageIndex];
      }
      return data.battingByGame[gameId] || {};
    }

    async getGamePitchingStats(gameId) {
      const stageIndex = this._stageByGame.get(gameId);
      const overrides = data.pitchingStageOverrides[gameId];
      if (overrides && stageIndex != null && overrides[stageIndex]) {
        return overrides[stageIndex];
      }
      return data.pitchingByGame[gameId] || {};
    }

    async getSeasonBattingStats(date) {
      return data.seasonSnapshots[date] || [];
    }
  }

  function todayString() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  global.NPB.MockProvider = MockProvider;
})(window);
