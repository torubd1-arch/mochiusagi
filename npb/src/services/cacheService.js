/**
 * localStorage ベースの簡易キャッシュ。
 *
 * サーバーを持たないローカルWebアプリなので、仕様書の cache/games/*.json,
 * cache/season/*.json に相当する役割を localStorage に持たせる。
 * 「試合終了済みの過去データは基本的に再取得不要」「当日の試合中は一定時間ごとに更新」
 * という方針(section 32)を、日付＋ステータスから決まる TTL として実装する。
 */
(function (global) {
  "use strict";

  const PREFIX = "npb-viewer:v1:";

  function keyFor(kind, date) {
    return `${PREFIX}${kind}:${date}`;
  }

  function read(kind, date) {
    try {
      const raw = localStorage.getItem(keyFor(kind, date));
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed.savedAt !== "number") return null;
      return parsed;
    } catch (e) {
      return null;
    }
  }

  function write(kind, date, payload) {
    try {
      localStorage.setItem(keyFor(kind, date), JSON.stringify({ savedAt: Date.now(), payload }));
    } catch (e) {
      // 容量オーバーやプライベートモード等は無視して素通しする(必須機能ではない)
    }
  }

  /** 今このキャッシュを使ってよいか。expired なら false。 */
  function isFresh(entry, ttlMs) {
    if (!entry) return false;
    return Date.now() - entry.savedAt < ttlMs;
  }

  /**
   * 試合群の状態から、次回取得までの推奨間隔(ms)を決める。
   * 試合中: 45秒 / 試合前: 10分 / 全試合終了: 30分(実質ほぼ再取得不要)
   */
  function nextPollIntervalMs(games) {
    if (!games || games.length === 0) return 10 * 60 * 1000;
    if (games.some((g) => g.status === "live")) return 45 * 1000;
    if (games.some((g) => g.status === "scheduled")) return 10 * 60 * 1000;
    return 30 * 60 * 1000;
  }

  global.NPB = global.NPB || {};
  global.NPB.cacheService = { read, write, isFresh, nextPollIntervalMs };
})(window);
