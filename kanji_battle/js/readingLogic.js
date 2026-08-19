// js/readingLogic.js
// よみかたモードの出題ロジック。DOM に一切触れない純粋関数群にしてあるので、
// test-reading.html から直接呼び出してテストできる。
// 配列シャッフルは js/game.js の shuffle() (元配列を破壊しない) を再利用する。

const READING_MAX_APPEARANCES = 3;   // 1プレイ内で同じ問題を出す最大回数
const READING_MIN_GAP = 2;           // 再出題までに最低はさむ他の問題数
const READING_BASE_SIZE = 10;        // 通常/新規枠の目安
const READING_SESSION_CAP = 15;      // 復習を含めた1プレイの総出題数の上限
const READING_WEAK_RATIO = 0.35;     // 通常モードで苦手問題に割り当てるおおよその比率

// grade/sourceTypeで絞り込み
function getEligibleQuestions(allQuestions, { grade = 'all', sourceType = 'all' } = {}) {
  return (allQuestions || []).filter(q =>
    (grade === 'all' || q.grade === grade) &&
    (sourceType === 'all' || q.sourceType === sourceType)
  );
}

// 苦手/通常に分割 (苦手度は問題ID単位。progressMap[q.id].isWeak を見る)
function partitionWeakNormal(questions, progressMap) {
  const pm = progressMap || {};
  const weak = [];
  const normal = [];
  questions.forEach(q => {
    const p = pm[q.id];
    if (p && p.isWeak) weak.push(q);
    else normal.push(q);
  });
  return { weak, normal };
}

// セッションで使う問題プールを組み立てる。
// practiceType: 'normal' | 'weakOnly'
// 戻り値: { pool: Question[], reason: null | 'no-weak' | 'no-questions' }
function buildSessionPool(allQuestions, { grade = 'all', sourceType = 'all', practiceType = 'normal' } = {}, progressMap = {}, opts = {}) {
  const baseSize = opts.baseSize ?? READING_BASE_SIZE;
  const weakRatio = opts.weakRatio ?? READING_WEAK_RATIO;

  const eligible = getEligibleQuestions(allQuestions, { grade, sourceType });
  const { weak, normal } = partitionWeakNormal(eligible, progressMap);

  if (practiceType === 'weakOnly') {
    if (weak.length === 0) return { pool: [], reason: 'no-weak' };
    return { pool: shuffle(weak).slice(0, baseSize), reason: null };
  }

  if (eligible.length === 0) return { pool: [], reason: 'no-questions' };

  const targetWeak = Math.min(weak.length, Math.round(baseSize * weakRatio));
  const weakPicks = shuffle(weak).slice(0, targetWeak);
  const remaining = Math.max(0, baseSize - weakPicks.length);
  const normalPicks = shuffle(normal).slice(0, remaining);

  let combined = [...weakPicks, ...normalPicks];
  if (combined.length < baseSize) {
    const usedIds = new Set(combined.map(q => q.id));
    const leftovers = shuffle([...weak, ...normal].filter(q => !usedIds.has(q.id)));
    combined = combined.concat(leftovers.slice(0, baseSize - combined.length));
  }

  return { pool: shuffle(combined), reason: combined.length === 0 ? 'no-questions' : null };
}

// セッションの可変状態を作る
function createSessionState(pool, opts = {}) {
  const cap = opts.cap ?? READING_SESSION_CAP;
  return {
    queue: pool.map(q => q.id),
    poolSize: pool.length,
    questionsById: Object.fromEntries(pool.map(q => [q.id, q])),
    appearanceCount: {},
    firstMissThisSession: new Set(),
    reLearnedThisSession: new Set(),
    seenThisSession: new Set(),
    capturedThisSession: new Set(),
    evolvedThisSession: new Set(),
    pendingReveals: [],
    correctCount: 0,
    totalAsked: 0,
    correctStreak: 0,
    cap,
    lastQuestionId: null,
  };
}

// 次に出す問題IDを取り出す。もう出す問題がなければnull。
function getNextQuestionId(state) {
  if (state.totalAsked >= state.cap) return null;
  if (state.queue.length === 0) return null;
  return state.queue.shift();
}

