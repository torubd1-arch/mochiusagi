/**
 * 実データ用パーサー: armstjc/Nippon-Baseball-Data-Repository が配布する
 * 月次CSV (`{season}-{month}_game_stats.csv`) を、既存UIが期待する
 * GameBattingStats[] / GamePitchingStats[] / GameMeta の形へ変換する。
 *
 * HTML/CSVの中身の解釈はすべてこのファイルに閉じ込め、Provider(取得)や
 * UIコンポーネント(表示)には一切のパース知識を持ち込まない。
 *
 * データソース: https://github.com/armstjc/Nippon-Baseball-Data-Repository
 * (MITライセンス。利用時はREADME記載のクレジット表記が必要)
 *
 * 既知の制約(2026-09分CSVを実際に調査して判明したもの):
 *   - 打順(battingOrder)を示す列が無い。CSVの行順は打順と一致しないため、
 *     正しく打順を再現できるまでは null（=UI側で空欄・代打相当の表示）にする。
 *   - pitching_W / pitching_L / pitching_SV はシーズン累計値であり、
 *     「その試合の勝敗」ではない。その試合の決定(W/L/S)を安全に導出する
 *     方法が無いため decision は null にする。
 *   - 同じ team_id が同じ日付に複数の game_id へ現れるケースがあった
 *     (一軍/ファーム混在、または誤登録の疑い)。そのため本パーサーは
 *     「isKnownGoodGameId」で明示的に許可した game_id のみを対象とする。
 */
(function (root, factory) {
  var mod = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = mod;
  } else {
    root.NPB = root.NPB || {};
    root.NPB.parsers = root.NPB.parsers || {};
    root.NPB.parsers.gameStatsCsvParser = mod;
  }
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  // team_id -> 球団名 (rosters/{年}_npb_rosters.csv の team_id,team_name から採取した実際の対応表)
  var TEAM_NAMES = {
    "1": "読売ジャイアンツ",
    "2": "東京ヤクルトスワローズ",
    "3": "横浜DeNAベイスターズ",
    "4": "中日ドラゴンズ",
    "5": "阪神タイガース",
    "6": "広島東洋カープ",
    "7": "埼玉西武ライオンズ",
    "8": "北海道日本ハムファイターズ",
    "9": "千葉ロッテマリーンズ",
    "11": "オリックス・バファローズ",
    "12": "福岡ソフトバンクホークス",
    "376": "東北楽天ゴールデンイーグルス"
  };

  /** 簡易CSVパーサー(ダブルクォート囲み・カンマ・改行に対応)。 */
  function parseCsv(text) {
    var rows = [];
    var row = [];
    var field = "";
    var inQuotes = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
        } else {
          field += c;
        }
      } else if (c === '"') {
        inQuotes = true;
      } else if (c === ",") {
        row.push(field); field = "";
      } else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(field); field = "";
        if (row.length > 1 || row[0] !== "") rows.push(row);
        row = [];
      } else {
        field += c;
      }
    }
    if (field !== "" || row.length > 0) { row.push(field); rows.push(row); }

    var header = rows[0];
    return rows.slice(1).map(function (r) {
      var obj = {};
      header.forEach(function (h, idx) { obj[h] = r[idx] === undefined ? "" : r[idx]; });
      return obj;
    });
  }

  function numOrNull(v) {
    if (v == null || v === "") return null;
    var n = Number(v);
    return isNaN(n) ? null : n;
  }
  function intOrZero(v) {
    var n = numOrNull(v);
    return n == null ? 0 : Math.trunc(n);
  }

  function isPitcherRow(row) { return !!row.pitching_IP_str; }
  function isBatterRow(row) { return row.batting_PA !== "" || row.batting_AB !== ""; }

  function toGameBattingStats(row) {
    return {
      playerId: row.player_id,
      playerName: row.player_name_jap,
      battingOrder: null, // このデータソースには打順列が無い(README参照)
      position: row.position || null,
      atBats: intOrZero(row.batting_AB),
      hits: intOrZero(row.batting_H),
      rbi: intOrZero(row.batting_RBI),
      homeRunsInGame: intOrZero(row.batting_HR)
    };
  }

  function toGamePitchingStats(row) {
    return {
      playerId: row.player_id,
      playerName: row.player_name_jap,
      inningsPitched: row.pitching_IP_str,
      pitches: numOrNull(row.pitching_PI),
      hitsAllowed: intOrZero(row.pitching_H),
      strikeouts: intOrZero(row.pitching_SO),
      walks: intOrZero(row.pitching_BB),
      runs: intOrZero(row.pitching_R),
      earnedRuns: intOrZero(row.pitching_ER),
      decision: null, // pitching_W/L/SVはシーズン累計のため、この試合の決定は導出不可
      seasonEra: numOrNull(row.pitching_ERA)
    };
  }

  /**
   * 1試合分のCSV行(両チーム混在)から、GameViewModel互換の生データを組み立てる。
   * @param {string} gameId
   * @param {Array<Object>} rows その game_id に絞り込んだCSV行
   * @param {{awayTeamId?: string}} [opts] home/awayの順序はこのデータソースからは
   *        判定できないため、明示指定が無ければ team_id の小さい方を away とする。
   */
  function buildGame(gameId, rows, opts) {
    if (rows.length === 0) return null;
    var teamIds = Array.from(new Set(rows.map(function (r) { return r.team_id; }))).sort();
    if (teamIds.length !== 2) {
      throw new Error("buildGame: expected exactly 2 teams for game " + gameId + ", got " + teamIds.length);
    }
    var awayTeamId = (opts && opts.awayTeamId) || teamIds[0];
    var homeTeamId = teamIds.find(function (t) { return t !== awayTeamId; });

    var battingByTeam = {};
    var pitchingByTeam = {};
    var runsByTeam = {};
    teamIds.forEach(function (t) { battingByTeam[t] = []; pitchingByTeam[t] = []; runsByTeam[t] = 0; });

    rows.forEach(function (row) {
      var t = row.team_id;
      if (isBatterRow(row)) {
        battingByTeam[t].push(toGameBattingStats(row));
        runsByTeam[t] += intOrZero(row.batting_R);
      }
      if (isPitcherRow(row)) pitchingByTeam[t].push(toGamePitchingStats(row));
    });

    return {
      meta: {
        gameId: gameId,
        date: rows[0].game_date,
        awayTeamId: awayTeamId,
        awayTeamName: TEAM_NAMES[awayTeamId] || ("team_id:" + awayTeamId),
        homeTeamId: homeTeamId,
        homeTeamName: TEAM_NAMES[homeTeamId] || ("team_id:" + homeTeamId),
        awayScore: runsByTeam[awayTeamId],
        homeScore: runsByTeam[homeTeamId],
        status: "finished",
        inning: null,
        startTime: null,
        lastUpdated: new Date().toISOString()
      },
      batting: battingByTeam,
      pitching: pitchingByTeam
    };
  }

  return {
    TEAM_NAMES: TEAM_NAMES,
    parseCsv: parseCsv,
    toGameBattingStats: toGameBattingStats,
    toGamePitchingStats: toGamePitchingStats,
    buildGame: buildGame
  };
});
