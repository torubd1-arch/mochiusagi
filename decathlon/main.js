// ===== Utility Functions =====
function rollDie() { return Math.floor(Math.random() * 6) + 1; }
function rollDice(n) { return Array.from({ length: n }, rollDie); }
function sumDice(arr) { return arr.reduce((a, b) => a + b, 0); }
function scoreMinusSix(arr) { return arr.reduce((a, v) => a + (v === 6 ? -6 : v), 0); }

// ===== Event Icons & List =====
const EVENT_ICONS = {
  '100m': '⚡', 'long_jump': '🦘', 'shot_put': '🏋️', 'high_jump': '🏔️',
  'javelin': '🎯', '1500m': '🕐', 'pole_vault': '🎪', 'hurdles': '🚧',
  'discus': '🥏', '400m': '⏱️',
};

const EVENTS = [
  window.Event100m, window.EventLongJump, window.EventShotPut, window.EventHighJump,
  window.EventJavelin, window.Event1500m, window.EventPoleVault, window.EventHurdles,
  window.EventDiscus, window.Event400m,
];

// ===== Game State =====
let gameState = null;

function createInitialState() {
  return {
    mode: 'solo',            // 'solo' | '2p' | 'cpu'
    cpuDifficulty: 'normal', // 'easy' | 'normal' | 'hard'
    players: [
      { name: 'プレイヤー1', totalScore: 0, eventScores: [] },
      { name: 'プレイヤー2', totalScore: 0, eventScores: [] },
    ],
    currentEventIndex: 0,
    currentPlayerIndex: 0,
    eventState: null,
    phase: 'start', // 'start' | 'playing' | 'event_result' | 'game_over'
    lastResult: null,
    cpuPending: false,
  };
}

function currentEvent() { return EVENTS[gameState.currentEventIndex]; }
function currentPlayer() { return gameState.players[gameState.currentPlayerIndex]; }

// ===== Game Flow =====
function startGame() {
  const mode = document.querySelector('#mode-select .btn-mode.active')?.dataset.mode || 'solo';
  const diff = document.querySelector('#cpu-select .btn-mode.active')?.dataset.diff || 'normal';
  const p1name = document.getElementById('p1-name').value.trim() || 'プレイヤー1';
  const p2name = document.getElementById('p2-name').value.trim() || 'プレイヤー2';

  gameState = createInitialState();
  gameState.mode = mode;
  gameState.cpuDifficulty = diff;
  gameState.players[0].name = p1name;
  gameState.players[1].name = (mode === 'cpu') ? 'CPU' : p2name;
  gameState.phase = 'playing';
  initCurrentEvent();
  render();
}

function initCurrentEvent() {
  gameState.eventState = currentEvent().init();
  gameState.cpuPending = false;
}

function handleAction(action) {
  if (gameState.phase !== 'playing') return;
  const ev = currentEvent();
  const prevState = gameState.eventState;
  gameState.eventState = ev.applyAction(gameState.eventState, action);

  // Sound feedback
  const type = typeof action === 'string' ? action : action.type;
  if (type === 'ROLL' || type === 'REROLL') AudioSystem.play('roll');
  else if (type === 'TOGGLE') AudioSystem.play('keep');
  else if (type === 'CONFIRM') AudioSystem.play('confirm');

  if (ev.isFinished(gameState.eventState)) {
    const result = ev.getResult(gameState.eventState);
    currentPlayer().eventScores.push(result.points);
    currentPlayer().totalScore += result.points;
    gameState.phase = 'event_result';
    gameState.lastResult = result;
    AudioSystem.play('success');
  }
  render();
}

function nextTurn() {
  // In 2P/CPU mode: after P1 finishes, P2 plays the same event
  if (gameState.mode !== 'solo' && gameState.currentPlayerIndex === 0) {
    gameState.currentPlayerIndex = 1;
    gameState.phase = 'playing';
    initCurrentEvent();
  } else {
    gameState.currentPlayerIndex = 0;
    gameState.currentEventIndex++;
    if (gameState.currentEventIndex >= EVENTS.length) {
      gameState.phase = 'game_over';
      saveRanking();
    } else {
      gameState.phase = 'playing';
      initCurrentEvent();
    }
  }
  render();
}

