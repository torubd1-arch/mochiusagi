// js/kanjiSelectMode.js - かんじをえらぶモード UI制御
// よみかたモード(js/readingMode.js)と対になるモード:よみがなを見て、
// 正しい漢字を選択肢から選ぶ。セッション状態管理・再出題・苦手判定は
// js/readingLogic.js の共通関数(buildSessionPool/createSessionState/
// getNextQuestionId/recordAnswer/summarizeSession)をそのまま再利用し、
// モンスター取得・進化・レベルアップの判定と演出再生は js/learningRewards.js
// (queueLearningReward/playPendingReveals)をよみかたモードと共有する。
// 成績は KanjiSelectStorage (kanjiBattle_kanjiSelect_v1) に、よみかたモードの
// 成績(kanjiBattle_reading_v1)とは完全に別のキーで保存する
// (「空→そら」の正解が「そら→空」の正解済みを意味してはいけないため)。

let kanjiSelectSession = null;
let kanjiSelectAnswerLocked = false;
let kanjiSelectCancelled = true; // 質問画面が表示されていない間は true

// おうえんキャラクターの抽選状態(重複防止用)。よみかたモードとは独立させる。
const kanjiSelectSupporterState = createSupporterState();

// ========== セットアップ画面 ==========
function showKanjiSelectSetup() {
  kanjiSelectCancelled = true;
  renderKanjiSelectSetupBody();
  clearKanjiSelectSetupMessage();
  showScreen('screen-kanjiselect-setup');
}

function kanjiSelectCountForSourceType(grade, sourceType) {
  return getEligibleQuestions(KANJI_SELECT_QUESTIONS, { grade, sourceType }).length;
}

function renderKanjiSelectSetupBody() {
  const body = document.getElementById('kanjiselect-setup-body');
  if (!body) return;
  body.innerHTML = '';

  const grade = KanjiSelectStorage.getSelectedGrade();
  let sourceType = KanjiSelectStorage.getSelectedSourceType();
  const practiceType = KanjiSelectStorage.getSelectedPracticeType();

  if (sourceType !== 'all' && kanjiSelectCountForSourceType(grade, sourceType) === 0) {
    sourceType = 'all';
    KanjiSelectStorage.setSelectedSourceType('all');
  }

  // --- 学年 ---
  const gradeLabel = document.createElement('div');
  gradeLabel.className = 'yomi-setup-label';
  gradeLabel.textContent = 'がくねん';
  body.appendChild(gradeLabel);

  const gradeBar = document.createElement('div');
  gradeBar.className = 'grade-tab-bar';
  [['all', 'ぜんぶ'], [1, '1ねん'], [2, '2ねん'], [3, '3ねん'], [4, '4ねん'], [5, '5ねん'], [6, '6ねん']].forEach(([val, label]) => {
    const tab = document.createElement('button');
    tab.className = 'grade-tab' + (grade === val ? ' active' : '');
    tab.textContent = label;
    tab.addEventListener('click', () => {
      KanjiSelectStorage.setSelectedGrade(val);
      renderKanjiSelectSetupBody();
    });
    gradeBar.appendChild(tab);
  });
  body.appendChild(gradeBar);

  // --- 問題の種類 ---
  const typeLabel = document.createElement('div');
  typeLabel.className = 'yomi-setup-label';
  typeLabel.textContent = 'もんだいの しゅるい';
  body.appendChild(typeLabel);

  const typeBar = document.createElement('div');
  typeBar.className = 'grade-tab-bar';
  [['all', 'すべて'], ['textbook', 'きょうかしょ'], ['general', 'いろいろ']].forEach(([val, label]) => {
    const count = kanjiSelectCountForSourceType(grade, val);
    const disabled = count === 0;
    const tab = document.createElement('button');
    tab.className = 'grade-tab' + (sourceType === val ? ' active' : '') + (disabled ? ' disabled' : '');
    tab.textContent = disabled ? `${label}（まだ ないよ）` : label;
    if (disabled) {
      tab.disabled = true;
    } else {
      tab.addEventListener('click', () => {
        KanjiSelectStorage.setSelectedSourceType(val);
        renderKanjiSelectSetupBody();
      });
    }
    typeBar.appendChild(tab);
  });
  body.appendChild(typeBar);

  // --- 練習方法 ---
  const practiceLabel = document.createElement('div');
  practiceLabel.className = 'yomi-setup-label';
  practiceLabel.textContent = 'れんしゅうほうほう';
  body.appendChild(practiceLabel);

  const practiceBar = document.createElement('div');
  practiceBar.className = 'grade-tab-bar';
  [['normal', 'ふつう'], ['weakOnly', 'にがてだけ']].forEach(([val, label]) => {
    const tab = document.createElement('button');
    tab.className = 'grade-tab' + (practiceType === val ? ' active' : '');
    tab.textContent = label;
    tab.addEventListener('click', () => {
      KanjiSelectStorage.setSelectedPracticeType(val);
      renderKanjiSelectSetupBody();
    });
    practiceBar.appendChild(tab);
  });
  body.appendChild(practiceBar);

  // --- メッセージ領域 ---
  const message = document.createElement('div');
  message.id = 'kanjiselect-setup-message';
  message.className = 'yomi-setup-message';
  body.appendChild(message);

  // --- はじめるボタン ---
  const startBtn = document.createElement('button');
  startBtn.className = 'btn-title yomi-start-btn';
  startBtn.id = 'btn-kanjiselect-start';
  startBtn.textContent = '▶ はじめる';
  startBtn.addEventListener('click', () => {
    Audio.playSelect();
    startKanjiSelectSession();
  });
  body.appendChild(startBtn);

  // --- かんじをえらぶの きろくを リセット ---
  const resetSection = document.createElement('div');
  resetSection.className = 'zukan-reset-section';
  const resetBtn = document.createElement('button');
  resetBtn.className = 'btn-zukan-reset';
  resetBtn.textContent = 'かんじをえらぶの きろくを リセット';
  resetBtn.addEventListener('click', () => {
    showResetDialog({
      title: 'かんじをえらぶ リセット',
      body: 'ほんとうに かんじをえらぶの<br>きろくを リセットする？',
      warnText: 'にがてもんだいの きろくが<br>きえるよ（かきじゅん・よみかた・ずかんは きえません）',
      onConfirm: () => {
        KanjiSelectStorage.resetKanjiSelectProgress();
        renderKanjiSelectSetupBody();
      },
    });
  });
  resetSection.appendChild(resetBtn);
  body.appendChild(resetSection);
}