// 再出題キューへの挿入。直後(位置0)には絶対に置かない。
function insertRequeue(state, questionId) {
  if (state.queue.length === 0) {
    state.queue.push(questionId);
    return;
  }
  let pos = Math.min(state.queue.length, READING_MIN_GAP);
  if (pos === 0) pos = 1;
  // 挿入位置がたまたま同じ問題と隣接してしまう場合は1つ後ろにずらす
  while (pos < state.queue.length && state.queue[pos] === questionId) pos++;
  state.queue.splice(Math.min(pos, state.queue.length), 0, questionId);
}

// 解答結果を記録し、必要なら再出題キューへ入れる。
// 戻り値: { isFirstAttemptThisSession, wasPreviouslyWrong, correctStreak }
// wasPreviouslyWrong/correctStreakは応援キャラクターのイベント判定
// (resolveSupportEvent、js/supporterSelector.js)にそのまま渡せる。
function recordAnswer(state, questionId, correct) {
  state.totalAsked++;
  state.appearanceCount[questionId] = (state.appearanceCount[questionId] || 0) + 1;
  const isFirstAttemptThisSession = !state.seenThisSession.has(questionId);
  state.seenThisSession.add(questionId);
  state.lastQuestionId = questionId;

  const wasMissedBefore = state.firstMissThisSession.has(questionId);

  if (correct) {
    state.correctCount++;
    state.correctStreak = (state.correctStreak || 0) + 1;
    if (wasMissedBefore && !state.reLearnedThisSession.has(questionId)) {
      state.reLearnedThisSession.add(questionId);
    }
  } else {
    state.correctStreak = 0;
    state.firstMissThisSession.add(questionId);
    const canRequeue =
      state.poolSize >= 2 &&
      (state.appearanceCount[questionId] || 0) < READING_MAX_APPEARANCES &&
      state.totalAsked < state.cap - 1;
    if (canRequeue) insertRequeue(state, questionId);
  }

  return {
    isFirstAttemptThisSession,
    wasPreviouslyWrong: wasMissedBefore,
    correctStreak: state.correctStreak,
  };
}

// 選択肢リストを作る。id/textを分離し、判定はidで行う想定。
// 最大4択(正解+distractor3件)。有効なdistractorが少なければ2〜3択に縮退。
function buildChoiceList(question) {
  const correctText = question.targetReading;
  const rawDistractors = Array.isArray(question.distractors) ? question.distractors : [];
  const cleanDistractors = Array.from(new Set(
    rawDistractors.filter(d => typeof d === 'string' && d.trim() !== '' && d !== correctText)
  ));
  const usedDistractors = shuffle(cleanDistractors).slice(0, 3);

  const choices = [
    { id: 'correct', text: correctText, correct: true },
    ...usedDistractors.map((text, i) => ({ id: `d${i}`, text, correct: false })),
  ];
  return shuffle(choices);
}

// かんじをえらぶモード用の選択肢リストを作る(buildChoiceListの漢字版)。
// question.kanjiDistractors(誤答の漢字)を使う。判定は表示文字列ではなくidで行う。
function buildKanjiChoiceList(question) {
  const correctText = question.targetKanji;
  const rawDistractors = Array.isArray(question.kanjiDistractors) ? question.kanjiDistractors : [];
  const cleanDistractors = Array.from(new Set(
    rawDistractors.filter(d => typeof d === 'string' && d.trim() !== '' && d !== correctText)
  ));
  const usedDistractors = shuffle(cleanDistractors).slice(0, 3);

  const choices = [
    { id: 'correct', text: correctText, correct: true },
    ...usedDistractors.map((text, i) => ({ id: `d${i}`, text, correct: false })),
  ];
  return shuffle(choices);
}

// セッション終了時の集計
function summarizeSession(state) {
  const stillWeakIds = Array.from(state.seenThisSession).filter(id => {
    const q = state.questionsById[id];
    return q; // isWeak判定は呼び出し側でReadingStorageの最新値を見て絞り込む
  });
  return {
    correctCount: state.correctCount,
    totalAsked: state.totalAsked,
    reLearnedCount: state.reLearnedThisSession.size,
    stillWeakIds,
  };
}
