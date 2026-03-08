// js/main.js - 画面管理・UIイベント

// SVG要素ID定数 (先頭で定義)
const battleSVGId   = 'battle-kanji-svg';
const practiceSVGId = 'practice-kanji-svg';

// ========== Weighted random サンプリング (苦手漢字優先) ==========
// weight = 1 + mistakeCount → ミスが多いほど出やすい
function weightedSample(pool, n) {
  const items = [...pool];
  const result = [];
  const count = Math.min(n, items.length);
  for (let i = 0; i < count; i++) {
    const weights = items.map(k => 1 + Storage.getMistakeCount(k.char));
    const total   = weights.reduce((s, w) => s + w, 0);
    let r = Math.random() * total;
    let chosen = items.length - 1;
    for (let j = 0; j < items.length; j++) {
      r -= weights[j];
      if (r <= 0) { chosen = j; break; }
    }
    result.push(items.splice(chosen, 1)[0]);
  }
  return result;
}

// ========== 画面切り替え ==========
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById(id);
  if (el) el.classList.add('active');
}

// ========== ログ表示 ==========
function setLog(text, subtext = '') {
  const logEl = document.getElementById('battle-log');
  if (!logEl) return;
  logEl.innerHTML = `<span class="log-main">${text}</span>${subtext ? `<span class="log-sub">${subtext}</span>` : ''}`;
}

// ========== 敵HP更新 ==========
function updateEnemyHP() {
  const state = Game.getState();
  if (!state) return;
  const ratio = Game.hpRatio();
  const bar = document.getElementById('enemy-hp-bar');
  const label = document.getElementById('enemy-hp-label');
  if (bar) {
    bar.style.width = Math.max(0, ratio * 100) + '%';
    bar.className = 'hp-fill' + (ratio < 0.3 ? ' danger' : ratio < 0.6 ? ' warn' : '');
  }
  if (label) {
    const state = Game.getState();
    label.textContent = `HP: ${state.enemyHP} / ${state.enemyMaxHP}`;
  }
}

// ========== ミニSVG生成 (選択肢カード用) ==========
// charData の全ストロークを薄く描き、highlightedStrokeId の1画だけ強調する
function createChoiceSvg(charData, highlightedStrokeId) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 109 109');
  svg.setAttribute('class', 'choice-mini-svg');

  charData.strokes.forEach(stroke => {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', stroke.path);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');

    if (stroke.id === highlightedStrokeId) {
      path.setAttribute('stroke', '#fbbf24');   // 強調: 黄色
      path.setAttribute('stroke-width', '9');
      path.setAttribute('opacity', '1');
    } else {
      path.setAttribute('stroke', '#94a3b8');   // 背景: 薄グレー
      path.setAttribute('stroke-width', '5');
      path.setAttribute('opacity', '0.3');
    }

    svg.appendChild(path);
  });

  return svg;
}

// ========== 選択肢ボタン描画 ==========
// charData を渡すと書き順クイズ用ミニSVGカード、null なら数字ボタン
function renderChoices(choices, correctAnswer, charData) {
  const area = document.getElementById('choices-area');
  if (!area) return;
  area.innerHTML = '';

  // 書き順クイズ: stroke オブジェクト配列 → ミニSVGカード
  if (charData && choices.length > 0 && typeof choices[0] === 'object') {
    choices.forEach(stroke => {
      const btn = document.createElement('button');
      btn.className = 'choice-card';
      btn.dataset.value = stroke.id;
      btn.appendChild(createChoiceSvg(charData, stroke.id));
      const lbl = document.createElement('span');
      lbl.className = 'choice-label';
      lbl.textContent = stroke.label;
      btn.appendChild(lbl);
      btn.addEventListener('click', () => onChoiceClick(stroke.id, correctAnswer));
      area.appendChild(btn);
    });
    return;
  }

  // 画数クイズ: 数字ボタン (従来通り)
  choices.forEach(choice => {
    const btn = document.createElement('button');
    btn.className = 'choice-btn';
    btn.dataset.value = choice;
    btn.textContent = choice;
    btn.addEventListener('click', () => onChoiceClick(choice, correctAnswer));
    area.appendChild(btn);
  });
}

// ========== 選択肢クリック処理 ==========
let answerLocked = false;

