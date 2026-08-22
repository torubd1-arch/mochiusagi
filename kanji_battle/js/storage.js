// js/storage.js - LocalStorage 管理

const Storage = (() => {
  const BASE_KEY = 'kanjiBattle_v1';

  // プロフィールごとにデータを分離する。Profilesが未読み込みの環境
  // (テストハーネス等)では、従来どおり素のキーにフォールバックする。
  function currentKey() {
    if (typeof Profiles !== 'undefined' && Profiles.keyFor) {
      return Profiles.keyFor(BASE_KEY);
    }
    return BASE_KEY;
  }

  function load() {
    try {
      const raw = localStorage.getItem(currentKey());
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
      selectedGradeMode: 'all',
      playCountSinceBoss: 0,
      bossBattleSeenCount: 0,
      capturedBosses: {},
      completedEvolutionChains: {},
      seenEvolutionCompleteEffects: {},
    };
  }

  function save(data) {
    try {
      localStorage.setItem(currentKey(), JSON.stringify(data));
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
      data.playCountSinceBoss = (data.playCountSinceBoss || 0) + 1;
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
      Object.assign(data, {
        cleared: {},
        stars: {},
        evolutions: {},
        mistakes: {},
        xp: 0,
        capturedBosses: {},
        completedEvolutionChains: {},
        seenEvolutionCompleteEffects: {},
      });
      save(data);
    },

    // 全データリセット
    resetAll() {
      localStorage.removeItem(currentKey());
    },

    // 学年モード取得/設定
    getGradeMode() { return this.getData().selectedGradeMode ?? 'all'; },
    setGradeMode(mode) {
      const d = this.getData(); d.selectedGradeMode = mode;
      save(d);
    },

    // ボス出現判定 (4〜6回に1回)
    shouldSpawnBoss() {
      const d = this.getData();
      const threshold = 4 + Math.floor(Math.random() * 3);
      return (d.playCountSinceBoss || 0) >= threshold;
    },

    // ボスカウンターリセット
    resetBossCounter() {
      const d = this.getData();
      d.playCountSinceBoss = 0;
      d.bossBattleSeenCount = (d.bossBattleSeenCount || 0) + 1;
      save(d);
    },

    // ボスキャプチャ登録/確認
    registerCapturedBoss(bossId) {
      const d = this.getData();
      if (!d.capturedBosses) d.capturedBosses = {};
      d.capturedBosses[bossId] = true;
      save(d);
    },
    isBossCaptured(bossId) { return !!(this.getData().capturedBosses || {})[bossId]; },

    // 進化チェーン完了フラグ
    isChainComplete(chainId)     { return !!(this.getData().completedEvolutionChains || {})[chainId]; },
    markChainComplete(chainId)   {
      const d = this.getData();
      if (!d.completedEvolutionChains) d.completedEvolutionChains = {};
      d.completedEvolutionChains[chainId] = true;
      save(d);
    },
    hasSeenChainEffect(chainId)  { return !!(this.getData().seenEvolutionCompleteEffects || {})[chainId]; },
    markChainEffectSeen(chainId) {
      const d = this.getData();
      if (!d.seenEvolutionCompleteEffects) d.seenEvolutionCompleteEffects = {};
      d.seenEvolutionCompleteEffects[chainId] = true;
      save(d);
    },
  };
})();