function restart() {
  gameState = createInitialState();
  render();
}

// ===== Ranking =====
const RANKING_KEY = 'decathlon_ranking_v2';

function getRanking() {
  try { return JSON.parse(localStorage.getItem(RANKING_KEY)) || []; }
  catch { return []; }
}

function saveRanking() {
  const ranking = getRanking();
  const numPlayers = gameState.mode === 'solo' ? 1 : 2;
  for (let p = 0; p < numPlayers; p++) {
    ranking.push({
      name: gameState.players[p].name,
      score: gameState.players[p].totalScore,
      date: new Date().toLocaleDateString('ja-JP'),
    });
  }
  ranking.sort((a, b) => b.score - a.score);
  ranking.splice(10);
  localStorage.setItem(RANKING_KEY, JSON.stringify(ranking));
}

function clearRanking() {
  localStorage.removeItem(RANKING_KEY);
  renderRankingModal();
}

function renderRankingModal() {
  const ranking = getRanking();
  const medals = ['🥇', '🥈', '🥉'];
  const content = document.getElementById('ranking-content');
  if (!ranking.length) {
    content.innerHTML = '<div class="ranking-empty">まだ記録がないよ！プレイしてみよう！</div>';
    return;
  }
  content.innerHTML = ranking.map((r, i) => `
    <div class="ranking-row">
      <span class="ranking-rank">${medals[i] || (i + 1) + '.'}</span>
      <span class="ranking-name">${escapeHtml(r.name)}</span>
      <span class="ranking-score">${r.score}点</span>
      <span class="ranking-date">${r.date}</span>
    </div>`
  ).join('');
}

// ===== CPU AI =====
function scheduleCpuAction() {
  if (gameState.cpuPending) return;
  if (gameState.phase !== 'playing') return;
  if (gameState.mode !== 'cpu' || gameState.currentPlayerIndex !== 1) return;
  gameState.cpuPending = true;
  const delay = gameState.cpuDifficulty === 'easy' ? 900 : gameState.cpuDifficulty === 'hard' ? 500 : 700;
  setTimeout(cpuTick, delay + Math.random() * 400);
}

function cpuTick() {
  gameState.cpuPending = false;
  if (gameState.phase !== 'playing') return;
  if (gameState.mode !== 'cpu' || gameState.currentPlayerIndex !== 1) return;

  const ev = currentEvent();
  const action = getCpuAction(ev, gameState.eventState, gameState.cpuDifficulty);
  if (action) handleAction(action);
}

function getCpuAction(ev, state, difficulty) {
  const actions = ev.getAvailableActions(state);
  const enabled = actions.filter(a => a.enabled !== false);
  if (!enabled.length) return null;

  const id = ev.id;
  if (id === 'javelin' || id === 'discus') return cpuJavelinDiscus(state, enabled, id);
  if (id === 'long_jump') return cpuLongJump(state, enabled, difficulty);
  if (id === 'shot_put') return cpuShotPut(state, enabled);
  return cpuDefault(state, enabled, difficulty);
}

function cpuDefault(state, enabled, difficulty) {
  const find = id => enabled.find(a => a.id === id);
  // Priority: finish > confirm > roll/reroll > retry/end
  for (const id of ['NEXT_ATTEMPT', 'NEXT_HEIGHT', 'CONFIRM']) {
    const a = find(id); if (a) return id;
  }
  const roll = find('ROLL') || find('REROLL');
  if (roll) {
    // Hard/Normal: reroll if score seems low; Easy: always confirm
    const confirm = find('CONFIRM');
    if (confirm && difficulty === 'easy') return 'CONFIRM';
    return roll.id;
  }
  const stop = find('STOP');
  if (stop) return 'STOP';
  const retry = find('RETRY');
  if (retry) return 'RETRY';
  const end = find('END');
  if (end) return 'END';
  return enabled[0].id;
}