async function onChoiceClick(value, _correct) {
  if (answerLocked) return;
  answerLocked = true;

  // answer() で kanjiIndex が進む前に現在の漢字を保存
  const clearingKanji = Game.currentKanji();
  const result = Game.answer(value);
  if (!result) { answerLocked = false; return; }

  const state = Game.getState();

  // ボタン色フィードバック (choice-btn: 画数, choice-card: 書き順)
  document.querySelectorAll('.choice-btn, .choice-card').forEach(btn => {
    btn.disabled = true;
    if (String(btn.dataset.value) === String(result.correctValue)) {
      btn.classList.add('correct');
    } else if (String(btn.dataset.value) === String(value) && !result.correct) {
      btn.classList.add('wrong');
    }
  });

  if (result.correct) {
    Audio.playCorrect();
    setLog('せいかい！ ' + result.praise, result.kanjiCleared ? '' : Game.getProgressText());
    spawnStars(5);

    // 攻撃演出
    await delay(400);
    Audio.playAttack();
    shakeEnemy();
    Audio.playHit();
    updateEnemyHP();

    if (result.kanjiCleared) {
      updatePlayerUI(); // XPバー即座更新
      await delay(600);
      setLog('やったー！ モンスターをたおした！', starsText(result.stars));
      Audio.playVictory();
      spawnStars(12);
      await delay(700);

      // ゲット演出 (初クリア時のみ)
      if (result.isNewCapture && clearingKanji) {
        await showCaptureOverlay(clearingKanji, result.stars);
      }

      // レベルアップ演出
      if (result.leveledUp) {
        await showLevelUpOverlay(result.newLevel);
      }

      // 進化チェーン解放チェック
      if (clearingKanji) {
        const unlockedChain = checkEvolutionUnlock(clearingKanji.char);
        if (unlockedChain) {
          await showEvolutionOverlay(unlockedChain);
        }
      }

      if (result.sessionDone) {
        showResultScreen();
      } else {
        // 次の漢字へ
        setLog('つぎのかいぶつが あらわれた！');
        await delay(600);
        initBattleUI();
      }
    } else {
      await delay(500);
      advanceBattleUI();
    }
  } else {
    // 不正解
    Audio.playWrong();
    setLog('おしい！ おてほんを みよう！');
    await delay(600);

    // お手本アニメーション表示
    const k = Game.currentKanji();
    const st = Game.getState();
    const idx = st.phase === 'strokeCount' ? 0 : st.strokeIndex;
    if (st.phase === 'strokeOrder') {
      // 正しいストロークを1画アニメーション
      Renderer.showCorrectStroke(k, idx, idx);
    }
    await delay(1200);

    setLog('もう いちど チャレンジ！');
    await delay(400);
    advanceBattleUI();
  }

  answerLocked = false;
}

// ========== バトルUI 初期化 ==========
function initBattleUI() {
  const k = Game.currentKanji();
  if (!k) return;
  const st = Game.getState();

  // 敵モンスター表示
  const monsterEl = document.getElementById('enemy-monster');
  if (monsterEl) {
    monsterEl.innerHTML = buildMonsterSVG(k.enemyVariant, k.enemyColor, 1);
  }
  document.getElementById('enemy-name').textContent = k.enemyName;

  // 漢字表示
  document.getElementById('battle-kanji').textContent = k.char;

  // HP初期化
  updateEnemyHP();

  // SVG初期化 (全て薄グレー)
  Renderer.render(k, 0);

  // プレイヤーUI (LV・XP・進捗バー)
  updatePlayerUI();

  // ログ
  setLog(`${k.enemyName} が あらわれた！`);
  setTimeout(() => {
    advanceBattleUI();
  }, 1000);
}

// ========== バトルUI 進行 ==========
function advanceBattleUI() {
  const k = Game.currentKanji();
  if (!k) return;
  const st = Game.getState();

  // 進捗表示更新
  const progEl = document.getElementById('progress-text');
  if (progEl) {
    progEl.textContent = st.phase === 'strokeOrder' ? Game.getProgressText() : '画数クイズ';
  }

  // 問題文
  setLog(Game.getQuestionText());

  // SVG再描画
  if (st.phase === 'strokeOrder') {
    Renderer.render(k, st.strokeIndex, -1);
  }

  // 選択肢
  const choices = Game.getChoices();
  const correctAnswer = Game.getCorrectAnswer();

  if (st.phase === 'strokeOrder') {
    console.log('[QuizDebug]', {
      char: k.char,
      currentIndex: st.strokeIndex,
      correctId: correctAnswer,
      choiceIds: choices.map(c => c.id),
      choiceLabels: choices.map(c => c.label),
    });
  }

  renderChoices(choices, correctAnswer, st.phase === 'strokeOrder' ? k : null);
}

