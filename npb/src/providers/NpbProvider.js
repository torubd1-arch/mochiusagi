/**
 * 実データ提供元 Provider (最初の1試合分のみ)。
 *
 * データソース: armstjc/Nippon-Baseball-Data-Repository (GitHub, MITライセンス)
 * https://github.com/armstjc/Nippon-Baseball-Data-Repository
 * 実際にNPB公式サイト由来の試合ごとの打撃・投手成績を収集し、月次CSVとして
 * GitHub Releaseで配布している個人運営の公開データセット。
 *
 * 現状の取得経路について:
 *   このセッションの実行環境からは npb.jp はもちろん、GitHub Releases の
 *   ダウンロードURL(github.com/api.github.com)にも outbound アクセスできない
 *   ネットワーク制限があり、CIからの自動取得はできなかった。そのため今回は
 *   ユーザーに GitHub Release から該当月のCSV
 *   (https://github.com/armstjc/Nippon-Baseball-Data-Repository/releases/download/player_game_stats/2026-09_game_stats.csv)
 *   を手動でダウンロードしてもらい、`debug/2026-09_game_stats.raw.csv` として
 *   同梱している。fetchUrl だけをGitHub ReleaseのURLに差し替えれば、
 *   ブラウザから直接取得できる環境ではそのまま動作する。
 *
 * スコープ (意図的に1試合だけ):
 *   このCSVには「同じ team_id が同じ日付に複数の game_id へ現れる」データ品質の
 *   問題があり(一軍/ファーム混在の疑い)、全試合を無条件に信用すると誤表示に
 *   なりかねない。そのため今回は、選手名を目視で確認して一軍公式戦と確認できた
 *   1試合(2026-09-06 ヤクルト対阪神, game_id=2021039367)だけを許可リストで
 *   返すようにしてある。他の日付・試合を対象にするには、まず同様の確認
 *   (または2026年シーズンのschedule CSVとの突合)が必要。
 */
(function (global) {
  "use strict";

  var parser = global.NPB.parsers.gameStatsCsvParser;

  // 目視確認済みの一軍公式戦のみを許可する (date -> game_id)
  var VERIFIED_GAMES = {
    "2026-09-06": "2021039367"
  };

  var CSV_URL = "debug/2026-09_game_stats.raw.csv";
  var DEBUG_LOG_RAW = false; // trueにすると取得した生CSVの先頭をconsoleに出す

  var csvRowsPromise = null;
  function loadCsvRows() {
    if (!csvRowsPromise) {
      csvRowsPromise = fetch(CSV_URL)
        .then(function (res) {
          if (!res.ok) throw new Error("CSV取得に失敗しました: " + res.status);
          return res.text();
        })
        .then(function (text) {
          if (DEBUG_LOG_RAW) console.log("[NpbProvider] raw CSV bytes:", text.length, text.slice(0, 200));
          return parser.parseCsv(text);
        });
    }
    return csvRowsPromise;
  }

  var gameCache = new Map(); // gameId -> { meta, batting, pitching }
  function loadGame(gameId) {
    if (gameCache.has(gameId)) return Promise.resolve(gameCache.get(gameId));
    return loadCsvRows().then(function (rows) {
      var gameRows = rows.filter(function (r) { return r.game_id === gameId; });
      var game = parser.buildGame(gameId, gameRows);
      gameCache.set(gameId, game);
      return game;
    });
  }

  class NpbProvider {
    async getGames(date) {
      var gameId = VERIFIED_GAMES[date];
      if (!gameId) return [];
      var game = await loadGame(gameId);
      return [game.meta];
    }

    async getGameBattingStats(gameId) {
      var game = await loadGame(gameId);
      return game.batting;
    }

    async getGamePitchingStats(gameId) {
      var game = await loadGame(gameId);
      return game.pitching;
    }

    async getSeasonBattingStats(date) {
      // この実データソースには打率/OPS/シーズン累計HRが含まれていない(今後の課題)。
      // 空配列を返すことで、statsService側が自動的に "-" 表示にする。
      return [];
    }
  }

  global.NPB.NpbProvider = NpbProvider;
})(window);
