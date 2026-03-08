// ===== Utility Functions =====
function rollDie() { return Math.floor(Math.random() * 6) + 1; }
function rollDice(n) { return Array.from({ length: n }, rollDie); }
function sumDice(arr) { return arr.reduce((a, b) => a + b, 0); }
function scoreMinusSix(arr) { return arr.reduce((a, v) => a + (v === 6 ? -6 : v), 0); }

// ===== Event Icons & List =====
const EVENT_ICONS = {
  'kakekko':   '🏃',
  'tamairi':   '🏀',
  'shouhajou': '🚧',
  'softball':  '⚾',
  'habatobi':  '🦘',
  'relay':     '🏁',
};

// scoreMinusSix を使うイベント（6が出たら残念音）
const MINUS_SIX_EVENTS = new Set(['kakekko', 'relay']);

const EVENTS = [
  window.EventKakekko,
  window.EventTamairi,
  window.EventShouhajou,
  window.EventSoftball,
  window.EventHabatobi,
  window.EventRelay,
];

// ===== Game State =====
let gameState = null;

function createInitialState() {
  return {
    numPlayers: 1,
    players: [],             // { name, eventScores:[], totalScore }
    currentPlayerIndex: 0,
    currentEventIndex: 0,
    eventState: null,
    phase: 'start',          // 'start'|'playing'|'event_result'|'game_over'
    lastResult: null,
  };
}

function currentEvent()  { return EVENTS[gameState.currentEventIndex]; }
function currentPlayer() { return gameState.players[gameState.currentPlayerIndex]; }

// ===== Game Flow =====
function startGame() {
  // 人数
  const numPlayers = parseInt(
    document.querySelector('.btn-numplayer.active')?.dataset.num || '1'
  );

  // プレイヤー名（デフォルト 1P / 2P / 3P）
  const defaultNames = ['1P', '2P', '3P'];
  const names = defaultNames.map((def, i) => {
    const input = document.getElementById(`p${i + 1}-name`);
    return (input && input.value.trim()) ? input.value.trim() : def;
  });

  gameState = createInitialState();
  gameState.numPlayers = numPlayers;
  gameState.players = Array.from({ length: numPlayers }, (_, i) => ({
    name: names[i],
    eventScores: [],
    totalScore: 0,
  }));
  gameState.phase = 'playing';
  initCurrentEvent();

  // 音: unlock → jingle → (少し後に)BGM
  Sound.unlock();
  Sound.playSe('jingle');
  setTimeout(() => Sound.startBgm(), 1700);

  render();
}

function initCurrentEvent() {
  gameState.eventState = currentEvent().init();
}

function handleAction(action) {
  if (gameState.phase !== 'playing') return;

  const ev = currentEvent();
  const type = typeof action === 'string' ? action : action.type;

  // ---- 効果音: アクション種別で鳴らす ----
  if (type === 'ROLL') {
    Sound.playSe('roll');
  } else if (type === 'REROLL') {
    Sound.playSe('reroll');
  } else if (['CONFIRM', 'GO_JUMP', 'ADOPT', 'KEEP'].includes(type)) {
    Sound.playSe('adopt');
  } else if (['SKIP', 'STOP', 'NEXT_ATTEMPT'].includes(type)) {
    Sound.playSe('decide');
  }

  gameState.eventState = ev.applyAction(gameState.eventState, action);

  // ---- 6が出たとき残念音（scoreMinusSix適用イベントのみ） ----
  if ((type === 'ROLL' || type === 'REROLL') && MINUS_SIX_EVENTS.has(ev.id)) {
    const dice = ev.getDiceDisplay(gameState.eventState);
    // kept=false のダイス（今まさに振ったもの）に6があればminus6音
    const currentRoll = dice.filter(d => d.value !== null && !d.kept);
    if (currentRoll.some(d => d.value === 6)) {
      setTimeout(() => Sound.playSe('minus6'), 180);
    }
  }

  // ---- 競技完了判定 ----
  if (ev.isFinished(gameState.eventState)) {
    const result = ev.getResult(gameState.eventState);
    const player = currentPlayer();
    player.eventScores.push(result.points);
    player.totalScore += result.points;
    gameState.phase = 'event_result';
    gameState.lastResult = result;
    Sound.playSe('fanfare');
  }

  render();
}

/**
 * 競技結果画面の「次へ」ボタン
 * ・同一競技に次プレイヤーがいる → そのプレイヤーで同競技
 * ・全員終了 → 次競技へ（or ゲームオーバー）
 */
