/**
 * サンプル（モック）データ。
 *
 * NPB プロ野球 試合結果・速報ビューア の Phase 1〜7 MVP を、実データ取得元の
 * 調査・契約が済むまでの間オフラインで通しで確認できるようにするための固定データ。
 *
 * 「過去日はその日時点のシーズン成績を表示する」という最重要要件を確認できるように、
 * 同じ選手について 2026-08-01 時点と 2026-08-27 時点の season snapshot をあえて
 * 別の値にしてある。
 */
(function (global) {
  "use strict";

  const TODAY_FIXTURE = "2026-08-27"; // 本日=試合中デモ
  const PAST_FIXTURE = "2026-08-01"; // 過去日デモ

  // ── シーズン成績スナップショット（日付時点のシーズン累計） ──────────────
  // SeasonBattingStatsSnapshot[]
  const seasonSnapshots = {
    [PAST_FIXTURE]: [
      { playerId: "T-konomoto", date: PAST_FIXTURE, battingAverage: 0.298, obp: 0.36, slg: 0.41, ops: null, homeRuns: 3 },
      { playerId: "T-nakano", date: PAST_FIXTURE, battingAverage: 0.271, obp: 0.33, slg: 0.36, ops: null, homeRuns: 1 },
      { playerId: "T-morishita", date: PAST_FIXTURE, battingAverage: 0.28, obp: 0.35, slg: 0.49, ops: null, homeRuns: 15 },
      { playerId: "T-satoteru", date: PAST_FIXTURE, battingAverage: 0.301, obp: 0.38, slg: 0.52, ops: null, homeRuns: 19 },
      { playerId: "T-daikan", date: PAST_FIXTURE, battingAverage: 0.255, obp: 0.31, slg: 0.4, ops: null, homeRuns: 4 },
      { playerId: "G-okamoto", date: PAST_FIXTURE, battingAverage: 0.275, obp: 0.352, slg: 0.44, ops: null, homeRuns: 10 },
      { playerId: "G-sakamoto", date: PAST_FIXTURE, battingAverage: 0.288, obp: 0.34, slg: 0.39, ops: null, homeRuns: 4 },
    ],
    [TODAY_FIXTURE]: [
      { playerId: "T-konomoto", date: TODAY_FIXTURE, battingAverage: 0.312, obp: 0.378, slg: 0.407, ops: 0.785, homeRuns: 8 },
      { playerId: "T-nakano", date: TODAY_FIXTURE, battingAverage: 0.287, obp: 0.35, slg: 0.384, ops: 0.734, homeRuns: 3 },
      { playerId: "T-morishita", date: TODAY_FIXTURE, battingAverage: 0.297, obp: 0.386, slg: 0.526, ops: 0.912, homeRuns: 31 },
      { playerId: "T-satoteru", date: TODAY_FIXTURE, battingAverage: 0.319, obp: 0.415, slg: 0.53, ops: 0.945, homeRuns: 30 },
      { playerId: "T-daikan", date: TODAY_FIXTURE, battingAverage: 0.261, obp: 0.322, slg: 0.402, ops: 0.724, homeRuns: 9 },
      { playerId: "T-umeno", date: TODAY_FIXTURE, battingAverage: 0.243, obp: 0.31, slg: 0.35, ops: 0.66, homeRuns: 2 },
      { playerId: "T-kohata", date: TODAY_FIXTURE, battingAverage: 0.0, obp: 0.0, slg: 0.0, ops: null, homeRuns: 0 },
      { playerId: "G-okamoto", date: TODAY_FIXTURE, battingAverage: 0.28, obp: 0.365, slg: 0.475, ops: 0.84, homeRuns: 18 },
      { playerId: "G-sakamoto", date: TODAY_FIXTURE, battingAverage: 0.301, obp: 0.352, slg: 0.493, ops: 0.845, homeRuns: 18 },
      { playerId: "G-kikuchi", date: TODAY_FIXTURE, battingAverage: 0.264, obp: 0.33, slg: 0.36, ops: 0.69, homeRuns: 5 },
      { playerId: "C-nogami", date: TODAY_FIXTURE, battingAverage: 0.256, obp: 0.31, slg: 0.34, ops: 0.65, homeRuns: 5 },
      { playerId: "D-makihara", date: TODAY_FIXTURE, battingAverage: 0.278, obp: 0.34, slg: 0.44, ops: 0.78, homeRuns: 12 },
      { playerId: "D-oosuga", date: TODAY_FIXTURE, battingAverage: 0.291, obp: 0.36, slg: 0.41, ops: 0.77, homeRuns: 6 },
      { playerId: "C-nakata", date: TODAY_FIXTURE, battingAverage: 0.245, obp: 0.3, slg: 0.36, ops: 0.66, homeRuns: 7 },
    ],
  };

  // ── 試合当日の打撃成績（GameBattingStats[]） ─────────────────────────
  const battingByGame = {
    "2026-08-27-hanshin-yomiuri": {
      hanshin: [
        { playerId: "T-konomoto", playerName: "近本", battingOrder: 1, position: "中", atBats: 4, hits: 2, rbi: 1, homeRunsInGame: 0 },
        { playerId: "T-nakano", playerName: "中野", battingOrder: 2, position: "二", atBats: 4, hits: 1, rbi: 0, homeRunsInGame: 0 },
        { playerId: "T-morishita", playerName: "森下", battingOrder: 3, position: "右", atBats: 4, hits: 2, rbi: 3, homeRunsInGame: 1 },
        { playerId: "T-satoteru", playerName: "佐藤輝", battingOrder: 4, position: "三", atBats: 3, hits: 1, rbi: 0, homeRunsInGame: 0 },
        { playerId: "T-daikan", playerName: "大山", battingOrder: 5, position: "一", atBats: 4, hits: 1, rbi: 0, homeRunsInGame: 0 },
        { playerId: "T-umeno", playerName: "梅野", battingOrder: 6, position: "捕", atBats: 3, hits: 0, rbi: 0, homeRunsInGame: 0 },
        { playerId: "T-kohata", playerName: "小幡", battingOrder: 7, position: "遊", atBats: 2, hits: 0, rbi: 0, homeRunsInGame: 0 },
        // 途中出場（代打）: 打数0でも表示されるテストケース
        { playerId: "T-sub1", playerName: "原口", battingOrder: null, position: "代打", atBats: 0, hits: 0, rbi: 0, homeRunsInGame: 0 },
      ],
      yomiuri: [
        { playerId: "G-okamoto", playerName: "岡本", battingOrder: 1, position: "三", atBats: 4, hits: 1, rbi: 0, homeRunsInGame: 0 },
        { playerId: "G-sakamoto", playerName: "坂本", battingOrder: 2, position: "遊", atBats: 4, hits: 2, rbi: 1, homeRunsInGame: 1 },
        { playerId: "G-kikuchi", playerName: "菊池", battingOrder: 3, position: "二", atBats: 4, hits: 0, rbi: 0, homeRunsInGame: 0 },
      ],
    },
    "2026-08-27-hiroshima-yokohama": {
      hiroshima: [
        { playerId: "C-nogami", playerName: "野間", battingOrder: 1, position: "中", atBats: 4, hits: 1, rbi: 0, homeRunsInGame: 0 },
      ],
      yokohama: [
        { playerId: "D-makihara", playerName: "牧", battingOrder: 3, position: "二", atBats: 5, hits: 3, rbi: 4, homeRunsInGame: 2 },
        { playerId: "D-oosuga", playerName: "大田泰", battingOrder: 4, position: "右", atBats: 4, hits: 1, rbi: 0, homeRunsInGame: 0 },
        // 四球のみ・0打数のテストケース
        { playerId: "D-walker", playerName: "オースティン", battingOrder: 5, position: "一", atBats: 0, hits: 0, rbi: 0, homeRunsInGame: 0 },
      ],
    },
    "2026-08-27-chunichi-yakult": {
      chunichi: [
        { playerId: "C2-nakata", playerName: "中田", battingOrder: 4, position: "一", atBats: 4, hits: 2, rbi: 2, homeRunsInGame: 1 },
      ],
      yakult: [],
    },
    "2026-08-27-lotte-rakuten": {
      lotte: [
        { playerId: "M-nakamura", playerName: "中村奨", battingOrder: 3, position: "三", atBats: 2, hits: 1, rbi: 1, homeRunsInGame: 1 },
      ],
      rakuten: [
        { playerId: "E-asamura", playerName: "浅村", battingOrder: 3, position: "一", atBats: 2, hits: 1, rbi: 1, homeRunsInGame: 0 },
      ],
    },
    "2026-08-27-seibu-nipponham": {
      seibu: [{ playerId: "L-morimoto", playerName: "森本", battingOrder: 1, position: "中", atBats: 4, hits: 2, rbi: 1, homeRunsInGame: 0 }],
      nipponham: [{ playerId: "F-nishikawa", playerName: "西川遥", battingOrder: 2, position: "左", atBats: 4, hits: 1, rbi: 0, homeRunsInGame: 0 }],
    },
    "2026-08-01-hanshin-yomiuri": {
      hanshin: [
        { playerId: "T-konomoto", playerName: "近本", battingOrder: 1, position: "中", atBats: 5, hits: 2, rbi: 0, homeRunsInGame: 0 },
        { playerId: "T-morishita", playerName: "森下", battingOrder: 3, position: "右", atBats: 4, hits: 1, rbi: 1, homeRunsInGame: 0 },
        { playerId: "T-satoteru", playerName: "佐藤輝", battingOrder: 4, position: "三", atBats: 4, hits: 2, rbi: 2, homeRunsInGame: 1 },
      ],
      yomiuri: [{ playerId: "G-okamoto", playerName: "岡本", battingOrder: 3, position: "三", atBats: 4, hits: 1, rbi: 1, homeRunsInGame: 0 }],
    },
  };

  // ── 投手成績（GamePitchingStats[]） ──────────────────────────────────
  const pitchingByGame = {
    "2026-08-27-hanshin-yomiuri": {
      hanshin: [
        { playerId: "T-p-saiki", playerName: "才木", inningsPitched: "6.0", pitches: 98, hitsAllowed: 5, strikeouts: 7, walks: 2, runs: 2, earnedRuns: 2, decision: null, seasonEra: 2.31 },
        { playerId: "T-p-kirishiki", playerName: "桐敷", inningsPitched: "1.0", pitches: 14, hitsAllowed: 0, strikeouts: 1, walks: 0, runs: 0, earnedRuns: 0, decision: "H", seasonEra: 1.98 },
      ],
      yomiuri: [
        { playerId: "G-p-togo", playerName: "戸郷", inningsPitched: "5.2", pitches: 94, hitsAllowed: 7, strikeouts: 5, walks: 3, runs: 3, earnedRuns: 3, decision: "L", seasonEra: 2.88 },
        { playerId: "G-p-sub", playerName: "大江", inningsPitched: "1.1", pitches: 20, hitsAllowed: 1, strikeouts: 2, walks: 0, runs: 0, earnedRuns: 0, decision: null, seasonEra: 3.4 },
      ],
    },
    "2026-08-27-hiroshima-yokohama": {
      hiroshima: [{ playerId: "C-p-oono", playerName: "大野", inningsPitched: "5.0", pitches: 90, hitsAllowed: 8, strikeouts: 4, walks: 2, runs: 4, earnedRuns: 4, decision: "L", seasonEra: 3.55 }],
      yokohama: [{ playerId: "D-p-imamura", playerName: "今村", inningsPitched: "6.0", pitches: 88, hitsAllowed: 4, strikeouts: 6, walks: 1, runs: 1, earnedRuns: 1, decision: "W", seasonEra: 2.4 }],
    },
    "2026-08-27-chunichi-yakult": {
      chunichi: [{ playerId: "C2-p-kojima", playerName: "小島", inningsPitched: "7.0", pitches: 101, hitsAllowed: 6, strikeouts: 5, walks: 1, runs: 1, earnedRuns: 1, decision: "W", seasonEra: 2.55 }],
      yakult: [{ playerId: "S-p-oyama", playerName: "小山", inningsPitched: "6.0", pitches: 95, hitsAllowed: 8, strikeouts: 4, walks: 3, runs: 4, earnedRuns: 4, decision: "L", seasonEra: 3.9 }],
    },
    "2026-08-27-lotte-rakuten": {
      lotte: [{ playerId: "M-p-sasaki", playerName: "佐々木", inningsPitched: "3.0", pitches: 45, hitsAllowed: 3, strikeouts: 5, walks: 1, runs: 1, earnedRuns: 1, decision: null, seasonEra: 1.5 }],
      rakuten: [{ playerId: "E-p-hayato", playerName: "早川", inningsPitched: "3.0", pitches: 48, hitsAllowed: 3, strikeouts: 3, walks: 2, runs: 2, earnedRuns: 2, decision: null, seasonEra: 2.9 }],
    },
    "2026-08-27-seibu-nipponham": {
      seibu: [{ playerId: "L-p-takahashi", playerName: "高橋光", inningsPitched: "9.0", pitches: 112, hitsAllowed: 5, strikeouts: 8, walks: 1, runs: 1, earnedRuns: 1, decision: "W", seasonEra: 2.1 }],
      nipponham: [{ playerId: "F-p-ito", playerName: "伊藤", inningsPitched: "8.0", pitches: 108, hitsAllowed: 7, strikeouts: 6, walks: 2, runs: 2, earnedRuns: 2, decision: "L", seasonEra: 3.0 }],
    },
    "2026-08-01-hanshin-yomiuri": {
      hanshin: [{ playerId: "T-p-saiki", playerName: "才木", inningsPitched: "7.0", pitches: 102, hitsAllowed: 6, strikeouts: 8, walks: 1, runs: 1, earnedRuns: 1, decision: "W", seasonEra: 2.1 }],
      yomiuri: [{ playerId: "G-p-togo", playerName: "戸郷", inningsPitched: "6.0", pitches: 99, hitsAllowed: 8, strikeouts: 4, walks: 2, runs: 2, earnedRuns: 2, decision: "L", seasonEra: 2.7 }],
    },
  };

  // ── 試合一覧（日付ごと） ─────────────────────────────────────────────
  // ライブ試合は "poll" 回数に応じて段階的に状態が進むデモにするため、
  // stages 配列を持たせておき、MockProvider 側でポーリング回数に応じて選ぶ。
  const gamesByDate = {
    [TODAY_FIXTURE]: [
      {
        gameId: "2026-08-27-hanshin-yomiuri",
        date: TODAY_FIXTURE,
        awayTeamId: "yomiuri",
        awayTeamName: "巨人",
        homeTeamId: "hanshin",
        homeTeamName: "阪神",
        startTime: "18:00",
        stages: [
          { status: "scheduled", inning: null, awayScore: null, homeScore: null },
          { status: "live", inning: "4回表", awayScore: 1, homeScore: 1 },
          { status: "live", inning: "7回裏", awayScore: 2, homeScore: 3 },
          { status: "finished", inning: null, awayScore: 2, homeScore: 3 },
        ],
      },
      {
        gameId: "2026-08-27-hiroshima-yokohama",
        date: TODAY_FIXTURE,
        awayTeamId: "yokohama",
        awayTeamName: "DeNA",
        homeTeamId: "hiroshima",
        homeTeamName: "広島",
        startTime: "18:00",
        stages: [{ status: "finished", inning: null, awayScore: 4, homeScore: 1 }],
      },
      {
        gameId: "2026-08-27-chunichi-yakult",
        date: TODAY_FIXTURE,
        awayTeamId: "yakult",
        awayTeamName: "ヤクルト",
        homeTeamId: "chunichi",
        homeTeamName: "中日",
        startTime: "18:00",
        stages: [{ status: "finished", inning: null, awayScore: 1, homeScore: 4 }],
      },
      {
        gameId: "2026-08-27-lotte-rakuten",
        date: TODAY_FIXTURE,
        awayTeamId: "rakuten",
        awayTeamName: "楽天",
        homeTeamId: "lotte",
        homeTeamName: "ロッテ",
        startTime: "18:00",
        stages: [{ status: "live", inning: "3回表", awayScore: 1, homeScore: 2 }],
      },
      {
        gameId: "2026-08-27-seibu-nipponham",
        date: TODAY_FIXTURE,
        awayTeamId: "nipponham",
        awayTeamName: "日本ハム",
        homeTeamId: "seibu",
        homeTeamName: "西武",
        startTime: "18:00",
        stages: [{ status: "finished", inning: null, awayScore: 2, homeScore: 3 }],
      },
      {
        gameId: "2026-08-27-softbank-orix",
        date: TODAY_FIXTURE,
        awayTeamId: "orix",
        awayTeamName: "オリックス",
        homeTeamId: "softbank",
        homeTeamName: "ソフトバンク",
        startTime: "18:00",
        stages: [{ status: "scheduled", inning: null, awayScore: null, homeScore: null }],
      },
    ],
    [PAST_FIXTURE]: [
      {
        gameId: "2026-08-01-hanshin-yomiuri",
        date: PAST_FIXTURE,
        awayTeamId: "yomiuri",
        awayTeamName: "巨人",
        homeTeamId: "hanshin",
        homeTeamName: "阪神",
        startTime: "18:00",
        stages: [{ status: "finished", inning: null, awayScore: 1, homeScore: 5 }],
      },
    ],
  };

  // ── ライブ進行デモ用の途中経過（阪神−巨人のみ）。 ───────────────────────
  // 「試合中にHRが出た瞬間、白丸→黒丸に切り替わる」(section 13) を確認するため、
  // ステージごとの打撃成績スナップショットを用意する。他カードは常に最終値を使う。
  const battingStageOverrides = {
    "2026-08-27-hanshin-yomiuri": [
      { hanshin: [], yomiuri: [] }, // stage0: 試合前はまだ成績なし
      {
        // stage1: 4回表時点。森下・坂本はまだ本塁打なし。
        hanshin: [
          { playerId: "T-konomoto", playerName: "近本", battingOrder: 1, position: "中", atBats: 2, hits: 1, rbi: 0, homeRunsInGame: 0 },
          { playerId: "T-nakano", playerName: "中野", battingOrder: 2, position: "二", atBats: 2, hits: 0, rbi: 0, homeRunsInGame: 0 },
          { playerId: "T-morishita", playerName: "森下", battingOrder: 3, position: "右", atBats: 2, hits: 1, rbi: 1, homeRunsInGame: 0 },
          { playerId: "T-satoteru", playerName: "佐藤輝", battingOrder: 4, position: "三", atBats: 2, hits: 0, rbi: 0, homeRunsInGame: 0 },
        ],
        yomiuri: [
          { playerId: "G-okamoto", playerName: "岡本", battingOrder: 1, position: "三", atBats: 2, hits: 1, rbi: 0, homeRunsInGame: 0 },
          { playerId: "G-sakamoto", playerName: "坂本", battingOrder: 2, position: "遊", atBats: 2, hits: 1, rbi: 1, homeRunsInGame: 0 },
        ],
      },
      // stage2 以降は battingByGame の確定値（森下・坂本がHRを打った後の値）をそのまま使う
      null,
      null,
    ],
  };
  const pitchingStageOverrides = {
    "2026-08-27-hanshin-yomiuri": [
      { hanshin: [], yomiuri: [] },
      {
        hanshin: [{ playerId: "T-p-saiki", playerName: "才木", inningsPitched: "3.0", pitches: 48, hitsAllowed: 3, strikeouts: 3, walks: 1, runs: 1, earnedRuns: 1, decision: null, seasonEra: 2.31 }],
        yomiuri: [{ playerId: "G-p-togo", playerName: "戸郷", inningsPitched: "3.0", pitches: 50, hitsAllowed: 3, strikeouts: 2, walks: 1, runs: 1, earnedRuns: 1, decision: null, seasonEra: 2.88 }],
      },
      null,
      null,
    ],
  };

  global.NPB = global.NPB || {};
  global.NPB.sampleData = {
    TODAY_FIXTURE,
    PAST_FIXTURE,
    seasonSnapshots,
    battingByGame,
    pitchingByGame,
    gamesByDate,
    battingStageOverrides,
    pitchingStageOverrides,
  };
})(window);