function showKanjiSelectSetupMessage(reason) {
  const messages = {
    'no-weak': ['いまは にがてな もんだいは ないよ！', 'にがてな もんだいが みつかったら、また ちょうせんしてね。'],
    'no-questions': ['もんだいが みつからなかったよ', 'がくねんや しゅるいを かえて ためしてみてね。'],
  };
  const [title, sub] = messages[reason] || messages['no-questions'];
  const el = document.getElementById('kanjiselect-setup-message');
  if (!el) return;
  el.innerHTML = `<div class="yomi-setup-message-title">${title}</div><div class="yomi-setup-message-sub">${sub}</div>`;
}

function clearKanjiSelectSetupMessage() {
  const el = document.getElementById('kanjiselect-setup-message');
  if (el) el.innerHTML = '';
}

// ========== セッション開始 ==========
function startKanjiSelectSession() {
  const grade = KanjiSelectStorage.getSelectedGrade();
  const sourceType = KanjiSelectStorage.getSelectedSourceType();
  const practiceType = KanjiSelectStorage.getSelectedPracticeType();
  const progressMap = KanjiSelectStorage.getAllProgress();

  const { pool, reason } = buildSessionPool(KANJI_SELECT_QUESTIONS, { grade, sourceType, practiceType }, progressMap);

  if (reason || pool.length === 0) {
    showKanjiSelectSetup();
    showKanjiSelectSetupMessage(reason || 'no-questions');
    return;
  }

  kanjiSelectCancelled = false;
  kanjiSelectSession = createSessionState(pool);
  Storage.incrementPlay();
  showScreen('screen-kanjiselect');
  renderNextKanjiSelectQuestion();
}

// ========== 出題 ==========
function renderNextKanjiSelectQuestion() {
  if (kanjiSelectCancelled || !kanjiSelectSession) return;
  const qId = getNextQuestionId(kanjiSelectSession);
  if (qId === null) {
    endKanjiSelectSession();
    return;
  }
  const question = kanjiSelectSession.questionsById[qId];
  renderKanjiSelectQuestion(question);
}

function setKanjiSelectFeedback(text, cls) {
  const el = document.getElementById('kanjiselect-feedback');
  if (!el) return;
  el.textContent = text || '';
  el.className = 'yomi-feedback' + (cls ? ` ${cls}` : '');
}

function renderKanjiSelectQuestion(question) {
  const progEl = document.getElementById('kanjiselect-progress-text');
  if (progEl) progEl.textContent = `もんだい ${kanjiSelectSession.totalAsked + 1}`;

  const readingEl = document.getElementById('kanjiselect-reading');
  if (readingEl) readingEl.textContent = `「${question.targetReading}」`;

  const promptEl = document.getElementById('kanjiselect-prompt');
  if (promptEl) promptEl.textContent = 'は どの かんじ？';

  setKanjiSelectFeedback('', '');
  const nextArea = document.getElementById('kanjiselect-next-area');
  if (nextArea) nextArea.innerHTML = '';

  const choices = buildKanjiChoiceList(question);
  renderKanjiSelectChoices(choices, question);

  kanjiSelectAnswerLocked = false;
}

function renderKanjiSelectChoices(choices, question) {
  const area = document.getElementById('kanjiselect-choices-area');
  if (!area) return;
  area.innerHTML = '';
  choices.forEach(choice => {
    const btn = document.createElement('button');
    btn.className = 'choice-btn kanji-choice-btn';
    btn.dataset.choiceId = choice.id;
    btn.textContent = choice.text;
    btn.addEventListener('click', () => onKanjiSelectChoiceClick(choice.id, question, choices));
    area.appendChild(btn);
  });
}

