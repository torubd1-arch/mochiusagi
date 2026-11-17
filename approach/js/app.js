// 画面の描画と操作
import {
  ALL_DISTANCES, CLUBS, MODE_LABELS, RESULT_LABELS, MISS_LABELS, MISS_TYPES_FOR,
  toggleDistance, validateSettings, createSession, currentShot, recordShot, undoShot,
  isFinished, completeSession, abortSession, summarize, summarizeByDistance, summarizeByClub,
  overallShots, completedSessions, sortHistory, recentTrend, deleteSession, formatRate, distancesLabel,
  formatDateTime, createTapGuard,
} from './logic.js';
import { loadAll, saveSettings, saveActive, saveHistory, clearActive, archiveSession } from './store.js';

const $ = (id) => document.getElementById(id);

const state = {
  settings: null,
  history: [],
  active: null,
  /** ミス原因選択中の判定（'near' / 'failure'）。判定入力中は null */
  pendingResult: null,
  /** 直前に終えたセッション（結果画面の見出しを「今回の結果」にする） */
  lastFinishedId: null,
};

// 練習中の判定・ミス原因・1球戻るに共通のガード（二重タップで2球記録しない）
const tapGuard = createTapGuard(450);

// ---- 共通 ----

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'style') node.setAttribute('style', v);
    else node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c === null || c === undefined || c === false) continue;
    node.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

function showError(message) {
  $('errorText').textContent = message;
  $('errorBar').hidden = false;
}

function hideError() {
  $('errorBar').hidden = true;
}

function saveFailed(what) {
  showError(`${what}を保存できませんでした。ストレージの空き容量やプライベートブラウズを確認してください。`);
}

function showView(name) {
  for (const v of ['home', 'play', 'result', 'history']) $(`${v}View`).hidden = v !== name;
}

// ---- ルーティング ----

function route() {
  if (state.active) {
    showView('play');
    renderPlay();
    return;
  }
  const hash = location.hash;
  const m = hash.match(/^#\/session\/(.+)$/);
  if (m) {
    const session = state.history.find((s) => s.id === decodeURIComponent(m[1]));
    if (session) {
      showView('result');
      renderResult(session);
      $('resultView').scrollTop = 0;
      return;
    }
  }
  if (hash === '#/history') {
    showView('history');
    renderHistory();
    return;
  }
  showView('home');
  renderHome();
}

function go(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}

// ---- 画面1：ホーム・練習設定 ----

function updateSettings(patch) {
  // ボタンからの値だけが来るので、そのまま合成する（ランダム距離0〜1個の選択途中も保持する）
  state.settings = { ...state.settings, ...patch };
  if (!saveSettings(state.settings).ok) saveFailed('練習設定');
  renderHome();
}

function setPressed(container, attr, value) {
  for (const b of container.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset[attr] === String(value)));
}

function renderHome() {
  const s = state.settings;
  setPressed($('modeSeg'), 'mode', s.mode);
  setPressed($('countSeg'), 'count', s.totalShots);
  setPressed($('clubSeg'), 'club', s.club);

  const grid = $('distGrid');
  for (const b of grid.querySelectorAll('button')) {
    const d = Number(b.dataset.dist);
    const on = s.mode === 'random' ? s.randomDistances.includes(d) : s.fixedDistance === d;
    b.setAttribute('aria-pressed', String(on));
  }
  $('distanceHint').textContent = s.mode === 'random'
    ? `（2つ以上選択・${s.randomDistances.length}個選択中）`
    : '（1つ選択）';

  const error = validateSettings(s);
  $('startError').textContent = error ?? '';
  $('startError').hidden = !error;
  $('startBtn').disabled = Boolean(error);
}

function buildHome() {
  const clubSeg = $('clubSeg');
  for (const c of CLUBS) {
    clubSeg.append(el('button', { type: 'button', 'data-club': c.id }, [c.id, el('small', { text: `${c.loft}°` })]));
  }
  const grid = $('distGrid');
  for (const d of ALL_DISTANCES) {
    grid.append(el('button', { type: 'button', 'data-dist': String(d) }, [String(d), el('small', { text: 'yd' })]));
  }

  $('modeSeg').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) updateSettings({ mode: b.dataset.mode });
  });
  $('countSeg').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) updateSettings({ totalShots: Number(b.dataset.count) });
  });
  clubSeg.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) updateSettings({ club: b.dataset.club });
  });
  grid.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const d = Number(b.dataset.dist);
    if (state.settings.mode === 'random') updateSettings({ randomDistances: toggleDistance(state.settings.randomDistances, d) });
    else updateSettings({ fixedDistance: d });
  });

  $('startBtn').addEventListener('click', startPractice);
}

