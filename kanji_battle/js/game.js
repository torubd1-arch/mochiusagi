// js/game.js - ゲームロジック・クイズ管理

// ユーティリティ: 配列シャッフル
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ほめコメント
const PRAISE = ['すごい！', 'てんさい！', 'いいね！', 'そのちょうし！', 'かんぺき！', 'やるじゃん！', 'さいこう！'];
function randomPraise() {
  return PRAISE[Math.floor(Math.random() * PRAISE.length)];
}

// ----------------------------
// ゲーム状態
// ----------------------------
const Game = (() => {
  let state = null;

  // クイズ選択肢生成 (画数)
  function makeStrokeCountChoices(kanji) {
    const correct = kanji.strokeCount;
    const pool = [];
    for (let d = -3; d <= 3; d++) {
      const n = correct + d;
      if (n > 0 && n !== correct) pool.push(n);
    }
    const wrongs = shuffle(pool).slice(0, 2);
    return shuffle([correct, ...wrongs]);
  }

  // クイズ選択肢生成 (書き順) — 同じ漢字のstrokeオブジェクトだけから生成
  function makeStrokeOrderChoices(strokes, currentIndex) {
    const correct = strokes[currentIndex];
    const others = strokes.filter((_, i) => i !== currentIndex);
    // 字の画数に合わせて選択肢数を決定 (最大4)
    const maxChoices = Math.min(strokes.length, 4);
    const distractors = shuffle(others).slice(0, maxChoices - 1);
    return shuffle([correct, ...distractors]);
  }

  // 現在の漢字データ
  function curKanji() {
    return state.kanjiList[state.kanjiIndex];
  }

  // 敵HPを計算 (画数クイズ1問 + 各ストローク)
  function calcMaxHP(kanji) {
    return 1 + kanji.strokeCount;
  }

  return {
    getState() { return state; },

    // バトルモード開始
    startBattle(kanjiList) {
      state = {
        mode: 'battle',
        kanjiList,           // 今回の漢字リスト
        kanjiIndex: 0,       // 現在の漢字番号
        phase: 'strokeCount', // 'strokeCount' | 'strokeOrder' | 'cleared'
        strokeIndex: 0,      // 現在の書き順ステップ (0始まり)
        mistakes: 0,         // 現在の漢字での間違い数
        totalMistakes: 0,    // セッション全体
        totalCorrect: 0,
        kanjiResults: [],    // [{char, stars, mistakes}]
        enemyHP: 0,
        enemyMaxHP: 0,
      };
      const k = curKanji();
      state.enemyHP = calcMaxHP(k);
      state.enemyMaxHP = state.enemyHP;
      Storage.incrementPlay();
    },

    // 現在の漢字
    currentKanji() {
      return state ? curKanji() : null;
    },

    // 現在フェーズの選択肢を返す
    getChoices() {
      if (!state) return [];
      const k = curKanji();
      if (state.phase === 'strokeCount') {
        return makeStrokeCountChoices(k);
      } else {
        return makeStrokeOrderChoices(k.strokes, state.strokeIndex);
      }
    },

    // 正解値を返す
    getCorrectAnswer() {
      if (!state) return null;
      const k = curKanji();
      if (state.phase === 'strokeCount') return k.strokeCount;
      return k.strokes[state.strokeIndex].id; // labelではなくidで正解判定
    },

    // 回答を処理 → {correct, praise, damage, cleared, kanjiCleared}
    answer(value) {
      if (!state) return null;
      const correct = this.getCorrectAnswer();
      const isCorrect = (String(value) === String(correct));

      let result = {
        correct: isCorrect,
        correctValue: correct,
        praise: '',
        damage: 0,
        kanjiCleared: false,
        sessionDone: false,
      };

      if (isCorrect) {
        state.totalCorrect++;
        state.enemyHP = Math.max(0, state.enemyHP - 1);
        result.damage = 1;
        result.praise = randomPraise();

        if (state.phase === 'strokeCount') {
          // 画数クイズ→書き順へ
          state.phase = 'strokeOrder';
          state.strokeIndex = 0;
        } else {
          // 書き順を進める
          state.strokeIndex++;
          if (state.strokeIndex >= curKanji().strokeCount) {
            // この漢字をクリア
            const stars = state.mistakes === 0 ? 3 : state.mistakes === 1 ? 2 : 1;
            state.kanjiResults.push({
              char: curKanji().char,
              stars,
              mistakes: state.mistakes,
            });
            result.isNewCapture = !Storage.isCleared(curKanji().char);
            const prevLevel = Storage.getLevel();
            Storage.saveResult(curKanji().char, stars);
            const newLevel = Storage.getLevel();
            result.leveledUp = newLevel > prevLevel;
            result.newLevel  = newLevel;
            // 完全正解クリア (ミスなし) → 苦手カウント -1
            if (state.mistakes === 0) Storage.recordConsecutiveCorrect(curKanji().char);
            result.kanjiCleared = true;
            result.stars = stars;

            // 次の漢字へ
            state.kanjiIndex++;
            if (state.kanjiIndex >= state.kanjiList.length) {
              result.sessionDone = true;
              state.mode = 'result';
            } else {
              const nk = curKanji();
              state.phase = 'strokeCount';
              state.strokeIndex = 0;
              state.mistakes = 0;
              state.enemyHP = calcMaxHP(nk);
              state.enemyMaxHP = state.enemyHP;
            }
          }
        }
      } else {
        state.mistakes++;
        state.totalMistakes++;
        Storage.recordMistake(curKanji().char); // 苦手カウント +1
      }

      return result;
    },

    // 現在の書き順ステップ番号 (1始まり表示用)
    currentStrokeDisplayIndex() {
      return state ? state.strokeIndex + 1 : 0;
    },

    // 問題文テキストを返す
    getQuestionText() {
      if (!state) return '';
      if (state.phase === 'strokeCount') {
        return `「${curKanji().char}」は なんかく？`;
      }
      return `${state.strokeIndex + 1}かくめは どれかな？`;
    },

    // 進捗テキスト (書き順フェーズ用)
    getProgressText() {
      if (!state || state.phase !== 'strokeOrder') return '';
      return `${state.strokeIndex + 1} / ${curKanji().strokeCount} かく`;
    },

    // 敵HPバーの割合
    hpRatio() {
      if (!state || state.enemyMaxHP === 0) return 1;
      return state.enemyHP / state.enemyMaxHP;
    },

    // セッション結果取得
    getResults() {
      return state ? state.kanjiResults : [];
    },

    // 完了済み漢字インデックス (れんしゅう・ずかん用)
    getCompletedCount() {
      return state ? state.kanjiIndex : 0;
    }
  };
})();