// ========== 解答処理 ==========
async function onKanjiSelectChoiceClick(choiceId, question, choices) {
  if (kanjiSelectAnswerLocked || kanjiSelectCancelled) return;
  kanjiSelectAnswerLocked = true;

  const correctChoice = choices.find(c => c.correct);
  const isCorrect = choiceId === correctChoice.id;

  document.querySelectorAll('#kanjiselect-choices-area .choice-btn').forEach(btn => {
    btn.disabled = true;
    if (btn.dataset.choiceId === correctChoice.id) {
      btn.classList.add('correct');
    } else if (btn.dataset.choiceId === choiceId && !isCorrect) {
      btn.classList.add('wrong');
    }
  });

  const { isFirstAttemptThisSession, wasPreviouslyWrong, correctStreak } =
    recordAnswer(kanjiSelectSession, question.id, isCorrect);
  if (isFirstAttemptThisSession) {
    KanjiSelectStorage.recordFirstAttemptOfSession(question.id, isCorrect, new Date().toISOString());
  }

  const supportEvent = resolveSupportEvent({ isCorrect, wasPreviouslyWrong, correctStreak });
  showSupporterReaction(supportEvent, kanjiSelectSupporterState);

  if (isCorrect) {
    Audio.playCorrect();
    setKanjiSelectFeedback('せいかい！', 'yomi-feedback-correct');
    spawnStars(5);
    await delay(1300);
    if (kanjiSelectCancelled) return;

    queueLearningReward(kanjiSelectSession, question.targetKanji, isFirstAttemptThisSession);
  } else {
    Audio.playWrong();
    setKanjiSelectFeedback(`おしい！「${question.targetReading}」は「${question.targetKanji}」だよ。`, 'yomi-feedback-wrong');
    await waitForNextTap('kanjiselect-next-area');
    if (kanjiSelectCancelled) return;
  }

  renderNextKanjiSelectQuestion();
}

// ========== セッション終了 ==========
async function endKanjiSelectSession() {
  const session = kanjiSelectSession;
  const summary = summarizeSession(session);

  const stillWeakCount = Array.from(session.seenThisSession).filter(id => {
    const p = KanjiSelectStorage.getProgress(id);
    return p && p.isWeak;
  }).length;

  const completed = await playPendingReveals(session, () => kanjiSelectCancelled);
  if (!completed) return;

  renderKanjiSelectResult(summary, stillWeakCount);
  showScreen('screen-kanjiselect-result');
}

function renderKanjiSelectResult(summary, stillWeakCount) {
  const el = document.getElementById('kanjiselect-result-summary');
  if (el) {
    el.innerHTML =
      `<div>せいかい: ${summary.correctCount} / ${summary.totalAsked} もん</div>
       <div>おぼえなおした もんだい: ${summary.reLearnedCount} こ</div>
       <div>まだ れんしゅうすると いい もんだい: ${stillWeakCount} こ</div>`;
  }
  renderSupporterOnResult('kanjiselect-result-supporter', kanjiSelectSupporterState);
}

// ========== 画面遷移・イベント登録 ==========
document.addEventListener('DOMContentLoaded', () => {
  const btnKanjiSelect = document.getElementById('btn-kanjiselect');
  if (btnKanjiSelect) {
    btnKanjiSelect.addEventListener('click', () => {
      Audio.playSelect();
      showKanjiSelectSetup();
    });
  }

  const btnSetupBack = document.getElementById('btn-kanjiselect-setup-back');
  if (btnSetupBack) {
    btnSetupBack.addEventListener('click', () => {
      Audio.playSelect();
      kanjiSelectCancelled = true;
      showScreen('screen-title');
    });
  }

  const btnQuestionBack = document.getElementById('btn-kanjiselect-back');
  if (btnQuestionBack) {
    btnQuestionBack.addEventListener('click', () => {
      Audio.playSelect();
      kanjiSelectCancelled = true;
      kanjiSelectAnswerLocked = false;
      showKanjiSelectSetup();
    });
  }

  const btnRetry = document.getElementById('btn-kanjiselect-retry');
  if (btnRetry) {
    btnRetry.addEventListener('click', () => {
      Audio.playSelect();
      startKanjiSelectSession();
    });
  }

  const btnWeak = document.getElementById('btn-kanjiselect-weak');
  if (btnWeak) {
    btnWeak.addEventListener('click', () => {
      Audio.playSelect();
      KanjiSelectStorage.setSelectedPracticeType('weakOnly');
      startKanjiSelectSession();
    });
  }

  const btnZukan = document.getElementById('btn-kanjiselect-zukan');
  if (btnZukan) {
    btnZukan.addEventListener('click', () => {
      Audio.playSelect();
      kanjiSelectCancelled = true;
      showZukan();
    });
  }

  const btnTitle = document.getElementById('btn-kanjiselect-title');
  if (btnTitle) {
    btnTitle.addEventListener('click', () => {
      Audio.playSelect();
      kanjiSelectCancelled = true;
      showScreen('screen-title');
    });
  }
});