function cpuShotPut(state, enabled) {
  const find = id => enabled.find(a => a.id === id);
  const next = find('NEXT_ATTEMPT');
  if (next) return 'NEXT_ATTEMPT';
  const stop = find('STOP');
  const roll = find('ROLL');
  // Stop if sum >= 15 or already 6+ dice
  if (stop && state.currentSum >= 15) return 'STOP';
  if (stop && state.rolledDice && state.rolledDice.length >= 6) return 'STOP';
  if (roll && roll.enabled) return 'ROLL';
  if (stop && stop.enabled) return 'STOP';
  return enabled[0].id;
}

function cpuJavelinDiscus(state, enabled, evId) {
  const find = id => enabled.find(a => a.id === id);
  const next = find('NEXT_ATTEMPT');
  if (next) return 'NEXT_ATTEMPT';

  // Select all keepable unselected dice
  if (state.activeDice) {
    const canKeep = evId === 'javelin' ? (v => v % 2 === 1) : (v => v % 2 === 0);
    const offset = (state.keptDice || []).length;
    for (let i = 0; i < state.activeDice.length; i++) {
      if (canKeep(state.activeDice[i]) && !(state.selectedIndices || []).includes(i)) {
        return { type: 'TOGGLE', index: offset + i };
      }
    }
  }

  const stop = find('STOP');
  const roll = find('ROLL');
  const currentScore = [...(state.keptDice || []),
    ...(state.selectedIndices || []).map(i => state.activeDice[i])].reduce((a, b) => a + b, 0);

  if (stop && stop.enabled && currentScore >= 9) return 'STOP';
  if (roll && roll.enabled) return 'ROLL';
  if (stop && stop.enabled) return 'STOP';
  return enabled[0].id;
}

function cpuLongJump(state, enabled, difficulty) {
  const find = id => enabled.find(a => a.id === id);
  const next = find('NEXT_ATTEMPT');
  if (next) return 'NEXT_ATTEMPT';

  if (state.phase === 'approach') {
    if (!state.appDice) return 'ROLL';
    const currentSum = (state.appKept || []).reduce((a, i) => a + state.appDice[i], 0);
    // Keep dice that won't cause foul
    for (let i = 0; i < state.appDice.length; i++) {
      if (!(state.appKept || []).includes(i) && currentSum + state.appDice[i] < 9) {
        return { type: 'TOGGLE', index: i };
      }
    }
    const goJump = find('GO_JUMP');
    if (goJump && goJump.enabled) return 'GO_JUMP';
    const reroll = find('REROLL');
    if (reroll && reroll.enabled) return 'REROLL';
    if (goJump) return 'GO_JUMP';
  }

  if (state.phase === 'jump') {
    if (!state.jmpCurrentRoll) return 'ROLL';
    for (let i = 0; i < state.jmpCurrentRoll.length; i++) {
      if (!(state.jmpCurrentKept || []).includes(i)) {
        return { type: 'TOGGLE', index: i };
      }
    }
    const stop = find('STOP');
    if (stop) return 'STOP';
  }

  return enabled[0].id;
}