function startPractice() {
  if (state.active || validateSettings(state.settings)) return;
  const session = createSession(state.settings);
  if (!saveActive(session).ok) {
    saveFailed('練習データ');
    return;
  }
  hideError();
  state.active = session;
  state.pendingResult = null;
  route();
}

// ---- 画面2・3：練習中 ----

function renderPlay() {
  const session = state.active;
  const shot = currentShot(session);
  if (!shot) return;
  $('shotNo').textContent = String(shot.shotNumber);
  $('shotTotal').textContent = String(session.totalShots);
  $('progressBar').style.width = `${(session.shots.length / session.totalShots) * 100}%`;
  $('targetDist').textContent = String(shot.targetDistance);
  $('targetClub').textContent = shot.club;

  const pending = state.pendingResult;
  $('judgePanel').hidden = Boolean(pending);
  $('missPanel').hidden = !pending;
  if (pending) {
    $('missTarget').textContent = `${shot.targetDistance}yd / ${shot.club}`;
    $('missResult').textContent = RESULT_LABELS[pending];
    $('missResult').className = `miss-result ${pending}`;
    const box = $('missBtns');
    box.replaceChildren(...MISS_TYPES_FOR[pending].map((t) => el('button', {
      type: 'button', class: t === 'top' ? 'top' : '', 'data-miss': t, text: MISS_LABELS[t],
    })));
  }

  const last = session.shots[session.shots.length - 1];
  $('undoBtn').disabled = !last || Boolean(pending);
  $('lastShot').textContent = last
    ? `前の球：${last.targetDistance}yd ${RESULT_LABELS[last.result]}${last.missType ? `（${MISS_LABELS[last.missType]}）` : ''}`
    : '';
}

function commitShot(result, missType) {
  const next = recordShot(state.active, result, missType);
  if (isFinished(next)) {
    const done = completeSession(next);
    const r = archiveSession(done, state.history);
    if (!r.ok) {
      saveFailed('練習結果');
      return;
    }
    if (r.clearError) saveFailed('練習中データの削除');
    else hideError();
    state.history = r.history;
    state.active = null;
    state.pendingResult = null;
    state.lastFinishedId = done.id;
    go(`#/session/${encodeURIComponent(done.id)}`);
    return;
  }
  if (!saveActive(next).ok) {
    // 保存できなかった球は記録済みにしない（画面も進めない）
    saveFailed('打球結果');
    return;
  }
  hideError();
  state.active = next;
  state.pendingResult = null;
  renderPlay();
}

function buildPlay() {
  document.querySelector('.judge-btns').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || !state.active || state.pendingResult || !tapGuard.tryAcquire()) return;
    const result = b.dataset.result;
    if (result === 'success') {
      commitShot('success', null);
    } else {
      state.pendingResult = result;
      renderPlay();
    }
  });

  $('missBtns').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || !state.active || !state.pendingResult || !tapGuard.tryAcquire()) return;
    commitShot(state.pendingResult, b.dataset.miss);
  });

  $('missBack').addEventListener('click', () => {
    if (!state.active) return;
    state.pendingResult = null;
    renderPlay();
  });

  $('undoBtn').addEventListener('click', () => {
    if (!state.active || state.pendingResult || !state.active.shots.length || !tapGuard.tryAcquire()) return;
    const prev = undoShot(state.active);
    if (!saveActive(prev).ok) {
      saveFailed('取り消し');
      return;
    }
    hideError();
    state.active = prev;
    renderPlay();
  });

  $('quitBtn').addEventListener('click', quitPractice);
}

