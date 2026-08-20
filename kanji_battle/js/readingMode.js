// js/readingMode.js - よみかたモード UI制御
// game.js/main.js のクイズ状態機構(Game)は流用せず、問題(Question)単位の
// 独自セッション状態を readingLogic.js の関数で管理する。
// モンスター取得・進化判定・ボスカウンター等の横断的な仕組みは
// main.js/storage.js/evolutions.js の既存関数をそのまま呼び出す(改変しない)。

let yomikataSession = null;
let yomikataAnswerLocked = false;
let yomikataCancelled = true; // 質問画面が表示されていない間は true

// おうえんキャラクターの抽選状態(重複防止用)。データ・抽選ロジック・UI描画は
// js/supportersData.js / js/supporterSelector.js / js/supporterReaction.js を参照。
const yomikataSupporterState = createSupporterState();

// ========== 文字列ユーティリティ ==========
function yomiEscapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// 出題・強調表示で対象とする「言葉」を決める。
// 「読む」のように word 中で targetKanji の直後にひらがなが続き、かつ
// targetReading がそのひらがなで終わっている場合(=送り仮名が読みの一部)は、
// 漢字+送り仮名をまとめて対象にする(例:「読む」の よみかたは？→よむ)。
// 「電き」のように直後のひらがなが別の漢字を仮名書きしただけの場合
// (targetReading がそのひらがなで終わらない、例:でん≠電きの「き」)は、
// 対象漢字1字だけを対象にする(例:「電」の よみかたは？→でん)。
function yomiGetQuotedTerm(question) {
  const kanji = question.targetKanji;
  const word = question.word || '';
  const reading = question.targetReading || '';
  const idx = word.indexOf(kanji);
  if (idx === -1) return kanji;

  const after = word.slice(idx + kanji.length);
  let okurigana = '';
  for (const ch of after) {
    if (/^[぀-ゟ]$/.test(ch)) okurigana += ch;
    else break;
  }

  if (okurigana && reading.length > okurigana.length && reading.endsWith(okurigana)) {
    return kanji + okurigana;
  }
  return kanji;
}

// text 内の targetChar (対象の漢字、または漢字+送り仮名) をすべて強調span で包む
function yomiHighlightTarget(text, targetChar) {
  const escaped = yomiEscapeHtml(text || '');
  if (!targetChar) return escaped;
  return escaped.split(targetChar).join(`<span class="yomi-target-highlight">${targetChar}</span>`);
}

// ========== セットアップ画面 ==========
function showYomikataSetup() {
  yomikataCancelled = true;
  renderYomikataSetupBody();
  clearYomikataSetupMessage();
  showScreen('screen-yomikata-setup');
}

function yomiCountForSourceType(grade, sourceType) {
  return getEligibleQuestions(READING_QUESTIONS, { grade, sourceType }).length;
}

