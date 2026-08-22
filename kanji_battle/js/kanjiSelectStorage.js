// js/kanjiSelectStorage.js - かんじをえらぶモード専用 LocalStorage 管理
// js/storage.js ('kanjiBattle_v1') / js/readingStorage.js ('kanjiBattle_reading_v1')
// とは別の名前空間(キー)を使う。既存キーには一切触れない (追加のみ・非破壊)。
// よみかたモードの成績と完全に分離するため(「空→そら」の正解が
// 「そら→空」の正解済みを意味してはいけない)、readingStorage.js とは
// 別モジュール・別キーとして実装している。load/save の形は readingStorage.js
// と揃えている。

const KanjiSelectStorage = (() => {
  const BASE_KEY = 'kanjiBattle_kanjiSelect_v1';

  // プロフィールごとにデータを分離する。Profilesが未読み込みの環境
  // (テストハーネス等)では、従来どおり素のキーにフォールバックする。
  function currentKey() {
    if (typeof Profiles !== 'undefined' && Profiles.keyFor) {
      return Profiles.keyFor(BASE_KEY);
    }
    return BASE_KEY;
  }

  function defaultData() {
    return {
      version: 1,
      selectedSourceType: 'all',    // 'all' | 'textbook' | 'general'
      selectedPracticeType: 'normal', // 'normal' | 'weakOnly'
      progress: {},                 // { questionId: {attempts,correct,wrong,correctStreak,isWeak,lastAnsweredAt} }
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(currentKey());
      if (!raw) return defaultData();
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return defaultData();
      const d = defaultData();
      return {
        version: typeof parsed.version === 'number' ? parsed.version : d.version,
        selectedSourceType: parsed.selectedSourceType || d.selectedSourceType,
        selectedPracticeType: parsed.selectedPracticeType || d.selectedPracticeType,
        progress: (parsed.progress && typeof parsed.progress === 'object') ? parsed.progress : {},
      };
    } catch (e) {
      console.warn('[KanjiSelectStorage] 保存データの読み込みに失敗したため、かんじをえらぶの記録のみ初期化します', e);
      return defaultData();
    }
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

    getSelectedSourceType() { return load().selectedSourceType || 'all'; },
    setSelectedSourceType(type) {
      const d = load();
      d.selectedSourceType = type;
      save(d);
    },

    getSelectedPracticeType() { return load().selectedPracticeType || 'normal'; },
    setSelectedPracticeType(type) {
      const d = load();
      d.selectedPracticeType = type;
      save(d);
    },

    getProgress(questionId) {
      const d = load();
      return d.progress[questionId] || null;
    },

    getAllProgress() {
      return load().progress;
    },

    recordFirstAttemptOfSession(questionId, correct, nowIso) {
      const d = load();
      const p = d.progress[questionId] || {
        attempts: 0, correct: 0, wrong: 0, correctStreak: 0, isWeak: false, lastAnsweredAt: null,
      };
      p.attempts++;
      p.lastAnsweredAt = nowIso || new Date().toISOString();
      if (correct) {
        p.correct++;
        p.correctStreak = (p.correctStreak || 0) + 1;
        if (p.correctStreak >= 3) p.isWeak = false;
      } else {
        p.wrong++;
        p.correctStreak = 0;
        p.isWeak = true;
      }
      d.progress[questionId] = p;
      save(d);
      return p;
    },

    // かんじをえらぶの記録のみリセット(選択状態は保持)
    resetKanjiSelectProgress() {
      const d = load();
      d.progress = {};
      save(d);
    },
  };
})();