function quitPractice() {
  const session = state.active;
  if (!session) return;
  const n = session.shots.length;
  const message = n
    ? `練習を終了しますか？\n打球済みの${n}球は「途中終了」として履歴に残ります（全体集計には含めません）。`
    : '練習を終了しますか？\nまだ1球も記録していないため、履歴には残りません。';
  if (!window.confirm(message)) return;

  if (!n) {
    if (!clearActive().ok) {
      saveFailed('練習の終了');
      return;
    }
    state.active = null;
    state.pendingResult = null;
    go('#/');
    return;
  }
  const aborted = abortSession(session);
  const r = archiveSession(aborted, state.history);
  if (!r.ok) {
    saveFailed('途中終了の記録');
    return;
  }
  if (r.clearError) saveFailed('練習中データの削除');
  else hideError();
  state.history = r.history;
  state.active = null;
  state.pendingResult = null;
  state.lastFinishedId = aborted.id;
  go(`#/session/${encodeURIComponent(aborted.id)}`);
}

// ---- 画面4：結果 ----

function rateCards(sum) {
  return el('div', { class: 'big-rates' }, [
    el('div', { class: 'big-rate' }, [el('span', { text: '成功率' }), el('strong', { text: formatRate(sum.successRate) })]),
    el('div', { class: 'big-rate top' }, [el('span', { text: 'トップ率' }), el('strong', { text: formatRate(sum.topRate) })]),
  ]);
}

function distanceTable(shots) {
  const rows = summarizeByDistance(shots);
  if (!rows.length) return el('p', { class: 'empty', text: '記録がありません' });
  return el('table', {}, [
    el('thead', {}, el('tr', {}, ['距離', '球数', '○/△/×', '成功率', 'トップ率'].map((h) => el('th', { text: h })))),
    el('tbody', {}, rows.map((r) => el('tr', {}, [
      el('td', { text: `${r.distance}yd` }),
      el('td', { text: String(r.total) }),
      el('td', { text: `${r.success}/${r.near}/${r.failure}` }),
      el('td', { text: formatRate(r.successRate) }),
      el('td', { text: formatRate(r.topRate) }),
    ]))),
  ]);
}

function clubTable(shots) {
  return el('table', {}, [
    el('thead', {}, el('tr', {}, ['クラブ', '球数', '成功率', 'トップ率'].map((h) => el('th', { text: h })))),
    el('tbody', {}, summarizeByClub(shots).map((r) => {
      const loft = CLUBS.find((c) => c.id === r.club)?.loft;
      return el('tr', {}, [
        el('td', { text: `${r.club}（${loft}°）` }),
        el('td', { text: String(r.total) }),
        el('td', { text: formatRate(r.successRate) }),
        el('td', { text: formatRate(r.topRate) }),
      ]);
    })),
  ]);
}

function renderResult(session) {
  const sum = summarize(session.shots);
  const aborted = session.status === 'aborted';
  const justFinished = session.id === state.lastFinishedId;
  $('resultTitle').textContent = justFinished ? '今回の結果' : '練習結果';

  const head = el('div', { class: 'card' }, [
    el('h2', {}, [
      `${sum.total}球 / ${session.club} / ${MODE_LABELS[session.mode]}`,
      aborted ? el('span', { class: 'badge', text: '途中終了' }) : null,
    ]),
    el('p', { class: 'meta', text: `練習日時：${formatDateTime(session.startedAt)}` }),
    el('p', { class: 'meta', text: `使用クラブ：${session.club}　設定距離：${distancesLabel(session.selectedDistances)}` }),
    el('p', { class: 'meta', text: `総打球数：${sum.total}球${aborted ? `（予定 ${session.totalShots}球）` : ''}` }),
    aborted ? el('p', { class: 'meta', text: '打球済み分だけの参考成績です。全体集計には含めません。' }) : null,
    rateCards(sum),
    el('div', { class: 'counts' }, [
      el('div', { class: 'c-success' }, [el('b', { text: String(sum.success) }), '○ 成功']),
      el('div', { class: 'c-near' }, [el('b', { text: String(sum.near) }), '△ 惜しい']),
      el('div', { class: 'c-failure' }, [el('b', { text: String(sum.failure) }), '× 失敗']),
    ]),
    el('p', { class: 'meta', style: 'margin-top:10px', text: `トップ数：${sum.top}球（${formatRate(sum.topRate)}）　その他ミス率：${formatRate(sum.otherMissRate)}` }),
  ]);

  $('resultBody').replaceChildren(
    head,
    el('div', { class: 'card' }, [el('h2', { text: `距離別（${session.club}）` }), distanceTable(session.shots)]),
  );
  $('deleteBtn').dataset.id = session.id;
}