function advanceGame() {
  const allPlayersFinished =
    gameState.currentPlayerIndex >= gameState.numPlayers - 1;

  if (!allPlayersFinished) {
    // 同じ競技を次のプレイヤーが遊ぶ
    gameState.currentPlayerIndex++;
    gameState.phase = 'playing';
    initCurrentEvent();
  } else {
    // 全員終了 → 次の競技へ
    gameState.currentPlayerIndex = 0;
    gameState.currentEventIndex++;

    if (gameState.currentEventIndex >= EVENTS.length) {
      gameState.phase = 'game_over';
      saveRanking();
      Sound.stopBgm();
      Sound.playSe('gameover');
      setTimeout(() => Sound.startBgm('ending'), 1800);
    } else {
      gameState.phase = 'playing';
      initCurrentEvent();
    }
  }

  render();
}

function restart() {
  Sound.stopBgm();
  gameState = createInitialState();
  render();
}

// ===== Ranking (localStorage) =====
const RANKING_KEY = 'undokai_ranking_v1';

function getRanking() {
  try { return JSON.parse(localStorage.getItem(RANKING_KEY)) || []; }
  catch { return []; }
}

function saveRanking() {
  const ranking = getRanking();
  const date = new Date().toLocaleDateString('ja-JP');
  gameState.players.forEach(p => {
    ranking.push({ name: p.name, score: p.totalScore, date });
  });
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

// ===== Rendering =====
function render() {
  if (!gameState) return;

  const isStart   = gameState.phase === 'start';
  const isPlaying = gameState.phase === 'playing';
  const isResult  = gameState.phase === 'event_result';
  const isOver    = gameState.phase === 'game_over';

  // セクション表示切替
  const sections = {
    'start-screen':  isStart,
    'playing-area':  isPlaying,
    'event-result':  isResult,
    'game-over':     isOver,
  };
  for (const [id, show] of Object.entries(sections)) {
    document.getElementById(id)?.classList.toggle('hidden', !show);
  }

  // サイドバー
  const showSidebars = !isStart;
  document.getElementById('score-table')?.classList.toggle('hidden', !showSidebars);
  document.getElementById('log-area')?.classList.toggle('hidden', !showSidebars);

  // ---- ヘッダー ----
  const eventIdx = Math.min(gameState.currentEventIndex, EVENTS.length - 1);
  const ev = EVENTS[eventIdx];

  document.getElementById('event-name').textContent =
    isOver  ? '🏆 競技終了' :
    isStart ? 'うんどうかい' :
    (EVENT_ICONS[ev.id] || '') + ' ' + ev.name;

  document.getElementById('progress').textContent =
    `${Math.min(gameState.currentEventIndex + 1, EVENTS.length)}/${EVENTS.length}`;

  // 複数プレイヤー時はスコアを並べて表示
  const { players } = gameState;
  if (players.length <= 1) {
    document.getElementById('total-score').textContent =
      `合計: ${players[0]?.totalScore ?? 0}点`;
  } else {
    document.getElementById('total-score').textContent =
      players.map(p => `${escapeHtml(p.name)}:${p.totalScore}`).join(' ／ ');
  }

  if (isStart) return;

  renderScoreTable();

  if (isOver)     renderGameOver();
  else if (isResult)  renderEventResult(ev);
  else if (isPlaying) renderPlaying(ev);
}

// ---- スコアサイドバー ----
function renderScoreTable() {
  const el = document.getElementById('score-table-content');
  if (!el) return;
  const { players, currentEventIndex } = gameState;

  let html = '<table class="score-table-grid"><thead><tr><th>種目</th>';
  players.forEach(p => html += `<th>${escapeHtml(p.name.substring(0, 4))}</th>`);
  html += '</tr></thead><tbody>';

  for (let i = 0; i < EVENTS.length; i++) {
    const ev = EVENTS[i];
    const isCurrent = gameState.phase !== 'game_over' && i === currentEventIndex;
    html += `<tr class="${isCurrent ? 'current-event' : ''}">`;
    html += `<td>${EVENT_ICONS[ev.id] || ''} ${ev.name}</td>`;
    players.forEach(p => {
      const score = p.eventScores[i];
      html += `<td>${score !== undefined ? score : '-'}</td>`;
    });
    html += '</tr>';
  }

  html += '</tbody><tfoot><tr><td>合計</td>';
  players.forEach(p => html += `<td>${p.totalScore}</td>`);
  html += '</tr></tfoot></table>';
  el.innerHTML = html;
}

// ---- ゲームオーバー画面 ----
function renderGameOver() {
  const { players } = gameState;
  const medals = ['🥇', '🥈', '🥉'];

  // 順位付け（同点は同順位）
  const sorted = [...players]
    .map((p, origIdx) => ({ ...p, origIdx }))
    .sort((a, b) => b.totalScore - a.totalScore);

  let rank = 1;
  let rankHtml = '<div class="final-ranking">';
  sorted.forEach((p, i) => {
    if (i > 0 && p.totalScore < sorted[i - 1].totalScore) rank = i + 1;
    rankHtml += `
      <div class="final-rank-row rank-${Math.min(rank, 3)}">
        <span class="final-medal">${medals[rank - 1] || rank + '.'}</span>
        <span class="final-player-name">${escapeHtml(p.name)}</span>
        <span class="final-player-score">${p.totalScore}点</span>
      </div>`;
  });
  rankHtml += '</div>';
  document.getElementById('final-ranking').innerHTML = rankHtml;

  // 種目別スコア表
  let tableHtml = '<table><thead><tr><th>種目</th>';
  players.forEach(p => tableHtml += `<th>${escapeHtml(p.name)}</th>`);
  tableHtml += '</tr></thead><tbody>';

  EVENTS.forEach((ev, i) => {
    tableHtml += `<tr><td>${EVENT_ICONS[ev.id] || ''} ${ev.name}</td>`;
    players.forEach(p => {
      const score = p.eventScores[i];
      tableHtml += `<td>${score !== undefined ? score + '点' : '-'}</td>`;
    });
    tableHtml += '</tr>';
  });

  tableHtml += '</tbody><tfoot><tr><th>合計</th>';
  players.forEach(p => tableHtml += `<th>${p.totalScore}点</th>`);
  tableHtml += '</tr></tfoot></table>';
  document.getElementById('final-scores').innerHTML = tableHtml;

  // ランキング通知
  const ranking = getRanking();
  const notices = players.map(p => {
    const myRank = ranking.findIndex(r => r.name === p.name && r.score === p.totalScore);
    if (myRank === 0) return `${p.name}: 🥇 新記録！`;
    if (myRank >= 0 && myRank < 3) return `${p.name}: 🏅 ${myRank + 1}位！`;
    return null;
  }).filter(Boolean);
  document.getElementById('ranking-notice').textContent = notices.join(' ／ ');
}

// ---- 競技結果画面 ----
function renderEventResult(ev) {
  const result = gameState.lastResult;
  const player = currentPlayer();
  const { currentPlayerIndex, numPlayers, currentEventIndex } = gameState;
  const allPlayersFinished = currentPlayerIndex >= numPlayers - 1;
  const isLastEvent = currentEventIndex >= EVENTS.length - 1;

  document.getElementById('result-event-icon').textContent = EVENT_ICONS[ev.id] || '';
  document.getElementById('result-event-name').textContent = ev.name;

  // プレイヤー名表示（複数時）
  const nameEl = document.getElementById('result-player-name');
  nameEl.textContent = numPlayers > 1 ? `${player.name} の記録` : '';

  document.getElementById('result-points').textContent = `${result.points}点`;
  document.getElementById('result-details').textContent = result.details;
  document.getElementById('total-score-result').textContent =
    `${escapeHtml(player.name)} 合計: ${player.totalScore}点`;

  // 次へボタンのラベル
  let btnText;
  if (!allPlayersFinished) {
    const nextPlayer = gameState.players[currentPlayerIndex + 1];
    btnText = `→ ${escapeHtml(nextPlayer.name)} の番へ`;
  } else if (isLastEvent) {
    btnText = '🏆 最終結果へ';
  } else {
    btnText = '次の種目へ →';
  }
  document.getElementById('btn-next-event').textContent = btnText;
}

// ---- プレイ中画面 ----
function renderPlaying(ev) {
  const s = gameState.eventState;
  const { numPlayers, currentPlayerIndex } = gameState;

  // プレイヤーインジケーター（2人以上のとき）
  const indicator = document.getElementById('player-indicator');
  if (numPlayers > 1) {
    const player = currentPlayer();
    indicator.textContent = `👤 ${player.name} の番`;
    indicator.classList.remove('hidden');
  } else {
    indicator.classList.add('hidden');
  }

  // 競技情報
  document.getElementById('event-icon-display').textContent = EVENT_ICONS[ev.id] || '';
  document.getElementById('event-description').innerHTML =
    (ev.getDescription?.() || []).map(d => `<li>${escapeHtml(d)}</li>`).join('');
  document.getElementById('event-status').textContent =
    ev.getStatusText?.(s) ?? '';

  renderDice(ev.getDiceDisplay(s));
  renderActions(ev.getAvailableActions(s));
  renderLog(s.log || []);
}

// ---- ダイス描画 ----
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
    if (die.kept)      el.classList.add('kept');
    if (die.clickable) el.classList.add('clickable');
    if (die.foulDie)   el.classList.add('foul-die');
    if (die.dim)       el.classList.add('dim');
    el.textContent = (die.value !== null && die.value !== undefined) ? die.value : '·';
    container.appendChild(el);
  });
}