// ===== Rendering =====
function render() {
  if (!gameState) return;

  const isStart = gameState.phase === 'start';
  const isPlaying = gameState.phase === 'playing';
  const isResult = gameState.phase === 'event_result';
  const isOver = gameState.phase === 'game_over';

  // Sections
  const sections = {
    'start-screen': isStart,
    'playing-area': isPlaying,
    'event-result': isResult,
    'game-over': isOver,
  };
  for (const [id, show] of Object.entries(sections)) {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('hidden', !show);
  }

  // Score table & log: only visible during gameplay
  const showSidebars = !isStart;
  document.getElementById('score-table')?.classList.toggle('hidden', !showSidebars);
  document.getElementById('log-area')?.classList.toggle('hidden', !showSidebars);

  // Header
  const eventIdx = Math.min(gameState.currentEventIndex, EVENTS.length - 1);
  const ev = EVENTS[eventIdx];
  document.getElementById('event-name').textContent =
    isOver ? '🏆 競技終了' : isStart ? 'Decathlon' : (EVENT_ICONS[ev.id] || '') + ' ' + ev.name;
  document.getElementById('progress').textContent =
    `${Math.min(gameState.currentEventIndex + 1, 10)}/10`;

  const isSolo = gameState.mode === 'solo';
  document.getElementById('total-score').textContent = isSolo
    ? `合計: ${gameState.players[0].totalScore}点`
    : `${gameState.players[0].name}: ${gameState.players[0].totalScore} ／ ${gameState.players[1].name}: ${gameState.players[1].totalScore}`;

  if (isStart) return;

  renderScoreTable();

  if (isOver) renderGameOver();
  else if (isResult) renderEventResult(ev);
  else if (isPlaying) renderPlaying(ev);

  // Schedule CPU after render
  scheduleCpuAction();
}

function renderScoreTable() {
  const el = document.getElementById('score-table-content');
  if (!el) return;
  const numPlayers = gameState.mode === 'solo' ? 1 : 2;
  const currentIdx = gameState.currentEventIndex;

  let html = '<table class="score-table-grid"><thead><tr><th>種目</th>';
  for (let p = 0; p < numPlayers; p++) {
    html += `<th>${escapeHtml(gameState.players[p].name.substring(0, 5))}</th>`;
  }
  html += '</tr></thead><tbody>';

  for (let i = 0; i < EVENTS.length; i++) {
    const ev = EVENTS[i];
    const isCurrent = (gameState.phase !== 'game_over') && (i === currentIdx);
    html += `<tr class="${isCurrent ? 'current-event' : ''}">`;
    html += `<td>${EVENT_ICONS[ev.id] || ''} ${ev.name}</td>`;
    for (let p = 0; p < numPlayers; p++) {
      const score = gameState.players[p].eventScores[i];
      html += `<td>${score !== undefined ? score : '-'}</td>`;
    }
    html += '</tr>';
  }

  html += '</tbody><tfoot><tr><td>合計</td>';
  for (let p = 0; p < numPlayers; p++) {
    html += `<td>${gameState.players[p].totalScore}</td>`;
  }
  html += '</tr></tfoot></table>';
  el.innerHTML = html;
}

function renderGameOver() {
  const numPlayers = gameState.mode === 'solo' ? 1 : 2;
  let colHeaders = '<th>種目</th>';
  for (let p = 0; p < numPlayers; p++) colHeaders += `<th>${escapeHtml(gameState.players[p].name)}</th>`;

  const rows = EVENTS.map((ev, i) => {
    let cols = `<td>${EVENT_ICONS[ev.id] || ''} ${ev.name}</td>`;
    for (let p = 0; p < numPlayers; p++) {
      const score = gameState.players[p].eventScores[i];
      cols += `<td>${score !== undefined ? score + '点' : '-'}</td>`;
    }
    return `<tr>${cols}</tr>`;
  }).join('');

  let footCols = '<th>合計</th>';
  for (let p = 0; p < numPlayers; p++) footCols += `<th>${gameState.players[p].totalScore}点</th>`;

  document.getElementById('final-scores').innerHTML = `
    <table>
      <thead><tr>${colHeaders}</tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr>${footCols}</tr></tfoot>
    </table>`;

  // Ranking notice
  const ranking = getRanking();
  const myScore = gameState.players[0].totalScore;
  const myRank = ranking.findIndex(r => r.name === gameState.players[0].name && r.score === myScore);
  let notice = '';
  if (myRank === 0) notice = '🥇 新記録！ランキング1位！';
  else if (myRank >= 0 && myRank < 3) notice = `🏅 ランキング${myRank + 1}位に入ったよ！`;
  else if (myRank >= 0) notice = `📊 ランキング${myRank + 1}位！`;
  document.getElementById('ranking-notice').textContent = notice;
}

