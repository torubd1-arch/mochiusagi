// 画面の描画と操作。記録の変更はすべて logic.js の純粋関数を通し、変更のたびに保存する。
import * as L from './logic.js';
import { GRADES, getGrade, cropStyle } from './grades.js';
import * as Storage from './storage.js';

/** ○×入力直後に入力を止める時間（連打で次の参加者の結果まで登録されるのを防ぐ） */
const INPUT_LOCK_MS = 450;

const root = document.getElementById('app');
const live = document.getElementById('live');

const ui = {
  store: L.emptyStore(),
  loadError: null,
  saveFailed: false,
  showSetup: false,
  editing: false,
  locked: false,
  flash: null,
};

const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`);
const defaultDraft = () => ({ count: 1, names: ['', '', '', ''], grade: 12 });

// ───────────── 描画の補助 ─────────────

/** 要素を作る。文字列の子はテキストとして挿入する（HTMLとして解釈しない） */
function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style') el.style.cssText = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'value' || k === 'checked' || k === 'disabled') el[k] = v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  appendChildren(el, children);
  return el;
}

function appendChildren(el, children) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) appendChildren(el, c);
    else if (c instanceof Node) el.append(c);
    else el.append(document.createTextNode(String(c)));
  }
}

function render() {
  const focusKey = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.fk : null;
  root.replaceChildren(currentScreen()());
  if (focusKey) {
    const el = root.querySelector(`[data-fk="${CSS.escape(focusKey)}"]`);
    if (el && !el.disabled) el.focus({ preventScroll: true });
  }
}

function currentScreen() {
  if (ui.loadError) return screenBroken;
  const s = ui.store.session;
  if (!s || ui.showSetup) return screenSetup;
  return s.screen === 'results' ? screenResults : screenPlaying;
}

function announce(text) {
  live.textContent = '';
  setTimeout(() => { live.textContent = text; }, 30);
}

/** ボタンを並べたダイアログ。押したボタンの value（閉じたら null）を返す */
function dialog({ title, lines = [], buttons }) {
  return new Promise((resolve) => {
    const prev = document.activeElement;
    let overlay;
    const close = (v) => {
      overlay.remove();
      if (prev && prev.isConnected && prev.focus) prev.focus({ preventScroll: true });
      resolve(v);
    };
    const btns = buttons.map((b) => h('button', { class: `btn ${b.cls || ''}`, type: 'button', disabled: b.disabled, onclick: () => close(b.value) }, b.label));
    overlay = h(
      'div',
      { class: 'overlay', onclick: (e) => e.target === overlay && close(null) },
      h(
        'div',
        { class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'dlg-title' },
        h('h2', { id: 'dlg-title' }, title),
        lines.filter(Boolean).map((l) => h('p', null, l)),
        h('div', { class: 'dialog-actions' }, btns),
      ),
    );
    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') close(null);
    });
    document.body.append(overlay);
    const first = btns.find((b) => !b.disabled && b.classList.contains('btn-primary')) || btns.find((b) => !b.disabled);
    if (first) first.focus();
  });
}

const confirmDialog = (title, lines, ok, danger = false) =>
  dialog({ title, lines, buttons: [{ label: 'キャンセル', value: false }, { label: ok, value: true, cls: danger ? 'btn-danger' : 'btn-primary' }] });

// ───────────── 状態の更新 ─────────────

function commit(store) {
  ui.store = store;
  ui.saveFailed = !Storage.save(store);
  render();
}

function draft() {
  return ui.store.draft || defaultDraft();
}

function setDraft(patch) {
  ui.store = { ...ui.store, draft: { ...draft(), ...patch } };
  ui.saveFailed = !Storage.save(ui.store);
}

/** 現在の記録から設定を作る（名前・人数・級を引き継ぐ） */
function draftFromSession(s, grade = s.grade) {
  const names = ['', '', '', ''];
  s.players.forEach((p, i) => { names[i] = p.name; });
  return { count: s.players.length, names, grade };
}

function sessionLabel(s) {
  const g = getGrade(s.grade);
  return `${s.grade}級「${g.title}」・${s.players.length}人（${s.players.map((p) => p.name).join('、')}）`;
}

async function startChallenge(d) {
  const old = ui.store.session;
  if (old) {
    const ok = await confirmDialog('新しい挑戦を始めますか？', [
      `現在の記録：${sessionLabel(old)}`,
      'この記録は新しい挑戦で置き換わり、元に戻せません（保存されるのは直近1回だけです）。',
    ], '置き換えて開始', true);
    if (!ok) return;
  }
  const session = L.createSession({ grade: d.grade, names: d.names.slice(0, d.count) }, newId);
  ui.showSetup = false;
  ui.editing = false;
  commit(L.startNew({ ...ui.store, draft: draftFromSession(session) }, session));
  window.scrollTo(0, 0);
  announce(`${d.grade}級の挑戦を開始。最初は${session.players[0].name}さん`);
}

/** ○×・終了の入力。表示中の手番と食い違う入力や、入力ロック中の操作は無視する */
function act(op, expect, message) {
  if (ui.locked) return;
  const before = ui.store;
  const next = L.apply(before, (s) => op(s, expect));
  if (next === before) return;
  ui.locked = true;
  const s = next.session;
  const nextPlayer = L.currentPlayer(s);
  ui.flash = s.screen === 'playing' ? `${message} → 次は ${nextPlayer.name}さん` : message;
  commit(next);
  announce(ui.flash);
  setTimeout(() => {
    ui.locked = false;
    ui.flash = null;
    render();
  }, INPUT_LOCK_MS);
}

function undoLast() {
  if (!L.canUndo(ui.store) || ui.locked) return;
  commit(L.undo(ui.store));
  const s = ui.store.session;
  const p = L.currentPlayer(s);
  announce(p ? `ひとつ戻しました。${p.name}さんの${p.throws.length + 1}投目` : 'ひとつ戻しました');
}

async function correctCell(player, index) {
  const cur = player.throws[index];
  const v = await dialog({
    title: `${player.name}さん ${index + 1}投目を訂正`,
    lines: [`現在の記録：${cur ? '○ 成功' : '× 失敗'}`],
    buttons: [
      { label: 'キャンセル', value: null },
      cur ? { label: '× 失敗に訂正', value: 'x', cls: 'btn-primary' } : { label: '○ 成功に訂正', value: 'o', cls: 'btn-primary' },
    ],
  });
  if (!v) return;
  const wasResults = ui.store.session.screen === 'results';
  commit(L.apply(ui.store, (s) => L.correctThrow(s, player.id, index, v === 'o')));
  const s = ui.store.session;
  if (wasResults && s.screen === 'playing') {
    ui.editing = false;
    render();
    window.scrollTo(0, 0);
    announce(`${player.name}さんの成功が7回未満になったため、挑戦を再開します`);
  } else {
    announce(`${player.name}さん ${index + 1}投目を${v === 'o' ? '○' : '×'}に訂正しました`);
  }
}

function showDiagram(grade) {
  const g = getGrade(grade);
  const prev = document.activeElement;
  let overlay;
  const close = () => {
    overlay.remove();
    if (prev && prev.isConnected && prev.focus) prev.focus({ preventScroll: true });
  };
  const closeBtn = h('button', { class: 'btn btn-primary btn-block btn-lg', type: 'button', onclick: close }, '閉じる');
  overlay = h(
    'div',
    { class: 'overlay overlay-zoom', onclick: (e) => e.target === overlay && close() },
    h(
      'div',
      { class: 'zoom', role: 'dialog', 'aria-modal': 'true', 'aria-label': `${g.grade}級 ${g.title} の配置図` },
      h('h2', null, `${g.grade}級　${g.title}`),
      h('div', { class: 'diagram diagram-zoom', role: 'img', 'aria-label': `${g.grade}級の配置図`, style: cropStyle(g.crop), onclick: close }),
      h('p', { class: 'small' }, g.condition),
      closeBtn,
    ),
  );
  overlay.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });
  document.body.append(overlay);
  closeBtn.focus();
}

// ───────────── 部品 ─────────────

function topbar(...right) {
  return h('header', { class: 'topbar' }, h('h1', null, '川西モルック検定'), right);
}

function saveBanner() {
  if (!ui.saveFailed) return null;
  return h('p', { class: 'banner banner-warn', role: 'status' }, '端末に保存できていません。入力は続けられますが、再読み込みすると記録が消えます。');
}

function diagramButton(grade, compact = false) {
  const g = getGrade(grade);
  return h(
    'button',
    { class: `diagram-btn${compact ? ' compact' : ''}`, type: 'button', onclick: () => showDiagram(grade), 'aria-label': `${g.grade}級の配置図を拡大` },
    h('span', { class: 'diagram', style: cropStyle(g.crop) }),
    h('span', { class: 'diagram-hint' }, 'タップで拡大'),
  );
}

function taskInfo(grade) {
  const g = getGrade(grade);
  return h(
    'div',
    { class: 'task' },
    h('dl', null,
      h('dt', null, '距離'), h('dd', null, g.distance),
      h('dt', null, '成功'), h('dd', null, g.condition),
      h('dt', null, '注記'), h('dd', null, g.notes.join(' ')),
      h('dt', null, '合格'), h('dd', null, `12投中${L.PASS_COUNT}回以上成功`)),
  );
}

function gradeHeading(grade) {
  const g = getGrade(grade);
  return h('h2', { class: 'grade-title' }, h('span', { class: 'grade-num' }, `${g.grade}級`), g.title);
}

/** 参加者ごとの12枠。editable のとき記録済みの枠をタップで訂正できる */
function board(session, { editable }) {
  return h(
    'div',
    { class: 'board' },
    session.players.map((p) => {
      const isCur = p.id === session.currentPlayerId;
      const r = L.playerResult(p);
      const status = r.passed
        ? h('span', { class: 'badge badge-ok' }, p.endedEarly ? '合格・終了' : '合格')
        : (L.isActive(p) ? null : h('span', { class: 'badge badge-ng' }, '不合格'));
      const cells = [];
      for (let i = 0; i < L.MAX_THROWS; i++) {
        const has = i < p.throws.length;
        const v = p.throws[i];
        let mark = '';
        let cls = 'cell';
        let label = `${i + 1}投目 未入力`;
        if (has) {
          mark = v ? '○' : '×';
          cls += v ? ' cell-o' : ' cell-x';
          label = `${i + 1}投目 ${v ? '成功' : '失敗'}`;
        } else if (p.endedEarly) {
          mark = '―';
          cls += ' cell-skip';
          label = `${i + 1}投目 投げない（個別終了）`;
        } else if (isCur && i === p.throws.length) {
          cls += ' cell-next';
          label = `${i + 1}投目 これから投げる`;
        }
        const inner = [h('span', { class: 'cell-no' }, String(i + 1)), h('span', { class: 'cell-mark', 'aria-hidden': 'true' }, mark)];
        if (has && editable) {
          cells.push(h('button', { class: `${cls} cell-btn`, type: 'button', 'aria-label': `${p.name}さん ${label}（タップで訂正）`, onclick: () => correctCell(p, i) }, inner));
        } else {
          cells.push(h('div', { class: cls, role: 'img', 'aria-label': label }, inner));
        }
      }
      return h(
        'section',
        { class: `pboard${isCur ? ' current' : ''}${L.isActive(p) ? '' : ' done'}` },
        h('div', { class: 'pboard-head' },
          h('span', { class: 'pboard-name' }, isCur ? `▶ ${p.name}` : p.name),
          h('span', { class: 'pboard-count' }, `成功${r.success}／${r.thrown}投`),
          status),
        h('div', { class: 'cells' }, cells),
      );
    }),
  );
}

// ───────────── 画面：開始設定 ─────────────

function screenSetup() {
  const d = draft();
  const session = ui.store.session;
  const g = getGrade(d.grade);

  const countBtns = h('div', { class: 'count-btns', role: 'radiogroup', 'aria-label': '参加人数' },
    [1, 2, 3, 4].map((n) => h('button', {
      class: `count-btn${d.count === n ? ' on' : ''}`, type: 'button', role: 'radio', 'aria-checked': d.count === n ? 'true' : 'false', 'data-fk': `count-${n}`,
      onclick: () => { setDraft({ count: n }); render(); },
    }, `${n}人`)));

  const nameFields = h('div', { class: 'stack-sm' },
    d.names.slice(0, d.count).map((name, i) => h('label', { class: 'field' },
      h('span', null, `${i + 1}番目に投げる人`),
      h('input', {
        type: 'text', value: name, maxlength: String(L.NAME_MAX), placeholder: `プレイヤー${i + 1}`, autocomplete: 'off', enterkeyhint: 'done',
        oninput: (e) => { const names = draft().names.slice(); names[i] = e.target.value; setDraft({ names }); },
      }))));

  const gradeList = h('div', { class: 'grade-list', role: 'radiogroup', 'aria-label': '挑戦する級' },
    GRADES.map((x) => h('button', {
      class: `grade-btn${d.grade === x.grade ? ' on' : ''}`, type: 'button', role: 'radio', 'aria-checked': d.grade === x.grade ? 'true' : 'false', 'data-fk': `grade-${x.grade}`,
      onclick: () => { setDraft({ grade: x.grade }); render(); },
    }, h('span', { class: 'grade-num' }, `${x.grade}級`), h('span', null, x.title))));

  return h('main', { class: 'stack' },
    topbar(session ? h('button', { class: 'btn btn-sm', type: 'button', onclick: () => { ui.showSetup = false; render(); } }, '記録に戻る') : null),
    !session ? h('p', { class: 'lead' }, 'お題の配置図を見ながら、1〜4人の投球結果（○×）を記録します。') : null,
    saveBanner(),
    session ? h('p', { class: 'banner banner-info' }, `記録中：${sessionLabel(session)}。新しく開始すると、この記録は置き換わります。`) : null,
    h('section', { class: 'card stack-sm' }, h('h2', null, '1. 人数'), countBtns),
    h('section', { class: 'card stack-sm' }, h('h2', null, '2. 名前'), h('p', { class: 'small muted' }, '投げる順に入力（20文字まで）。空欄は「プレイヤー1」などになります。'), nameFields),
    h('section', { class: 'card stack-sm' }, h('h2', null, '3. 挑戦する級（全員共通）'), gradeList),
    h('section', { class: 'card stack-sm' }, h('h2', null, '4. お題の確認'), gradeHeading(g.grade), diagramButton(g.grade), taskInfo(g.grade)),
    h('button', { class: 'btn btn-primary btn-lg btn-block', type: 'button', onclick: () => startChallenge(draft()) }, `${g.grade}級の挑戦を開始`),
    footer(),
  );
}

// ───────────── 画面：記録 ─────────────

function screenPlaying() {
  const s = ui.store.session;
  const p = L.currentPlayer(s);
  const success = L.successCount(p);
  const expect = { playerId: p.id, count: p.throws.length };
  const locked = ui.locked;
  const no = p.throws.length + 1;

  const openSetup = () => {
    ui.store = { ...ui.store, draft: draftFromSession(s) };
    ui.showSetup = true;
    render();
    window.scrollTo(0, 0);
  };

  return h('main', { class: 'stack' },
    topbar(h('button', { class: 'btn btn-sm', type: 'button', onclick: openSetup }, '人数・級の変更')),
    saveBanner(),
    gradeHeading(s.grade),
    diagramButton(s.grade, true),
    taskInfo(s.grade),
    h('section', { class: 'turn', 'aria-live': 'polite' },
      h('div', { class: 'turn-who' }, `${p.name}さん`),
      h('div', { class: 'turn-no' }, h('strong', null, `${no}投目`), `／${L.MAX_THROWS}投`),
      h('div', { class: 'turn-stat' }, `成功${success}回　`,
        L.isPassed(p) ? h('span', { class: 'pass' }, '合格！') : h('span', null, `合格まであと${L.remainingToPass(p)}回`))),
    ui.flash ? h('p', { class: 'flash', role: 'status' }, ui.flash) : null,
    h('div', { class: 'ox' },
      h('button', { class: 'ox-btn ox-o', type: 'button', disabled: locked, onclick: () => act((st, e) => L.recordThrow(st, true, e), expect, `${p.name}さん ${no}投目 ○`) },
        h('span', { class: 'ox-mark', 'aria-hidden': 'true' }, '○'), '成功'),
      h('button', { class: 'ox-btn ox-x', type: 'button', disabled: locked, onclick: () => act((st, e) => L.recordThrow(st, false, e), expect, `${p.name}さん ${no}投目 ×`) },
        h('span', { class: 'ox-mark', 'aria-hidden': 'true' }, '×'), '失敗')),
    L.canEndEarly(s)
      ? h('button', { class: 'btn btn-block btn-end', type: 'button', disabled: locked, onclick: () => endPlayer(p, expect) },
        `${p.name}さんの挑戦を終了（合格）`, h('span', { class: 'hint' }, '続ける場合は○×を入力'))
      : null,
    h('div', { class: 'row' },
      h('h2', { class: 'grow' }, '記録'),
      h('button', { class: 'btn btn-sm', type: 'button', disabled: !L.canUndo(ui.store) || locked, onclick: undoLast, 'data-fk': 'undo' }, '↶ ひとつ戻す')),
    h('p', { class: 'small muted' }, '記録済みの○×をタップすると訂正できます。'),
    board(s, { editable: !locked }),
    footer(),
  );
}

function endPlayer(p, expect) {
  act((s, e) => L.endEarly(s, e), expect, `${p.name}さんの挑戦を終了（成功${L.successCount(p)}回／${p.throws.length}投）`);
}

// ───────────── 画面：結果 ─────────────

function screenResults() {
  const s = ui.store.session;
  const g = getGrade(s.grade);

  const again = async () => {
    const ok = await confirmDialog('同じメンバー・同じ級でもう一度', [
      `${sessionLabel(s)} で記録を初期化して始めます。`,
      '今の結果は置き換わり、元に戻せません。',
    ], '置き換えて開始', true);
    if (!ok) return;
    const session = L.createSession({ grade: s.grade, names: s.players.map((p) => p.name) }, newId);
    ui.editing = false;
    commit(L.startNew(ui.store, session));
    window.scrollTo(0, 0);
  };
  const changeGrade = () => {
    ui.store = { ...ui.store, draft: draftFromSession(s) };
    ui.showSetup = true;
    ui.editing = false;
    render();
    window.scrollTo(0, 0);
  };

  return h('main', { class: 'stack' },
    topbar(),
    saveBanner(),
    h('h2', { class: 'results-title' }, `結果　${g.grade}級「${g.title}」`),
    h('div', { class: 'stack-sm' },
      s.players.map((p) => {
        const r = L.playerResult(p);
        return h('div', { class: `result-row ${r.passed ? 'ok' : 'ng'}` },
          h('div', { class: 'result-name' }, `${p.name}さん`, h('span', { class: 'result-grade' }, `${s.grade}級`)),
          h('div', { class: 'result-detail' },
            `成功${r.success}回／${r.thrown}投　`,
            h('strong', null, r.passed ? '合格' : '不合格'),
            `・${r.reason}`));
      })),
    h('p', { class: 'small muted' }, '合格表示は入力された結果の集計です。検定の申請・認定は主催者（川西モルックの会）へ。'),
    h('div', { class: 'row' },
      h('h2', { class: 'grow' }, '記録'),
      h('button', { class: `btn btn-sm${ui.editing ? ' btn-primary' : ''}`, type: 'button', 'aria-pressed': ui.editing ? 'true' : 'false', onclick: () => { ui.editing = !ui.editing; render(); }, 'data-fk': 'edit' },
        ui.editing ? '訂正を終える' : '記録を訂正'),
      h('button', { class: 'btn btn-sm', type: 'button', disabled: !L.canUndo(ui.store), onclick: undoLast, 'data-fk': 'undo' }, '↶ ひとつ戻す')),
    ui.editing ? h('p', { class: 'banner banner-info' }, '訂正する○×をタップしてください。') : null,
    board(s, { editable: ui.editing }),
    h('div', { class: 'stack-sm' },
      h('button', { class: 'btn btn-primary btn-lg btn-block', type: 'button', onclick: again }, '同じメンバー・同じ級でもう一度'),
      h('button', { class: 'btn btn-block', type: 'button', onclick: changeGrade }, '級を変えて挑戦'),
      h('p', { class: 'small muted center' }, '新しい挑戦を始めると、この記録は置き換わります（保存されるのは直近1回だけ）。')),
    footer(),
  );
}

// ───────────── 画面：保存データ破損 ─────────────

function screenBroken() {
  const reset = async () => {
    const ok = await confirmDialog('保存データを初期化しますか？', ['読み込めなかった記録は削除されます。'], '初期化する', true);
    if (!ok) return;
    Storage.clear();
    ui.loadError = null;
    commit(L.emptyStore());
  };
  return h('main', { class: 'stack' },
    topbar(),
    h('div', { class: 'banner banner-error', role: 'alert' },
      '保存されていた記録を読み込めませんでした。',
      h('p', null, `理由：${ui.loadError}`),
      h('p', null, '初期化すると、新しい挑戦を始められます。')),
    h('button', { class: 'btn btn-danger btn-lg btn-block', type: 'button', onclick: reset }, '初期化して始める'),
  );
}

function footer() {
  return h('footer', { class: 'foot' },
    h('p', null, 'お題の出典：川西モルックの会「川西モルック検定」資料。配置図は資料からの切り出しです。'),
    h('p', null, h('a', { href: '../index.html' }, 'もちうさぎ ゲームス トップへ')));
}

// ───────────── 起動 ─────────────

function init() {
  const r = Storage.load();
  ui.store = r.store;
  if (r.error) ui.loadError = r.error;
  if (r.unavailable) ui.saveFailed = true;
  render();
}

init();
