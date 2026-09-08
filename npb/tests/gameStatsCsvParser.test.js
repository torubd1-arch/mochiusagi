/**
 * gameStatsCsvParser の最低限の検証。
 * 実行: node tests/gameStatsCsvParser.test.js
 *
 * fixtures/npb-game-2021039367.csv は、実データ(2026-09-06 ヤクルト対阪神)
 * から該当試合の28行だけを抜き出したもの。
 */
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const parser = require("../src/parsers/npb/gameStatsCsvParser.js");

const csvText = fs.readFileSync(path.join(__dirname, "fixtures/npb-game-2021039367.csv"), "utf8");
const rows = parser.parseCsv(csvText);

assert.strictEqual(rows.length, 28, "fixtureは28行のはず");

const game = parser.buildGame("2021039367", rows);

// 1. 両チームが取得できる
assert.strictEqual(game.meta.awayTeamName, "東京ヤクルトスワローズ");
assert.strictEqual(game.meta.homeTeamName, "阪神タイガース");
assert.strictEqual(game.meta.awayScore, 5, "ヤクルトの得点(batting_R合計)");
assert.strictEqual(game.meta.homeScore, 3, "阪神の得点(batting_R合計)");

// 2. 打者名が取得できる、打数・安打・打点が正しい
const hanshinBatters = game.batting["5"];
const satoteru = hanshinBatters.find((b) => b.playerName === "佐藤 輝明");
assert.ok(satoteru, "佐藤輝明が阪神の打者リストにいる");
assert.strictEqual(satoteru.atBats, 4);
assert.strictEqual(satoteru.hits, 1);
assert.strictEqual(satoteru.rbi, 1);

// 3. HR打者が正しく判定できる(この試合でHRを打ったのは佐藤輝明のみ)
const hrHitters = hanshinBatters.filter((b) => b.homeRunsInGame > 0).map((b) => b.playerName);
assert.deepStrictEqual(hrHitters, ["佐藤 輝明"]);
const nonHrHitters = hanshinBatters.filter((b) => b.playerName !== "佐藤 輝明");
nonHrHitters.forEach((b) => assert.strictEqual(b.homeRunsInGame, 0, `${b.playerName} はHRなしのはず`));

// 4. 投手成績が取得できる(ヤクルトの先発 山野太一: 7回2安打2失点9奪三振)
const yakultPitchers = game.pitching["2"];
const yamano = yakultPitchers.find((p) => p.playerName === "山野 太一");
assert.ok(yamano, "山野太一がヤクルトの投手リストにいる");
assert.strictEqual(yamano.inningsPitched, "7.0");
assert.strictEqual(yamano.hitsAllowed, 2);
assert.strictEqual(yamano.runs, 2);
assert.strictEqual(yamano.earnedRuns, 2);
assert.strictEqual(yamano.strikeouts, 9);
assert.strictEqual(yamano.walks, 1);
assert.strictEqual(yamano.seasonEra, 2.13);

// 5. 打順は取得不可のためnull(既存UIは代打相当＝空欄で表示する)
assert.strictEqual(satoteru.battingOrder, null);

console.log("OK: gameStatsCsvParser 全", 12, "件のアサーションに合格");