// ========== 結果画面 ==========
function showResultScreen() {
  const results = Game.getResults();
  const totalStars = results.reduce((s, r) => s + r.stars, 0);
  const mistakes   = Game.getState().totalMistakes;

  const listEl = document.getElementById('result-list');
  if (listEl) {
    listEl.innerHTML = results.map(r =>
      `<div class="result-item">
         <span class="result-char">${r.char}</span>
         <span class="result-stars">${'★'.repeat(r.stars)}${'☆'.repeat(3 - r.stars)}</span>
       </div>`
    ).join('');
  }

  const summaryEl = document.getElementById('result-summary');
  if (summaryEl) {
    summaryEl.innerHTML =
      `<div>ごうけい ★ ${totalStars} こ</div>
       <div>まちがい: ${mistakes} かい</div>`;
  }

  showScreen('screen-result');
  Audio.playVictory();
}

// ========== ゲット演出オーバーレイ ==========
function showCaptureOverlay(kanji, stars) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'capture-overlay';
    overlay.innerHTML = `
      <div class="capture-card">
        <div class="capture-banner">ゲット！</div>
        <div class="capture-monster-wrap" id="cap-monster-svg"></div>
        <div class="capture-char">${kanji.char}</div>
        <div class="capture-reading">${kanji.reading}</div>
        <div class="capture-name">${kanji.enemyName}</div>
        <div class="capture-stars">${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}</div>
        <div class="capture-hint">タップで つぎへ</div>
      </div>`;
    document.body.appendChild(overlay);
    document.getElementById('cap-monster-svg').innerHTML =
      buildMonsterSVG(kanji.enemyVariant, kanji.enemyColor, 1);
    spawnStars(8);

    function dismiss() {
      if (!overlay.parentNode) return;
      overlay.classList.add('capture-out');
      setTimeout(() => { overlay.remove(); resolve(); }, 350);
    }
    overlay.addEventListener('click', dismiss);
    setTimeout(dismiss, 3500);
  });
}

// ========== 進化解放オーバーレイ ==========
function showEvolutionOverlay(chain) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'capture-overlay evolution-overlay';
    overlay.innerHTML = `
      <div class="capture-card evo-complete-card">
        <div class="capture-banner evolution-banner">しんかチェーン<br>かんせい！</div>
        <div class="evo-complete-chain-label">${chain.label}</div>
        <div class="evolution-chain-text">${chain.chars.join(' → ')}</div>
        <div class="capture-monster-wrap" id="evo-monster-svg"></div>
        <div class="evo-complete-crown">👑</div>
        <div class="capture-name">${chain.rewardName}</div>
        <div class="capture-desc">${chain.desc}</div>
        <div class="capture-hint">タップで つぎへ</div>
      </div>`;
    document.body.appendChild(overlay);
    document.getElementById('evo-monster-svg').innerHTML =
      buildMonsterSVG(chain.rewardVariant, chain.rewardColor, 1);
    spawnStars(16);
    spawnConfetti(32);
    Audio.playVictory();

    function dismiss() {
      if (!overlay.parentNode) return;
      overlay.classList.add('capture-out');
      setTimeout(() => { overlay.remove(); resolve(); }, 350);
    }
    overlay.addEventListener('click', dismiss);
    setTimeout(dismiss, 5500);
  });
}

