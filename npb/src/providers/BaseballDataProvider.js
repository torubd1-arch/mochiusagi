/**
 * データ提供元インターフェース。
 *
 * 画面(components)・組み立て処理(services)は、この形の provider にだけ依存する。
 * データ取得元を変える場合は、この4メソッドを実装した新しい Provider を追加して
 * app.js の生成箇所を差し替えるだけでよい（UI・services 側の変更は不要）。
 *
 * 実装例:
 *   - NPB.MockProvider   … オフラインのサンプルデータ（既定）
 *   - NPB.NpbProvider    … 実データ取得元用のスタブ（未接続。README参照）
 *
 * @typedef {Object} GameBattingStats
 * @property {string} playerId
 * @property {string} playerName
 * @property {number|null} battingOrder
 * @property {string|null} position
 * @property {number} atBats
 * @property {number} hits
 * @property {number} rbi
 * @property {number} homeRunsInGame
 *
 * @typedef {Object} SeasonBattingStatsSnapshot
 * @property {string} playerId
 * @property {string} date  "YYYY-MM-DD" … この日付終了時点のシーズン累計
 * @property {number|null} battingAverage
 * @property {number|null} obp
 * @property {number|null} slg
 * @property {number|null} ops
 * @property {number|null} homeRuns
 *
 * @typedef {Object} GamePitchingStats
 * @property {string} playerId
 * @property {string} playerName
 * @property {string} inningsPitched
 * @property {number|null} pitches
 * @property {number} hitsAllowed
 * @property {number} strikeouts
 * @property {number} walks
 * @property {number} runs
 * @property {number} earnedRuns
 * @property {("W"|"L"|"S"|"H"|null)} [decision]
 * @property {number|null} [seasonEra]
 *
 * @typedef {Object} GameMeta
 * @property {string} gameId
 * @property {string} date
 * @property {string} awayTeamId
 * @property {string} awayTeamName
 * @property {string} homeTeamId
 * @property {string} homeTeamName
 * @property {number|null} awayScore
 * @property {number|null} homeScore
 * @property {("scheduled"|"live"|"finished")} status
 * @property {string|null} inning
 * @property {string|null} startTime
 * @property {string} lastUpdated  ISO8601
 *
 * インターフェース（各 Provider 実装が満たすべきメソッド）:
 *   getGames(date: "YYYY-MM-DD") => Promise<GameMeta[]>
 *   getGameBattingStats(gameId: string) => Promise<{ [teamId]: GameBattingStats[] }>
 *   getGamePitchingStats(gameId: string) => Promise<{ [teamId]: GamePitchingStats[] }>
 *   getSeasonBattingStats(date: "YYYY-MM-DD") => Promise<SeasonBattingStatsSnapshot[]>
 */
(function (global) {
  "use strict";

  global.NPB = global.NPB || {};

  /** 未実装メソッド呼び出し時の共通エラー */
  global.NPB.NotImplementedError = class NotImplementedError extends Error {
    constructor(methodName) {
      super(`BaseballDataProvider: "${methodName}" is not implemented.`);
      this.name = "NotImplementedError";
    }
  };
})(window);