// ---- アクションボタン描画 ----
function renderActions(actions) {
  const container = document.getElementById('action-buttons');
  container.innerHTML = '';

  actions.forEach(action => {
    const btn = document.createElement('button');
    btn.textContent = action.label;
    btn.disabled = !action.enabled;
    btn.className = 'btn';

    if (['STOP', 'END'].includes(action.id))
      btn.classList.add('btn-danger');
    else if (['CONFIRM', 'GO_JUMP', 'KEEP', 'ADOPT'].includes(action.id))
      btn.classList.add('btn-success');
    else if (['SKIP'].includes(action.id))
      btn.classList.add('btn-warning');
    else if (['NEXT_ATTEMPT', 'REROLL'].includes(action.id))
      btn.classList.add('btn-secondary');

    btn.addEventListener('click', () => handleAction(action.id));
    container.appendChild(btn);
  });
}

// ---- ログ描画 ----
function renderLog(log) {
  // サイドバー: 全履歴
  const container = document.getElementById('log-content');
  container.innerHTML = log.slice(-30).map(l =>
    `<div class="log-entry">${escapeHtml(l)}</div>`
  ).join('');
  container.scrollTop = container.scrollHeight;

  // メインログ: 最新1件を大きく表示
  const mainLogEl = document.getElementById('main-log');
  if (mainLogEl) {
    const latest = log[log.length - 1] ?? '';
    mainLogEl.textContent = latest;
    mainLogEl.classList.remove('flash');
    void mainLogEl.offsetWidth; // reflow でアニメーションをリセット
    if (latest) mainLogEl.classList.add('flash');
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ===== Event Listeners =====
document.addEventListener('DOMContentLoaded', () => {

  // ---- スタート画面: 人数選択 ----
  document.querySelectorAll('.btn-numplayer').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.btn-numplayer').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const num = parseInt(btn.dataset.num);
      document.getElementById('p2-name-group').classList.toggle('hidden', num < 2);
      document.getElementById('p3-name-group').classList.toggle('hidden', num < 3);
      Sound.unlock();
      Sound.playSe('decide');
    });
  });

  // ---- スタートボタン ----
  document.getElementById('btn-start').addEventListener('click', startGame);

  // Enterキーでスタート
  ['p1-name', 'p2-name', 'p3-name'].forEach(id => {
    document.getElementById(id)?.addEventListener('keydown', e => {
      if (e.key === 'Enter') startGame();
    });
  });

  // ---- 次へボタン ----
  document.getElementById('btn-next-event').addEventListener('click', advanceGame);

  // ---- リスタート ----
  document.getElementById('btn-restart').addEventListener('click', restart);

  // ---- ランキング ----
  document.getElementById('btn-ranking').addEventListener('click', () => {
    renderRankingModal();
    document.getElementById('ranking-modal').classList.remove('hidden');
  });
  document.getElementById('btn-close-ranking').addEventListener('click', () => {
    document.getElementById('ranking-modal').classList.add('hidden');
  });
  document.getElementById('btn-clear-ranking').addEventListener('click', () => {
    if (confirm('ランキングをリセットしてもいい？')) clearRanking();
  });
  document.getElementById('ranking-modal').addEventListener('click', e => {
    if (e.target === e.currentTarget)
      document.getElementById('ranking-modal').classList.add('hidden');
  });

  // ---- ミュートボタン ----
  document.getElementById('btn-mute').addEventListener('click', () => {
    Sound.unlock();
    const muted = Sound.toggleMute();
    document.getElementById('btn-mute').textContent = muted ? '🔇' : '🔊';
  });

  // ---- ダイスクリック（走り幅跳び・ソフトボール投げ用）----
  document.getElementById('dice-container').addEventListener('click', e => {
    if (!gameState || gameState.phase !== 'playing') return;
    const die = e.target.closest('[data-index]');
    if (!die) return;
    const index = parseInt(die.dataset.index);
    handleAction({ type: 'TOGGLE', index });
  });

  // ---- 初期表示 ----
  gameState = createInitialState();
  render();
});