// ========== 進化チェーン1本の描画 ==========
function renderEvolutionChain(chain) {
  const unlocked = Storage.isEvolutionUnlocked(chain.id);
  const block = document.createElement('div');
  block.className = 'evo-chain-block' + (unlocked ? ' unlocked' : '');

  // ヘッダー行: ラベル + 完成バッジ
  const header = document.createElement('div');
  header.className = 'evo-chain-header';

  const label = document.createElement('div');
  label.className = 'evo-chain-label';
  label.textContent = chain.label;
  header.appendChild(label);

  if (unlocked) {
    const badge = document.createElement('div');
    badge.className = 'evo-complete-badge';
    badge.textContent = '★ かんせい！';
    header.appendChild(badge);
  } else {
    const clearedN = chain.chars.filter(c => Storage.isCleared(c)).length;
    const prog = document.createElement('div');
    prog.className = 'evo-chain-progress';
    prog.textContent = `${clearedN} / ${chain.chars.length}`;
    header.appendChild(prog);
  }
  block.appendChild(header);

  const row = document.createElement('div');
  row.className = 'evo-chain-row';
  block.appendChild(row);

  chain.chars.forEach((char, i) => {
    const cleared = Storage.isCleared(char);
    const kData = KANJI_DATA.find(k => k.char === char);

    const stage = document.createElement('div');
    stage.className = 'evo-stage' + (cleared ? ' cleared' : '');

    const monsterDiv = document.createElement('div');
    monsterDiv.className = 'evo-stage-monster';
    monsterDiv.innerHTML = (cleared && kData)
      ? buildMonsterSVG(kData.enemyVariant, kData.enemyColor, 1)
      : '<span class="evo-locked-mark">？</span>';
    stage.appendChild(monsterDiv);

    const charDiv = document.createElement('div');
    charDiv.className = 'evo-stage-char';
    charDiv.textContent = char;
    stage.appendChild(charDiv);

    row.appendChild(stage);

    if (i < chain.chars.length - 1) {
      const arrow = document.createElement('div');
      arrow.className = 'evo-arrow-sm';
      arrow.textContent = '→';
      row.appendChild(arrow);
    }
  });

  const sep = document.createElement('div');
  sep.className = 'evo-reward-sep';
  sep.textContent = '⇒';
  row.appendChild(sep);

  const rewardWrap = document.createElement('div');
  rewardWrap.className = 'evo-reward-wrap' + (unlocked ? ' unlocked' : '');

  if (unlocked) {
    const crown = document.createElement('div');
    crown.className = 'evo-reward-crown';
    crown.textContent = '👑';
    rewardWrap.appendChild(crown);
  }

  const rewardMonster = document.createElement('div');
  rewardMonster.className = 'evo-reward-monster' + (unlocked ? '' : ' locked');
  rewardMonster.innerHTML = unlocked
    ? buildMonsterSVG(chain.rewardVariant, chain.rewardColor, 1)
    : '<span class="evo-locked-mark">🔒</span>';
  rewardWrap.appendChild(rewardMonster);

  const rewardName = document.createElement('div');
  rewardName.className = 'evo-reward-name';
  rewardName.textContent = unlocked ? chain.rewardName : '？？？';
  rewardWrap.appendChild(rewardName);

  row.appendChild(rewardWrap);
  return block;
}

