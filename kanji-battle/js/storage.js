// js/storage.js - LocalStorage 管理

const Storage = (() => {
  const KEY = 'kanjiBattle_v1';

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return defaultData();
      return JSON.parse(raw);
    } catch (e) {
      return defaultData();
    }
  }

  function defaultData() {
    return {
      cleared: {},       // { '木': true, ... }
      stars: {},         // { '木': 3, ... }
      evolutions: {},    // { 'tree': true, ... }
      mistakes: {},      // { '木': 3, ... } ← ミス累計 (弱点復習用)
      xp: 0,            // 総獲得XP (初クリア1字 = 10XP)
      totalPlays: 0,
      lastPlayed: null,
    };
  }

  function save(data) {
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch (e) {}
  }

  return {
    getData() {
      return load();
    },

    // 漢字クリア時に保存
    saveResult(char, stars) {
      const data = load();
      const isNew = !data.cleared[char];
      data.cleared[char] = true;
      // 最高スター数を保持
      if (!data.stars[char] || data.stars[char] < stars) {
        data.stars[char] = stars;
      }
      // 初クリア時のみ XP +10
      if (isNew) data.xp = (data.xp || 0) + 10;
      save(data);
    },

    // プレイ回数を増やす
    incrementPlay() {
      const data = load();
      data.totalPlays = (data.totalPlays || 0) + 1;
      data.lastPlayed = new Date().toISOString().slice(0, 10);
      save(data);
    },

    // 指定漢字のスター数取得 (0=未クリア)
    getStars(char) {
      const data = load();
      return data.stars[char] || 0;
    },

    // クリア済みかどうか
    isCleared(char) {
      const data = load();
      return !!data.cleared[char];
    },

    // 進化チェーンを解放済みとして保存
    saveEvolution(id) {
      const data = load();
      if (!data.evolutions) data.evolutions = {};
      data.evolutions[id] = true;
      save(data);
    },

    // 進化チェーンが解放済みか
    isEvolutionUnlocked(id) {
      const data = load();
      return !!(data.evolutions && data.evolutions[id]);
    },

    // ミスカウント +1
    recordMistake(char) {
      const data = load();
      if (!data.mistakes) data.mistakes = {};
      data.mistakes[char] = (data.mistakes[char] || 0) + 1;
      save(data);
    },

    // 完全正解クリア時にミスカウント -1 (min 0)
    recordConsecutiveCorrect(char) {
      const data = load();
      if (!data.mistakes) data.mistakes = {};
      if ((data.mistakes[char] || 0) > 0) data.mistakes[char]--;
      save(data);
    },

    // 指定漢字のミスカウント取得
    getMistakeCount(char) {
      const data = load();
      return (data.mistakes && data.mistakes[char]) || 0;
    },

    // 苦手漢字リスト (mistakeCount降順, 上位limit件, count>0のみ)
    getWeakKanji(limit = 10) {
      const data = load();
      const m = data.mistakes || {};
      return Object.entries(m)
        .filter(([, c]) => c > 0)
        .sort(([, a], [, b]) => b - a)
        .slice(0, limit)
        .map(([char, count]) => ({ char, count }));
    },

    // XP取得
    getXP() { return load().xp || 0; },

    // レベル (100XP = 1レベル、LV1スタート)
    getLevel() {
      return Math.floor((load().xp || 0) / 100) + 1;
    },

    // 現レベル内のXP進捗 (0〜99)
    getXPInLevel() {
      return (load().xp || 0) % 100;
    },

    // 図鑑・進化チェーンのみリセット (プレイ回数・設定は保持)
    resetCollection() {
      const data = load();
      data.cleared    = {};
      data.stars      = {};
      data.evolutions = {};
      data.mistakes   = {};
      data.xp         = 0;
      save(data);
    },

    // 全データリセット
    resetAll() {
      localStorage.removeItem(KEY);
    }
  };
})();
