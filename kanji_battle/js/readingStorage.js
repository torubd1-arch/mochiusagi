// js/readingStorage.js - よみかたモード専用 LocalStorage 管理
// js/storage.js とは別の名前空間(キー)を使う。既存の 'kanjiBattle_v1' には
// 一切触れない (追加のみ・非破壊)。load/save の try-catch パターンは
// storage.js を踏襲している。

const ReadingStorage = (() => {
  const BASE_KEY = 'kanjiBattle_reading_v1';

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
      // 個別フィールドの欠落を防御的に補完(壊れた/古い保存形式でも落ちない)
      const d = defaultData();
      return {
        version: typeof parsed.version === 'number' ? parsed.version : d.version,
        selectedSourceType: parsed.selectedSourceType || d.selectedSourceType,
        selectedPracticeType: parsed.selectedPracticeType || d.selectedPracticeType,
        progress: (parsed.progress && typeof parsed.progress === 'object') ? parsed.progress : {},
      };
    } catch (e) {
      console.warn('[ReadingStorage] 保存データの読み込みに失敗したため、よみかたの記録のみ初期化します', e);
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

    // 指定問題の成績取得 (未記録ならnull)
    getProgress(questionId) {
      const d = load();
      return d.progress[questionId] || null;
    },

    // 全問題の成績マップ取得
    getAllProgress() {
      return load().progress;
    },

    // セッション内でのその問題の「最初の1回目」の解答結果だけを反映する。
    // 同一セッション内の再出題での正誤はここでは呼ばない(呼び出し側で制御)。
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

    // よみかたの記録のみリセット(選択状態は保持)
    resetReadingProgress() {
      const d = load();
      d.progress = {};
      save(d);
    },
  };
})();