// ========== ずかん画面 ==========
function showZukan() {
  const grid = document.getElementById('zukan-grid');
  if (!grid) return;
  grid.innerHTML = '';

  // 図鑑完成率ブロック
  const totalChars   = KANJI_DATA.length;
  const clearedCount = KANJI_DATA.filter(k => Storage.isCleared(k.char)).length;
  const pctNum       = Math.round((clearedCount / totalChars) * 100);
  const compBlock = document.createElement('div');
  compBlock.className = 'zukan-completion-block';
  compBlock.innerHTML = `
    <div class="zukan-comp-row">
      <span class="zukan-comp-count">${clearedCount} / ${totalChars} もじ</span>
      <span class="zukan-comp-pct">${pctNum}%</span>
    </div>
    <div class="zukan-comp-bar-wrap">
      <div class="zukan-comp-fill" style="width:${pctNum}%"></div>
    </div>`;
  grid.appendChild(compBlock);

  // にがてのかんじ セクション
  const weakList = Storage.getWeakKanji(12);
  if (weakList.length > 0) {
    const weakTitle = document.createElement('div');
    weakTitle.className = 'zukan-section-title weak-section-title';
    weakTitle.textContent = '⚠ にがてのかんじ';
    grid.appendChild(weakTitle);

    const weakGrid = document.createElement('div');
    weakGrid.className = 'zukan-weak-grid';
    weakList.forEach(({ char, count }) => {
      const kData = KANJI_DATA.find(k => k.char === char);
      if (!kData) return;
      const card = document.createElement('div');
      card.className = 'zukan-weak-card';
      card.innerHTML = `
        <div class="weak-miss-bar" style="--miss-w:${Math.min(count * 10, 100)}%"></div>
        <div class="weak-char">${char}</div>
        <div class="weak-reading">${kData.reading}</div>
        <div class="weak-count">✕ ${count}</div>`;
      card.addEventListener('click', () => startPractice(kData));
      weakGrid.appendChild(card);
    });
    grid.appendChild(weakGrid);
  }

  // モンスターカードグリッド
  const monstersGrid = document.createElement('div');
  monstersGrid.className = 'zukan-monsters-grid';
  grid.appendChild(monstersGrid);

  KANJI_DATA.forEach(k => {
    const stars = Storage.getStars(k.char);
    const captured = Storage.isCleared(k.char);
    const card = document.createElement('div');
    card.className = 'zukan-card' + (captured ? ' captured' : ' locked');

    if (captured) {
      card.innerHTML = `
        <div class="zukan-monster">${buildMonsterSVG(k.enemyVariant, k.enemyColor, 1)}</div>
        <div class="zukan-char">${k.char}</div>
        <div class="zukan-reading">${k.reading}</div>
        <div class="zukan-monster-name">${k.enemyName}</div>
        <div class="zukan-stars">${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}</div>`;
      card.addEventListener('click', () => startPractice(k));
    } else {
      card.innerHTML = `
        <div class="zukan-monster-unknown">？</div>
        <div class="zukan-char">？</div>
        <div class="zukan-monster-name">？？？</div>`;
    }
    monstersGrid.appendChild(card);
  });

  // 進化チェーンセクション
  if (EVOLUTION_CHAINS.length > 0) {
    const evoTitle = document.createElement('div');
    evoTitle.className = 'zukan-section-title';
    evoTitle.textContent = '✦ しんかチェーン';
    grid.appendChild(evoTitle);

    const evoList = document.createElement('div');
    evoList.className = 'evo-chain-list';
    grid.appendChild(evoList);

    EVOLUTION_CHAINS.forEach(chain => evoList.appendChild(renderEvolutionChain(chain)));
  }

  // リセットボタン
  const resetSection = document.createElement('div');
  resetSection.className = 'zukan-reset-section';
  const resetBtn = document.createElement('button');
  resetBtn.className = 'btn-zukan-reset';
  resetBtn.textContent = 'はじめから あそぶ';
  resetBtn.addEventListener('click', () => showResetDialog());
  resetSection.appendChild(resetBtn);
  grid.appendChild(resetSection);

  showScreen('screen-zukan');
}

// ========== れんしゅうモード ==========
let practiceKanji = null;
let practiceStep  = 0;
let practiceMode  = 'view'; // 'view' | 'quiz'

function showPracticeSelect() {
  const grid = document.getElementById('practice-select-grid');
  if (!grid) return;
  grid.innerHTML = '';

  KANJI_DATA.forEach(k => {
    const btn = document.createElement('button');
    btn.className = 'practice-select-btn';
    btn.textContent = k.char;
    btn.title = k.reading;
    btn.addEventListener('click', () => startPractice(k));
    grid.appendChild(btn);
  });

  showScreen('screen-practice-select');
}

function startPractice(kanji) {
  practiceKanji = kanji;
  practiceStep  = 0;
  practiceMode  = 'view';

  document.getElementById('practice-kanji-char').textContent = kanji.char;
  document.getElementById('practice-kanji-reading').textContent = kanji.reading;
  document.getElementById('practice-stroke-info').textContent = `${kanji.strokeCount} かく`;
  document.getElementById('practice-step-label').textContent = `1 / ${kanji.strokeCount} かく め`;

  // SVGをれんしゅう用に切り替えてから描画
  Renderer.setSVG(document.getElementById(practiceSVGId));
  Renderer.render(kanji, 0, -1);

  showScreen('screen-practice');
  Audio.playSelect();
}

function practiceStepForward() {
  if (!practiceKanji) return;
  if (practiceStep < practiceKanji.strokeCount) {
    Renderer.render(practiceKanji, practiceStep, practiceStep);
    Audio.playCorrect();
    practiceStep++;
    const label = document.getElementById('practice-step-label');
    if (label) {
      label.textContent = practiceStep >= practiceKanji.strokeCount
        ? 'かんせい！'
        : `${practiceStep + 1} / ${practiceKanji.strokeCount} かく め`;
    }
    Renderer.render(practiceKanji, practiceStep, -1);
  }
}