function renderYomikataSetupBody() {
  const body = document.getElementById('yomikata-setup-body');
  if (!body) return;
  body.innerHTML = '';

  const grade = ReadingStorage.getSelectedGrade();
  let sourceType = ReadingStorage.getSelectedSourceType();
  const practiceType = ReadingStorage.getSelectedPracticeType();

  // 選択中の問題種類が現在の学年で0件なら「すべて」へ自動フォールバック
  if (sourceType !== 'all' && yomiCountForSourceType(grade, sourceType) === 0) {
    sourceType = 'all';
    ReadingStorage.setSelectedSourceType('all');
  }

  // --- 学年 ---
  const gradeLabel = document.createElement('div');
  gradeLabel.className = 'yomi-setup-label';
  gradeLabel.textContent = 'がくねん';
  body.appendChild(gradeLabel);

  const gradeBar = document.createElement('div');
  gradeBar.className = 'grade-tab-bar';
  [['all', 'ぜんぶ'], [1, '1ねん'], [2, '2ねん'], [3, '3ねん'], [4, '4ねん']].forEach(([val, label]) => {
    const tab = document.createElement('button');
    tab.className = 'grade-tab' + (grade === val ? ' active' : '');
    tab.textContent = label;
    tab.addEventListener('click', () => {
      ReadingStorage.setSelectedGrade(val);
      renderYomikataSetupBody();
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
    const count = yomiCountForSourceType(grade, val);
    const disabled = count === 0;
    const tab = document.createElement('button');
    tab.className = 'grade-tab' + (sourceType === val ? ' active' : '') + (disabled ? ' disabled' : '');
    tab.textContent = disabled ? `${label}（まだ ないよ）` : label;
    if (disabled) {
      tab.disabled = true;
    } else {
      tab.addEventListener('click', () => {
        ReadingStorage.setSelectedSourceType(val);
        renderYomikataSetupBody();
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
      ReadingStorage.setSelectedPracticeType(val);
      renderYomikataSetupBody();
    });
    practiceBar.appendChild(tab);
  });
  body.appendChild(practiceBar);

  // --- メッセージ領域 (空/にがてなし等) ---
  const message = document.createElement('div');
  message.id = 'yomikata-setup-message';
  message.className = 'yomi-setup-message';
  body.appendChild(message);

  // --- はじめるボタン ---
  const startBtn = document.createElement('button');
  startBtn.className = 'btn-title yomi-start-btn';
  startBtn.id = 'btn-yomikata-start';
  startBtn.textContent = '▶ はじめる';
  startBtn.addEventListener('click', () => {
    Audio.playSelect();
    startYomikataSession();
  });
  body.appendChild(startBtn);

  // --- よみかたの きろくを リセット ---
  const resetSection = document.createElement('div');
  resetSection.className = 'zukan-reset-section';
  const resetBtn = document.createElement('button');
  resetBtn.className = 'btn-zukan-reset';
  resetBtn.textContent = 'よみかたの きろくを リセット';
  resetBtn.addEventListener('click', () => {
    showResetDialog({
      title: 'よみかたリセット',
      body: 'ほんとうに よみかたの<br>きろくを リセットする？',
      warnText: 'にがてもんだいの きろくが<br>きえるよ（かきじゅん・ずかんは きえません）',
      onConfirm: () => {
        ReadingStorage.resetReadingProgress();
        renderYomikataSetupBody();
      },
    });
  });
  resetSection.appendChild(resetBtn);
  body.appendChild(resetSection);
}

function showYomikataSetupMessage(reason) {
  const messages = {
    'no-weak': ['いまは にがてな もんだいは ないよ！', 'にがてな もんだいが みつかったら、また ちょうせんしてね。'],
    'no-questions': ['もんだいが みつからなかったよ', 'がくねんや しゅるいを かえて ためしてみてね。'],
  };
  const [title, sub] = messages[reason] || messages['no-questions'];
  const el = document.getElementById('yomikata-setup-message');
  if (!el) return;
  el.innerHTML = `<div class="yomi-setup-message-title">${title}</div><div class="yomi-setup-message-sub">${sub}</div>`;
}

function clearYomikataSetupMessage() {
  const el = document.getElementById('yomikata-setup-message');
  if (el) el.innerHTML = '';
}

// ========== セッション開始 ==========
function startYomikataSession() {
  const grade = ReadingStorage.getSelectedGrade();
  const sourceType = ReadingStorage.getSelectedSourceType();
  const practiceType = ReadingStorage.getSelectedPracticeType();
  const progressMap = ReadingStorage.getAllProgress();

  const { pool, reason } = buildSessionPool(READING_QUESTIONS, { grade, sourceType, practiceType }, progressMap);

  if (reason || pool.length === 0) {
    showYomikataSetup();
    showYomikataSetupMessage(reason || 'no-questions');
    return;
  }

  yomikataCancelled = false;
  yomikataSession = createSessionState(pool);
  Storage.incrementPlay();
  showScreen('screen-yomikata');
  renderNextYomikataQuestion();
}

// ========== 出題 ==========
function renderNextYomikataQuestion() {
  if (yomikataCancelled || !yomikataSession) return;
  const qId = getNextQuestionId(yomikataSession);
  if (qId === null) {
    endYomikataSession();
    return;
  }
  const question = yomikataSession.questionsById[qId];
  renderYomikataQuestion(question);
}

function setYomikataFeedback(text, cls) {
  const el = document.getElementById('yomikata-feedback');
  if (!el) return;
  el.textContent = text || '';
  el.className = 'yomi-feedback' + (cls ? ` ${cls}` : '');
}

function renderYomikataQuestion(question) {
  const progEl = document.getElementById('yomikata-progress-text');
  if (progEl) progEl.textContent = `もんだい ${yomikataSession.totalAsked + 1}`;

  const quotedTerm = yomiGetQuotedTerm(question);

  const sentenceEl = document.getElementById('yomikata-sentence');
  if (sentenceEl) sentenceEl.innerHTML = yomiHighlightTarget(question.sentence || question.word, quotedTerm);

  const promptEl = document.getElementById('yomikata-prompt');
  if (promptEl) promptEl.textContent = `「${quotedTerm}」の よみかたは？`;

  setYomikataFeedback('', '');
  const nextArea = document.getElementById('yomikata-next-area');
  if (nextArea) nextArea.innerHTML = '';

  const choices = buildChoiceList(question);
  renderYomikataChoices(choices, question);

  yomikataAnswerLocked = false;
}

function renderYomikataChoices(choices, question) {
  const area = document.getElementById('yomikata-choices-area');
  if (!area) return;
  area.innerHTML = '';
  choices.forEach(choice => {
    const btn = document.createElement('button');
    btn.className = 'choice-btn';
    btn.dataset.choiceId = choice.id;
    btn.textContent = choice.text;
    btn.addEventListener('click', () => onYomikataChoiceClick(choice.id, question, choices));
    area.appendChild(btn);
  });
}

// ========== 解答処理 ==========
async function onYomikataChoiceClick(choiceId, question, choices) {
  if (yomikataAnswerLocked || yomikataCancelled) return;
  yomikataAnswerLocked = true;

  const correctChoice = choices.find(c => c.correct);
  const isCorrect = choiceId === correctChoice.id;

  document.querySelectorAll('#yomikata-choices-area .choice-btn').forEach(btn => {
    btn.disabled = true;
    if (btn.dataset.choiceId === correctChoice.id) {
      btn.classList.add('correct');
    } else if (btn.dataset.choiceId === choiceId && !isCorrect) {
      btn.classList.add('wrong');
    }
  });

  const { isFirstAttemptThisSession, wasPreviouslyWrong, correctStreak } =
    recordAnswer(yomikataSession, question.id, isCorrect);
  if (isFirstAttemptThisSession) {
    ReadingStorage.recordFirstAttemptOfSession(question.id, isCorrect, new Date().toISOString());
  }

  const supportEvent = resolveSupportEvent({ isCorrect, wasPreviouslyWrong, correctStreak });
  showSupporterReaction(supportEvent, yomikataSupporterState);

  if (isCorrect) {
    Audio.playCorrect();
    setYomikataFeedback('せいかい！', 'yomi-feedback-correct');
    spawnStars(5);
    await delay(1300);
    if (yomikataCancelled) return;

    queueLearningReward(yomikataSession, question.targetKanji, isFirstAttemptThisSession);
  } else {
    Audio.playWrong();
    const fullNote = (question.fullReading && question.fullReading !== question.targetReading)
      ? `（ぜんぶ よむと「${question.fullReading}」）`
      : '';
    setYomikataFeedback(`おしい！「${yomiGetQuotedTerm(question)}」は「${question.targetReading}」と よむよ。${fullNote}`, 'yomi-feedback-wrong');
    await waitForNextTap('yomikata-next-area');
    if (yomikataCancelled) return;
  }

  renderNextYomikataQuestion();
}

// ========== セッション終了 ==========
// モンスター取得/進化/レベルアップの判定・積み込みは queueLearningReward
// (js/learningRewards.js、かんじをえらぶモードと共通)が行う。
async function endYomikataSession() {
  const session = yomikataSession;
  const summary = summarizeSession(session);

  const stillWeakCount = Array.from(session.seenThisSession).filter(id => {
    const p = ReadingStorage.getProgress(id);
    return p && p.isWeak;
  }).length;

  const completed = await playPendingReveals(session, () => yomikataCancelled);
  if (!completed) return;

  renderYomikataResult(summary, stillWeakCount);
  showScreen('screen-yomikata-result');
}

function renderYomikataResult(summary, stillWeakCount) {
  const el = document.getElementById('yomikata-result-summary');
  if (el) {
    el.innerHTML =
      `<div>せいかい: ${summary.correctCount} / ${summary.totalAsked} もん</div>
       <div>おぼえなおした もんだい: ${summary.reLearnedCount} こ</div>
       <div>まだ れんしゅうすると いい もんだい: ${stillWeakCount} こ</div>`;
  }
  renderSupporterOnResult('yomikata-result-supporter', yomikataSupporterState);
}

// ========== 画面遷移・イベント登録 ==========
document.addEventListener('DOMContentLoaded', () => {
  const btnYomikata = document.getElementById('btn-yomikata');
  if (btnYomikata) {
    btnYomikata.addEventListener('click', () => {
      Audio.playSelect();
      showYomikataSetup();
    });
  }

  const btnSetupBack = document.getElementById('btn-yomikata-setup-back');
  if (btnSetupBack) {
    btnSetupBack.addEventListener('click', () => {
      Audio.playSelect();
      yomikataCancelled = true;
      showScreen('screen-title');
    });
  }

  const btnQuestionBack = document.getElementById('btn-yomikata-back');
  if (btnQuestionBack) {
    btnQuestionBack.addEventListener('click', () => {
      Audio.playSelect();
      yomikataCancelled = true;
      yomikataAnswerLocked = false;
      showYomikataSetup();
    });
  }

  const btnRetry = document.getElementById('btn-yomikata-retry');
  if (btnRetry) {
    btnRetry.addEventListener('click', () => {
      Audio.playSelect();
      startYomikataSession();
    });
  }

  const btnWeak = document.getElementById('btn-yomikata-weak');
  if (btnWeak) {
    btnWeak.addEventListener('click', () => {
      Audio.playSelect();
      ReadingStorage.setSelectedPracticeType('weakOnly');
      startYomikataSession();
    });
  }

  const btnZukan = document.getElementById('btn-yomikata-zukan');
  if (btnZukan) {
    btnZukan.addEventListener('click', () => {
      Audio.playSelect();
      yomikataCancelled = true;
      showZukan();
    });
  }

  const btnTitle = document.getElementById('btn-yomikata-title');
  if (btnTitle) {
    btnTitle.addEventListener('click', () => {
      Audio.playSelect();
      yomikataCancelled = true;
      showScreen('screen-title');
    });
  }
});