function renderEventResult(ev) {
  const result = gameState.lastResult;
  const player = currentPlayer();

  document.getElementById('result-event-icon').textContent = EVENT_ICONS[ev.id] || '';
  document.getElementById('result-event-name').textContent = ev.name;
  document.getElementById('result-player-name').textContent =
    gameState.mode !== 'solo' ? `${player.name} の記録` : '';
  document.getElementById('result-points').textContent = `${result.points}点`;
  document.getElementById('result-details').textContent = result.details;
  document.getElementById('total-score-result').textContent =
    `${player.name} 合計: ${player.totalScore}点`;

  const nextBtn = document.getElementById('btn-next-event');
  if (gameState.mode !== 'solo' && gameState.currentPlayerIndex === 0) {
    const p2name = gameState.players[1].name;
    const isCpu = gameState.mode === 'cpu';
    nextBtn.textContent = isCpu ? `🤖 ${p2name}の番へ` : `→ ${p2name}の番へ`;
  } else {
    const isLast = gameState.currentEventIndex >= EVENTS.length - 1;
    nextBtn.textContent = isLast ? '🏆 最終結果へ' : '次の種目へ →';
  }
}

function renderPlaying(ev) {
  const s = gameState.eventState;

  // Player indicator (2P)
  const indicator = document.getElementById('player-indicator');
  if (gameState.mode !== 'solo') {
    const player = currentPlayer();
    const isCpu = gameState.mode === 'cpu' && gameState.currentPlayerIndex === 1;
    indicator.textContent = isCpu
      ? `🤖 ${player.name}（CPU）の番`
      : `👤 ${player.name} の番`;
    indicator.classList.remove('hidden');
  } else {
    indicator.classList.add('hidden');
  }

  // Event icon & description
  document.getElementById('event-icon-display').textContent = EVENT_ICONS[ev.id] || '';
  const desc = ev.getDescription ? ev.getDescription() : [];
  document.getElementById('event-description').innerHTML =
    desc.map(d => `<li>${escapeHtml(d)}</li>`).join('');

  document.getElementById('event-status').textContent =
    ev.getStatusText ? ev.getStatusText(s) : '';

  renderDice(ev.getDiceDisplay(s));
  renderActions(ev.getAvailableActions(s));
  renderLog(s.log || []);
}

function renderDice(diceDisplay) {
  const container = document.getElementById('dice-container');
  container.innerHTML = '';

  if (!diceDisplay || diceDisplay.length === 0) {
    container.innerHTML = '<span class="dice-placeholder">—</span>';
    return;
  }

  diceDisplay.forEach((die, i) => {
    if (!die) return;
    const el = document.createElement('div');
    el.className = 'die';
    el.dataset.index = i;
    if (die.kept) el.classList.add('kept');
    if (die.clickable) el.classList.add('clickable');
    if (die.foulDie) el.classList.add('foul-die');
    if (die.dim) el.classList.add('dim');
    el.textContent = (die.value !== null && die.value !== undefined) ? die.value : '·';
    container.appendChild(el);
  });
}