async function practicePlayAll() {
  if (!practiceKanji) return;
  practiceStep = 0;
  Renderer.render(practiceKanji, 0, -1);
  const label = document.getElementById('practice-step-label');
  await Renderer.playAll(practiceKanji, i => {
    practiceStep = i + 1;
    if (label) {
      label.textContent = practiceStep >= practiceKanji.strokeCount
        ? 'かんせい！'
        : `${practiceStep + 1} / ${practiceKanji.strokeCount} かく め`;
    }
    Audio.playCorrect();
  });
}

// れんしゅうモードからクイズ開始
function startPracticeQuiz() {
  if (!practiceKanji) return;
  // 1文字だけのバトルセッション
  Game.startBattle([practiceKanji]);
  Renderer.setSVG(document.getElementById(battleSVGId));
  showScreen('screen-battle');
  initBattleUI();
}

// ========== ユーティリティ ==========
function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function starsText(n) {
  return '★'.repeat(n) + '☆'.repeat(3 - n);
}

function shakeEnemy() {
  const el = document.getElementById('enemy-monster');
  if (!el) return;
  el.classList.add('shake');
  setTimeout(() => el.classList.remove('shake'), 500);
}

// ========== 紙吹雪エフェクト ==========
function spawnConfetti(count = 25) {
  const layer = document.getElementById('particle-layer');
  if (!layer) return;
  const CHARS  = ['★', '✦', '♦', '✿', '◆', '❋', '✸'];
  const COLORS = ['#ffd700', '#f5a623', '#e94560', '#2ecc71', '#5dade2', '#9b59b6', '#ffffff'];
  for (let i = 0; i < count; i++) {
    const el = document.createElement('span');
    el.className = 'confetti-particle';
    el.textContent = CHARS[Math.floor(Math.random() * CHARS.length)];
    const dx = (Math.random() * 260 - 130).toFixed(0);
    const dy = (Math.random() * 55 + 30).toFixed(0);
    const rot = (Math.random() > 0.5 ? '' : '-') + Math.floor(Math.random() * 540);
    const dur = (Math.random() * 0.8 + 1.4).toFixed(2);
    el.style.cssText =
      `left:${Math.random() * 100}%;top:${Math.random() * 25}%;` +
      `color:${COLORS[Math.floor(Math.random() * COLORS.length)]};` +
      `font-size:${Math.floor(Math.random() * 12 + 10)}px;` +
      `--confetti-x:${dx}px;--confetti-y:${dy}vh;` +
      `--confetti-rot:${rot}deg;--confetti-dur:${dur}s;` +
      `animation-delay:${(Math.random() * 0.5).toFixed(2)}s`;
    layer.appendChild(el);
    setTimeout(() => el.remove(), 2800);
  }
}