function buildResult() {
  $('deleteBtn').addEventListener('click', () => {
    const id = $('deleteBtn').dataset.id;
    const session = state.history.find((s) => s.id === id);
    if (!session) return;
    if (!window.confirm(`${formatDateTime(session.startedAt)} の記録を削除しますか？\n削除すると元に戻せません。`)) return;
    const next = deleteSession(state.history, id);
    if (!saveHistory(next).ok) {
      saveFailed('削除');
      return;
    }
    hideError();
    state.history = next;
    go('#/history');
  });
}

// ---- 画面4：履歴・成績推移 ----

function bar(value, cls = '') {
  const w = value === null ? 0 : Math.max(0, Math.min(100, value));
  return el('div', { class: `bar ${cls}` }, el('i', { style: `width:${w}%` }));
}

function renderHistory() {
  const body = $('historyBody');
  if (!state.history.length) {
    body.replaceChildren(el('p', { class: 'empty', text: 'まだ練習記録がありません' }));
    return;
  }
  const shots = overallShots(state.history);
  const all = summarize(shots);
  const completedCount = completedSessions(state.history).length;

  const overall = el('div', { class: 'card' }, [
    el('h2', { text: '全体の成績' }),
    el('p', { class: 'meta', text: `完了した練習 ${completedCount}回・${all.total}球（途中終了は含めません）` }),
    rateCards(all),
  ]);

  const trend = recentTrend(state.history, 10);
  const trendCard = el('div', { class: 'card' }, [
    el('h2', { text: '成績推移（直近10回）' }),
    trend.length
      ? el('table', {}, [
        el('thead', {}, el('tr', {}, ['日付', '成功率', 'トップ率', ''].map((h) => el('th', { text: h })))),
        el('tbody', {}, trend.map((t) => el('tr', {}, [
          el('td', { text: formatDateTime(t.startedAt).slice(5) }),
          el('td', { text: formatRate(t.successRate) }),
          el('td', { text: formatRate(t.topRate) }),
          el('td', { class: 'bar-cell' }, [bar(t.successRate), bar(t.topRate, 'top')]),
        ]))),
      ])
      : el('p', { class: 'empty', text: '完了した練習がありません' }),
  ]);

  const list = el('ul', { class: 'history-list' }, sortHistory(state.history).map((s) => {
    const sum = summarize(s.shots);
    return el('li', {}, el('a', { class: 'history-item', href: `#/session/${encodeURIComponent(s.id)}` }, [
      el('div', { class: 'h-main' }, [
        el('div', { class: 'h-date' }, [formatDateTime(s.startedAt), s.status === 'aborted' ? el('span', { class: 'badge', text: '途中終了' }) : null]),
        el('div', { class: 'h-sub', text: `${MODE_LABELS[s.mode]} / ${s.club} / ${sum.total}球` }),
      ]),
      el('div', { class: 'h-rates' }, [
        el('div', {}, ['成功 ', el('b', { text: formatRate(sum.successRate) })]),
        el('div', {}, ['トップ ', el('b', { text: formatRate(sum.topRate) })]),
      ]),
      el('span', { class: 'h-arrow', text: '›' }),
    ]));
  }));

  body.replaceChildren(
    overall,
    trendCard,
    el('div', { class: 'card' }, [el('h2', { text: '距離別（全体）' }), distanceTable(shots)]),
    el('div', { class: 'card' }, [el('h2', { text: 'クラブ別（全体）' }), clubTable(shots)]),
    el('div', { class: 'card' }, [el('h2', { text: '練習履歴' }), list]),
  );
}

// ---- 起動 ----

function init() {
  const loaded = loadAll();
  state.settings = loaded.settings;
  state.history = loaded.history;
  state.active = loaded.active;
  if (loaded.errors.length) showError('保存データの一部を読み込めませんでした。読めなかったデータは別名で端末に残しています。');

  buildHome();
  buildPlay();
  buildResult();
  $('errorClose').addEventListener('click', hideError);
  window.addEventListener('hashchange', route);
  route();

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

init();