function renderActions(actions) {
  const container = document.getElementById('action-buttons');
  container.innerHTML = '';

  actions.forEach(action => {
    if (action.id === 'SELECT_DICE') {
      const wrapper = document.createElement('div');
      wrapper.className = 'select-wrapper';
      const label = document.createElement('label');
      label.textContent = 'ダイス数: ';
      const select = document.createElement('select');
      for (let i = 1; i <= 8; i++) {
        const opt = document.createElement('option');
        opt.value = i;
        opt.textContent = `${i}個`;
        if (i === action.value) opt.selected = true;
        select.appendChild(opt);
      }
      select.addEventListener('change', e =>
        handleAction({ type: 'SELECT_DICE', value: parseInt(e.target.value) })
      );
      wrapper.appendChild(label);
      wrapper.appendChild(select);
      container.appendChild(wrapper);
      return;
    }

    const btn = document.createElement('button');
    btn.textContent = action.label;
    btn.disabled = !action.enabled;
    btn.className = 'btn';
    if (['STOP', 'END'].includes(action.id)) btn.classList.add('btn-danger');
    else if (['CONFIRM', 'GO_JUMP', 'NEXT_HEIGHT'].includes(action.id)) btn.classList.add('btn-success');
    else if (action.id === 'PASS') btn.classList.add('btn-warning');
    else if (['NEXT_ATTEMPT', 'RETRY'].includes(action.id)) btn.classList.add('btn-secondary');
    btn.addEventListener('click', () => handleAction(action.id));
    container.appendChild(btn);
  });
}

function renderLog(log) {
  const container = document.getElementById('log-content');
  container.innerHTML = log.slice(-30).map(l =>
    `<div class="log-entry">${escapeHtml(l)}</div>`
  ).join('');
  container.scrollTop = container.scrollHeight;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ===== Event Listeners =====
document.addEventListener('DOMContentLoaded', () => {
  AudioSystem.init();

  // Start screen: mode buttons
  document.querySelectorAll('#mode-select .btn-mode').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#mode-select .btn-mode').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const mode = btn.dataset.mode;
      const p2Group = document.getElementById('p2-name-group');
      const cpuGroup = document.getElementById('cpu-difficulty-group');
      p2Group.classList.toggle('hidden', mode !== '2p');
      cpuGroup.classList.toggle('hidden', mode !== 'cpu');
    });
  });

  // Start screen: CPU difficulty buttons
  document.querySelectorAll('#cpu-select .btn-mode').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#cpu-select .btn-mode').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // Start game
  document.getElementById('btn-start').addEventListener('click', startGame);

  // Enter key on name inputs starts game
  ['p1-name', 'p2-name'].forEach(id => {
    document.getElementById(id)?.addEventListener('keydown', e => {
      if (e.key === 'Enter') startGame();
    });
  });

  // Next event / next player turn
  document.getElementById('btn-next-event').addEventListener('click', nextTurn);

  // Restart (back to start screen)
  document.getElementById('btn-restart').addEventListener('click', restart);

  // Ranking button on start screen
  document.getElementById('btn-ranking').addEventListener('click', () => {
    renderRankingModal();
    document.getElementById('ranking-modal').classList.remove('hidden');
  });

  // Close ranking modal
  document.getElementById('btn-close-ranking').addEventListener('click', () => {
    document.getElementById('ranking-modal').classList.add('hidden');
  });

  // Clear ranking
  document.getElementById('btn-clear-ranking').addEventListener('click', () => {
    if (confirm('ランキングをリセットしてもいい？')) clearRanking();
  });

  // Click outside modal to close
  document.getElementById('ranking-modal').addEventListener('click', e => {
    if (e.target === e.currentTarget)
      document.getElementById('ranking-modal').classList.add('hidden');
  });

  // Audio: mute toggle
  document.getElementById('btn-mute').addEventListener('click', () => {
    AudioSystem.setMuted(!AudioSystem.isMuted());
  });

  // Audio: volume slider
  document.getElementById('volume-slider').addEventListener('input', e => {
    AudioSystem.setVolume(parseFloat(e.target.value));
  });

  // ===== Dice event delegation (one listener on #dice-container) =====
  document.getElementById('dice-container').addEventListener('click', e => {
    if (!gameState || gameState.phase !== 'playing') return;
    const die = e.target.closest('[data-index]');
    if (!die) return;
    const index = parseInt(die.dataset.index);
    handleAction({ type: 'TOGGLE', index });
  });

  // Initial render (start screen)
  gameState = createInitialState();
  render();
});