// ========== ずかんリセット ==========
function showResetDialog() {
  const overlay = document.createElement('div');
  overlay.className = 'reset-dialog-overlay';
  overlay.innerHTML = `
    <div class="reset-dialog">
      <div class="reset-dialog-title">ずかんリセット</div>
      <div class="reset-dialog-body">
        ほんとうに ずかんを<br>リセットする？<br>
        <span class="reset-dialog-warn">あつめたモンスターや<br>ほし きろくが きえるよ</span>
      </div>
      <div class="reset-dialog-buttons">
        <button class="reset-btn-yes" id="reset-confirm-yes">はい</button>
        <button class="reset-btn-no"  id="reset-confirm-no">いいえ</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  document.getElementById('reset-confirm-yes').addEventListener('click', () => {
    Audio.playSelect();
    Storage.resetCollection();
    overlay.remove();
    showResetToast();
    showZukan();
  });
  document.getElementById('reset-confirm-no').addEventListener('click', () => {
    Audio.playSelect();
    overlay.remove();
  });
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
}

function showResetToast() {
  const toast = document.createElement('div');
  toast.className = 'reset-toast';
  toast.textContent = 'リセットしたよ！';
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2200);
}

// ========== プレイヤーUI更新 (LV・XP・セッション進捗) ==========
function updatePlayerUI() {
  // LV / XPバー
  const lv  = Storage.getLevel();
  const xpInLv = Storage.getXPInLevel(); // 0〜99
  const lvEl  = document.getElementById('player-lv-text');
  const xpFil = document.getElementById('player-xp-fill');
  if (lvEl)  lvEl.textContent = `LV ${lv}`;
  if (xpFil) xpFil.style.width = xpInLv + '%';

  // セッション進み具合バー
  const st = Game.getState();
  if (st) {
    const done  = st.kanjiIndex;
    const total = st.kanjiList.length;
    const pct   = total > 0 ? Math.round((done / total) * 100) : 0;
    const cntEl = document.getElementById('session-prog-count');
    const filEl = document.getElementById('session-prog-fill');
    if (cntEl) cntEl.textContent = `${done} / ${total} かんじ`;
    if (filEl) filEl.style.width = pct + '%';
  }
}

// ========== レベルアップ演出 ==========
function showLevelUpOverlay(level) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'capture-overlay levelup-overlay';
    overlay.innerHTML = `
      <div class="capture-card levelup-card">
        <div class="levelup-title">LEVEL UP!</div>
        <div class="levelup-lv">LV <span>${level}</span></div>
        <div class="capture-hint">タップで つぎへ</div>
      </div>`;
    document.body.appendChild(overlay);
    spawnStars(22);
    spawnConfetti(20);
    Audio.playVictory();

    function dismiss() {
      if (!overlay.parentNode) return;
      overlay.classList.add('capture-out');
      setTimeout(() => { overlay.remove(); resolve(); }, 350);
    }
    overlay.addEventListener('click', dismiss);
    setTimeout(dismiss, 3200);
  });
}

// ========== バトル開始 ==========
function startBattle(kanjiList) {
  Game.startBattle(kanjiList);
  showScreen('screen-battle');
  initBattleUI();
}

// ========== 画面切り替え (SVG付き) ==========
function goToBattle() {
  Renderer.setSVG(document.getElementById(battleSVGId));
  showScreen('screen-battle');
}

function goToPractice() {
  Renderer.setSVG(document.getElementById(practiceSVGId));
  showScreen('screen-practice');
}

// ========== イベント登録 ==========
document.addEventListener('DOMContentLoaded', () => {
  // タイトル画面
  document.getElementById('btn-start').addEventListener('click', () => {
    Audio.playSelect();
    const list = weightedSample(KANJI_DATA, 5);
    Renderer.setSVG(document.getElementById(battleSVGId));
    startBattle(list);
  });

  document.getElementById('btn-practice').addEventListener('click', () => {
    Audio.playSelect();
    showPracticeSelect();
  });

  document.getElementById('btn-zukan').addEventListener('click', () => {
    Audio.playSelect();
    showZukan();
  });

  // バトル画面
  document.getElementById('btn-battle-title').addEventListener('click', () => {
    Audio.playSelect();
    answerLocked = false;
    showScreen('screen-title');
  });

  // れんしゅう選択画面
  document.getElementById('btn-practice-select-back').addEventListener('click', () => {
    Audio.playSelect();
    showScreen('screen-title');
  });

  // れんしゅうモード
  document.getElementById('btn-practice-play').addEventListener('click', () => {
    Renderer.setSVG(document.getElementById(practiceSVGId));
    practicePlayAll();
  });

  document.getElementById('btn-practice-step').addEventListener('click', () => {
    Renderer.setSVG(document.getElementById(practiceSVGId));
    practiceStepForward();
  });

  document.getElementById('btn-practice-reset').addEventListener('click', () => {
    Renderer.setSVG(document.getElementById(practiceSVGId));
    if (practiceKanji) {
      practiceStep = 0;
      Renderer.render(practiceKanji, 0, -1);
      const label = document.getElementById('practice-step-label');
      if (label) label.textContent = `1 / ${practiceKanji.strokeCount} かく め`;
    }
  });

  document.getElementById('btn-practice-quiz').addEventListener('click', () => {
    Audio.playSelect();
    startPracticeQuiz();
  });

  document.getElementById('btn-practice-back').addEventListener('click', () => {
    Audio.playSelect();
    showPracticeSelect();
  });

  // ずかん
  document.getElementById('btn-zukan-back').addEventListener('click', () => {
    Audio.playSelect();
    showScreen('screen-title');
  });

  // 結果画面
  document.getElementById('btn-result-retry').addEventListener('click', () => {
    Audio.playSelect();
    const list = weightedSample(KANJI_DATA, 5);
    Renderer.setSVG(document.getElementById(battleSVGId));
    startBattle(list);
  });

  document.getElementById('btn-result-title').addEventListener('click', () => {
    Audio.playSelect();
    showScreen('screen-title');
  });

  // 初期SVG設定
  Renderer.setSVG(document.getElementById(battleSVGId));

  // 初期画面
  showScreen('screen-title');
});
