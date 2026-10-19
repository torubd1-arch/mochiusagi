// 画面の描画と操作。記録の変更はすべてservice.jsを経由する。
import * as L from './logic.js';
import * as Setup from './setup.js';
import * as Svc from './service.js';
import * as B from './backup.js';
import * as F from './format.js';
import { IdbStore, MemoryStore, describeStorageError } from './store.js';

const APP_VERSION = '1.1.1';
const RULES_CHECKED = '2026-10-19';

// 投擲者から見た初期配置（画面上が奥）。x はボタン中心の横位置（単位間隔）
const PIN_LAYOUT = [
  [[7, -1], [9, 0], [8, 1]],
  [[5, -1.5], [11, -0.5], [12, 0.5], [6, 1.5]],
  [[3, -1], [10, 0], [4, 1]],
  [[1, -0.5], [2, 0.5]],
];

const root = document.getElementById('app');
const live = document.getElementById('live');

const ui = {
  screen: 'loading',
  store: null,
  storageWarning: null,
  activeSession: null,
  draft: null,
  order: null,
  ctl: null,
  selected: new Set(),
  restoredType: null,
  notice: null,
  saveError: null,
  endBundle: null,
  historyData: null,
  view: null,
  swReg: null,
  swWaiting: null,
  applyingUpdate: false,
  busy: false,
};

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
  const view = (SCREENS[ui.screen] || screenHome)();
  root.replaceChildren(view);
  if (focusKey) {
    const el = root.querySelector(`[data-fk="${CSS.escape(focusKey)}"]`);
    if (el && !el.disabled) el.focus({ preventScroll: true });
  }
}

function go(screen) {
  ui.screen = screen;
  render();
  window.scrollTo(0, 0);
}

function announce(text) {
  live.textContent = '';
  setTimeout(() => {
    live.textContent = text;
  }, 30);
}

function teamColor(index) {
  return `--team-color: var(--team-${index % 4})`;
}

/** 確認ダイアログ。lines は文字列か {text, cls} */
function dialog({ title, lines = [], ok = 'OK', cancel = 'キャンセル', danger = false }) {
  return new Promise((resolve) => {
    const prev = document.activeElement;
    let overlay;
    const close = (v) => {
      overlay.remove();
      if (prev && prev.isConnected && prev.focus) prev.focus();
      resolve(v);
    };
    const okBtn = h('button', { class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, type: 'button', onclick: () => close(true) }, ok);
    overlay = h(
      'div',
      { class: 'overlay', onclick: (e) => e.target === overlay && close(false) },
      h(
        'div',
        { class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'dlg-title' },
        h('h2', { id: 'dlg-title' }, title),
        lines.filter(Boolean).map((l) => (typeof l === 'string' ? h('p', null, l) : h('p', { class: l.cls }, l.text))),
        h('div', { class: 'dialog-actions' }, cancel && h('button', { class: 'btn', type: 'button', onclick: () => close(false) }, cancel), okBtn),
      ),
    );
    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') close(false);
    });
    document.body.append(overlay);
    okBtn.focus();
  });
}

function alertDialog(title, lines) {
  return dialog({ title, lines, cancel: null, ok: '閉じる' });
}

function download(filename, text, mime) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename, style: 'display:none' });
  document.body.append(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 1000);
}

function topbar(title, ...right) {
  return h('header', { class: 'topbar' }, h('h1', null, title), ...right);
}

function backButton(label, onclick) {
  return h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick }, `← ${label}`);
}

function updateBanner() {
  if (!ui.swWaiting) return null;
  return h(
    'div',
    { class: 'banner banner-info' },
    'アプリの新しい版があります。',
    h('div', { class: 'row', style: 'margin-top:6px' },
      h('button', { class: 'btn btn-sm btn-primary', type: 'button', onclick: applyUpdate }, '更新する'),
      h('span', { class: 'small muted' }, '記録は消えません'),
    ),
  );
}

function storageWarningBanner() {
  return ui.storageWarning ? h('div', { class: 'banner banner-error' }, ui.storageWarning) : null;
}

/** 保存処理を行い、失敗時はダイアログで知らせる */
async function guarded(fn) {
  if (ui.busy) return undefined;
  ui.busy = true;
  try {
    return await fn();
  } catch (e) {
    console.error(e);
    await alertDialog('操作できませんでした', [e instanceof Svc.ServiceError ? e.message : describeStorageError(e)]);
    return undefined;
  } finally {
    ui.busy = false;
  }
}

// ───────────── ホーム ─────────────

function screenHome() {
  const s = ui.activeSession;
  return h(
    'main',
    { class: 'stack' },
    h('div', { class: 'home-hero' },
      h('img', { class: 'hero-img', src: 'img/hero.jpg', width: '720', height: '720', alt: '7・12・1の番号が付いたスキットルとモルック' }),
      h('h1', { class: 'hero-title' }, 'モルとも'),
      h('p', { class: 'hero-sub' }, 'モルック計算ツール'),
    ),
    storageWarningBanner(),
    updateBanner(),
    s &&
      h(
        'section',
        { class: 'card card-accent stack' },
        h('div', null, h('span', { class: 'badge badge-ok' }, '進行中'), ' ', h('strong', null, s.name)),
        h('p', { class: 'small' }, s.teams.map((t) => t.name).join('・'), `／第${s.gameIds.length}ゲーム`),
        h('button', { class: 'btn btn-primary btn-lg btn-block', type: 'button', onclick: resumeActive }, '進行中の対戦を再開'),
      ),
    h('button', { class: `btn btn-lg btn-block ${s ? '' : 'btn-primary'}`, type: 'button', onclick: startNewSession }, '新しい対戦'),
    h('button', { class: 'btn btn-block', type: 'button', onclick: openHistory }, '過去の記録'),
    h('button', { class: 'btn btn-block', type: 'button', onclick: () => go('settings') }, '設定・バックアップ・ルール'),
    h('p', { class: 'small muted center' }, '記録はこの端末のブラウザ内に保存されます。', h('br'), `Ver.${APP_VERSION}`),
  );
}

async function refreshActive() {
  ui.activeSession = await Svc.findActiveSession(ui.store);
}

async function goHome() {
  ui.ctl = null;
  ui.notice = null;
  ui.saveError = null;
  await refreshActive();
  go('home');
}

async function startNewSession() {
  await refreshActive();
  const s = ui.activeSession;
  if (s) {
    const ok = await dialog({
      title: '進行中の対戦があります',
      lines: [
        `「${s.name}」が進行中です。1台で同時に進行できる対戦は1つです。`,
        '新しい対戦を始めるには、進行中の対戦を終了します。進行中のゲームは中断扱いになり、完了したゲームの記録は残ります。',
      ],
      ok: '終了して新規作成',
      danger: true,
    });
    if (!ok) return;
    const done = await guarded(async () => {
      await Svc.endSession(ui.store, s);
      return true;
    });
    if (!done) return;
    ui.activeSession = null;
  }
  ui.draft = Setup.createDraft(Svc.newId);
  go('setup');
}

async function resumeActive() {
  await guarded(async () => {
    await refreshActive();
    const s = ui.activeSession;
    if (!s) {
      render();
      return;
    }
    const bundle = await Svc.loadSessionBundle(ui.store, s.id);
    const game = bundle.games[bundle.games.length - 1];
    ui.ctl = new Svc.GameController(ui.store, bundle.session, game, bundle.throwsByGame[game.id]);
    ui.selected = new Set();
    ui.restoredType = null;
    ui.notice = null;
    if (game.status === 'completed') await openGameEnd();
    else go('play');
  });
}

// ───────────── 対戦設定 ─────────────

function screenSetup() {
  const d = ui.draft;
  return h(
    'main',
    { class: 'stack' },
    topbar('新しい対戦', backButton('ホーム', goHome)),
    h('label', { class: 'field' }, '対戦名（任意）',
      h('input', {
        type: 'text', value: d.name, maxlength: 40, placeholder: '空欄なら「日時 モルック対戦」', 'data-fk': 'sname',
        oninput: (e) => { d.name = e.target.value; },
      }),
    ),
    d.teams.map((team, ti) =>
      h(
        'section',
        { class: 'card team-card stack', style: teamColor(ti), 'aria-label': `チーム${ti + 1}` },
        h('div', { class: 'row' },
          h('h2', { class: 'grow' }, `チーム ${ti + 1}`),
          Setup.canRemoveTeam(d) &&
            h('button', {
              class: 'btn btn-sm btn-ghost', type: 'button', 'data-fk': `rmteam-${team.id}`,
              onclick: () => { ui.draft = Setup.removeTeam(ui.draft, team.id); render(); },
            }, 'このチームを削除'),
        ),
        h('label', { class: 'field' }, 'チーム名',
          h('input', {
            type: 'text', value: team.name, maxlength: L.NAME_MAX, placeholder: L.defaultTeamName(ti), 'data-fk': `tname-${team.id}`,
            oninput: (e) => { team.name = e.target.value; },
          }),
        ),
        team.members.map((m, mi) =>
          h('div', { class: 'member-row' },
            h('input', {
              type: 'text', value: m.name, maxlength: L.NAME_MAX, placeholder: L.defaultMemberName(mi),
              'aria-label': `チーム${ti + 1}の選手${mi + 1}`, 'data-fk': `m-${m.id}`,
              oninput: (e) => { m.name = e.target.value; },
            }),
            Setup.canRemoveMember(team, mi)
              ? h('button', {
                class: 'icon-btn', type: 'button', 'aria-label': `選手${mi + 1}を削除`,
                onclick: () => { ui.draft = Setup.removeMember(ui.draft, team.id, m.id); render(); },
              }, '×')
              : h('span', { style: 'width:44px', 'aria-hidden': 'true' }),
          ),
        ),
        h('button', {
          class: 'btn btn-sm', type: 'button', disabled: !Setup.canAddMember(team), 'data-fk': `addm-${team.id}`,
          onclick: () => { ui.draft = Setup.addMember(ui.draft, team.id, Svc.newId); render(); },
        }, Setup.canAddMember(team) ? '＋選手を追加' : `選手は${L.MAX_MEMBERS}人まで`),
      ),
    ),
    h('button', {
      class: 'btn btn-block', type: 'button', disabled: !Setup.canAddTeam(d), 'data-fk': 'addteam',
      onclick: () => { ui.draft = Setup.addTeam(ui.draft, Svc.newId); render(); },
    }, Setup.canAddTeam(d) ? '＋チームを追加' : `チームは${L.MAX_TEAMS}つまで`),
    h('p', { class: 'small muted' }, '名前は空欄でも始められます（チームA・選手1などで補完）。登録内容はゲーム開始時に固定され、この対戦の間は変更できません。'),
    h('button', { class: 'btn btn-primary btn-lg btn-block', type: 'button', onclick: proceedToOrder }, '投げる順番を決める'),
  );
}

function proceedToOrder() {
  const d = ui.draft;
  const teams = L.finalizeTeams(d.teams);
  const name = Array.from(String(d.name).trim()).slice(0, 40).join('') || Setup.defaultSessionName(new Date());
  ui.order = { mode: 'new', gameNumber: 1, name, teams, ...L.defaultOrder(teams, null) };
  go('order');
}

// ───────────── ゲーム開始前（順番） ─────────────

function screenOrder() {
  const o = ui.order;
  const teamsById = new Map(o.teams.map((t) => [t.id, t]));
  const teamIndex = new Map(o.teams.map((t, i) => [t.id, i]));
  const memberName = (t, id) => t.members.find((m) => m.id === id)?.name ?? '';
  return h(
    'main',
    { class: 'stack' },
    topbar(`第${o.gameNumber}ゲームの順番`,
      o.mode === 'new'
        ? backButton('チーム設定', () => go('setup'))
        : backButton('前のゲーム結果', backToPrevResult)),
    h('p', null, '上から順に投げます。≡ の部分を上下にスワイプするか、▲▼で入れ替えてください。チーム内の選手の順番も変えられます。'),
    o.previousResultOrder && h('p', { class: 'small muted' }, '初期値は前のゲームの結果が悪い順（記録点の低い順）です。'),
    h('div', { class: 'stack' }, o.teamOrder.map((tid, i) => {
      const t = teamsById.get(tid);
      const members = o.memberOrders[tid];
      return h(
        'section',
        { class: 'card order-team', style: teamColor(teamIndex.get(tid)), 'data-sort-item': tid },
        h('div', { class: 'order-head' },
          h('div', {
            class: 'drag-zone', 'aria-hidden': 'true',
            onpointerdown: (e) => startDrag(e, (ids) => { o.teamOrder = ids; }),
          },
          h('span', { class: 'drag-handle' }, '≡'),
          h('span', { class: 'order-num' }, String(i + 1)),
          h('span', { class: 'order-name' }, t.name)),
          h('span', { class: 'sr-only' }, `${i + 1}番目 ${t.name}`),
          h('button', {
            class: 'icon-btn', type: 'button', disabled: i === 0, 'aria-label': `${t.name}を上へ`, 'data-fk': `tu-${tid}`,
            onclick: () => { o.teamOrder = L.moveItem(o.teamOrder, i, -1); render(); },
          }, '▲'),
          h('button', {
            class: 'icon-btn', type: 'button', disabled: i === o.teamOrder.length - 1, 'aria-label': `${t.name}を下へ`, 'data-fk': `td-${tid}`,
            onclick: () => { o.teamOrder = L.moveItem(o.teamOrder, i, 1); render(); },
          }, '▼'),
        ),
        h('ol', { class: 'order-members' },
          members.map((mid, j) =>
            h('li', { 'data-sort-item': mid },
              members.length > 1
                ? h('div', {
                  class: 'drag-zone grow',
                  onpointerdown: (e) => startDrag(e, (ids) => { o.memberOrders[tid] = ids; }),
                },
                h('span', { class: 'drag-handle', 'aria-hidden': 'true' }, '≡'),
                h('span', { class: 'mname' }, `${j + 1}. ${memberName(t, mid)}`))
                : h('span', { class: 'mname' }, `${j + 1}. ${memberName(t, mid)}`),
              members.length > 1 && [
                h('button', {
                  class: 'icon-btn', type: 'button', disabled: j === 0, 'aria-label': `${memberName(t, mid)}を上へ`, 'data-fk': `mu-${mid}`,
                  onclick: () => { o.memberOrders[tid] = L.moveItem(members, j, -1); render(); },
                }, '▲'),
                h('button', {
                  class: 'icon-btn', type: 'button', disabled: j === members.length - 1, 'aria-label': `${memberName(t, mid)}を下へ`, 'data-fk': `md-${mid}`,
                  onclick: () => { o.memberOrders[tid] = L.moveItem(members, j, 1); render(); },
                }, '▼'),
              ],
            ),
          ),
        ),
      );
    })),
    h('button', { class: 'btn btn-primary btn-lg btn-block', type: 'button', onclick: startGameFromOrder }, 'この順番で開始'),
    o.mode === 'next' && h('p', { class: 'small muted' }, '開始すると前のゲームは確定し、編集できなくなります。全チーム0点・ミス0回から始まります。'),
  );
}

/**
 * 指やマウスで上下にドラッグして並べ替える。[data-sort-item] の要素を、同じ親の中で移動する。
 * 離したときに新しい順番（data-sort-item の配列）を commit に渡して再描画する。
 */
function startDrag(e, commit) {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  const zone = e.currentTarget;
  const item = zone.closest('[data-sort-item]');
  const list = item.parentElement;
  e.preventDefault();
  item.classList.add('dragging');
  const move = (ev) => {
    const y = ev.clientY;
    let before = null;
    for (const s of list.children) {
      if (s === item) continue;
      const r = s.getBoundingClientRect();
      if (y < r.top + r.height / 2) {
        before = s;
        break;
      }
    }
    if (before !== item.nextElementSibling) list.insertBefore(item, before);
    // 画面端では自動でスクロール
    if (y < 60) window.scrollBy(0, -12);
    else if (y > window.innerHeight - 60) window.scrollBy(0, 12);
  };
  // 要素をDOM内で移動するとポインターキャプチャが外れるため、windowで受け取る
  const pointerId = e.pointerId;
  const onMove = (ev) => ev.pointerId === pointerId && move(ev);
  const end = (ev) => {
    if (ev.pointerId !== pointerId) return;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', end);
    window.removeEventListener('pointercancel', end);
    item.classList.remove('dragging');
    commit([...list.children].map((c) => c.dataset.sortItem));
    render();
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);
}

async function startGameFromOrder() {
  const o = ui.order;
  const order = { teamOrder: o.teamOrder, memberOrders: o.memberOrders };
  const result = await guarded(async () => {
    if (o.mode === 'new') {
      const r = await Svc.createSession(ui.store, { name: o.name, teams: o.teams, order });
      requestPersistentStorage();
      return r;
    }
    return Svc.startNextGame(ui.store, ui.ctl.session, order);
  });
  if (!result) return;
  ui.activeSession = result.session;
  ui.ctl = new Svc.GameController(ui.store, result.session, result.game, []);
  ui.selected = new Set();
  ui.restoredType = null;
  ui.notice = null;
  ui.saveError = null;
  ui.order = null;
  ui.draft = null;
  announce(`第${result.game.gameNumber}ゲーム開始`);
  go('play');
}

async function backToPrevResult() {
  ui.order = null;
  await openGameEnd();
}

function requestPersistentStorage() {
  try {
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  } catch {
    /* 対応していない環境では何もしない */
  }
}

// ───────────── 得点入力 ─────────────

function teamColorIndex(session) {
  return new Map(session.teams.map((t, i) => [t.id, i]));
}

function screenPlay() {
  const ctl = ui.ctl;
  const game = ctl.game;
  const state = ctl.state;
  const lookup = F.rosterLookup(game);
  const colorIdx = teamColorIndex(ctl.session);
  const turn = ctl.turn;
  if (!turn) {
    // 終了済み（他画面から戻った場合など）
    queueMicrotask(() => openGameEnd());
    return h('p', { class: 'loading' }, '結果を表示しています…');
  }
  const cur = state.teams[turn.teamId];
  const locked = !ctl.canInput();
  const pins = [...ui.selected].sort((a, b) => a - b);
  const pv = pins.length ? ctl.preview({ type: 'score', pins }) : null;
  const last = ctl.throws[ctl.throws.length - 1];

  return h(
    'main',
    null,
    topbar(`第${game.gameNumber}ゲーム`,
      h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: pauseSession }, '一旦やめる'),
      h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: endSessionFromPlay }, '対戦を終了'),
    ),
    // 1. 全チームの状況
    h('section', { class: 'scoreboard', style: `--cols:${game.teamOrder.length}`, 'aria-label': '全チームの得点' },
      game.teamOrder.map((tid) => {
        const t = state.teams[tid];
        const isCur = tid === turn.teamId;
        return h('div', {
          class: `sb-team ${isCur ? 'current' : ''} ${t.eliminated ? 'out' : ''}`,
          style: teamColor(colorIdx.get(tid)),
          'aria-current': isCur ? 'true' : null,
        },
        h('div', { class: 'sb-name' }, isCur ? `▶ ${lookup.team(tid)}` : lookup.team(tid)),
        h('div', { class: 'sb-score' }, t.eliminated ? '0' : String(t.score), h('span', { class: 'sr-only' }, '点')),
        h('div', { class: 'sb-miss' },
          t.eliminated
            ? h('span', { class: 'badge badge-danger' }, '失格')
            : [
              h('span', { class: 'dots', 'aria-hidden': 'true' }, '●'.repeat(t.misses) + '○'.repeat(L.MISS_LIMIT - t.misses)),
              h('span', null, `ミス${t.misses}`),
              t.misses === L.MISS_LIMIT - 1 && h('span', { class: 'badge badge-danger' }, '次で失格'),
            ]),
        );
      }),
    ),
    // 2〜3. 現在の手番と得点
    h('section', { class: 'turn', style: teamColor(colorIdx.get(turn.teamId)), 'aria-live': 'polite' },
      h('div', { class: 'turn-who' }, `${lookup.team(turn.teamId)} ／ ${lookup.member(turn.memberId)}さんの番`),
      h('div', { class: 'turn-sub' }, '現在 ', h('strong', null, `${cur.score}点`), `　あと${L.TARGET_SCORE - cur.score}点で50点`, h('span', { class: 'muted small' }, `（第${turn.sequence}投）`)),
      cur.misses === L.MISS_LIMIT - 1 && h('div', { class: 'badge badge-danger', style: 'margin-top:4px' }, '連続ミス2回：次のミスで失格'),
    ),
    ui.saveError && h('div', { class: 'banner banner-error stack', role: 'alert' },
      h('div', null, '保存できませんでした。この投擲はまだ記録されていません。'),
      h('p', null, ui.saveError),
      h('div', { class: 'row' },
        h('button', { class: 'btn btn-primary btn-sm grow', type: 'button', onclick: retrySave }, '再試行'),
        h('button', { class: 'btn btn-sm', type: 'button', onclick: discardSave }, '入力に戻る'),
      ),
    ),
    ui.notice && h('div', { class: `banner banner-${ui.notice.kind}`, role: 'status' }, ui.notice.text),
    // 4. スキットル選択
    h('p', { class: 'pin-hint' }, '得点として数えるピンを選択'),
    h('div', { class: 'pin-legend', 'aria-hidden': 'true' }, '↑ 奥'),
    h('div', { class: 'pins', role: 'group', 'aria-label': 'スキットル（ピン）の番号' },
      PIN_LAYOUT.map((row, r) =>
        row.map(([n, x]) => {
          const on = ui.selected.has(n);
          return h('button', {
            class: 'pin', type: 'button', style: `--x:${x};--row:${r}`,
            'aria-pressed': on ? 'true' : 'false', 'aria-label': `${n}番`, disabled: locked, 'data-fk': `pin-${n}`,
            onclick: () => togglePin(n),
          }, String(n), on && h('span', { class: 'check', 'aria-hidden': 'true' }, '✓'));
        }),
      ),
    ),
    h('div', { class: 'pin-legend', 'aria-hidden': 'true' }, '↓ 投擲者側'),
    // 5. プレビュー
    h('section', { class: `preview ${pv ? 'has' : ''}`, 'aria-live': 'polite', 'aria-label': '今回の得点' },
      pv ? previewContent(pins, pv) : h('p', { class: 'muted' }, '番号を選ぶと今回の得点が表示されます'),
    ),
    // 6. 操作
    h('section', { class: 'actions' },
      h('button', {
        class: 'btn btn-primary btn-lg decide', type: 'button', disabled: locked || pins.length === 0, 'data-fk': 'decide',
        onclick: () => decide({ type: 'score', pins: [...ui.selected] }),
      }, pins.length ? `得点を決定（${pv ? pv.record.earnedPoints : 0}点）` : '得点を決定'),
      h('button', {
        class: 'btn', type: 'button', disabled: locked || pins.length > 0, 'data-fk': 'miss',
        title: pins.length ? '選択を解除してから押してください' : null,
        onclick: () => decide({ type: 'miss' }),
      }, 'ミス（0点）', ui.restoredType === 'miss' && h('span', { class: 'restored-tag' }, '取消前')),
      h('button', {
        class: 'btn', type: 'button', disabled: locked, 'data-fk': 'invert',
        title: '選択中の番号と未選択の番号を入れ替えます',
        onclick: invertSelection,
      }, '選択反転'),
      h('button', {
        class: 'btn', type: 'button', disabled: locked || pins.length === 0, 'data-fk': 'clear',
        onclick: () => { ui.selected.clear(); render(); },
      }, '選択解除'),
    ),
    pins.length > 0 && h('p', { class: 'small muted center' }, 'ミスを記録するには選択を解除してください'),
    // 7. 直近と取り消し
    h('section', { class: 'recent' },
      h('div', { class: 'recent-text' }, last ? `直近：${F.describeThrow(last, lookup)}` : 'まだ投擲はありません'),
      h('div', { class: 'recent-actions' },
        h('button', { class: 'btn btn-sm', type: 'button', disabled: !ctl.canUndo(), onclick: undoLast }, '1投戻す'),
        h('button', { class: 'btn btn-sm', type: 'button', onclick: () => openGameDetail(ctl.session.id, game.id, 'play') }, 'スコア表'),
        h('button', { class: 'btn btn-sm', type: 'button', onclick: () => openSessionDetail(ctl.session.id, 'play') }, '対戦の記録'),
      ),
    ),
  );
}

function previewContent(pins, pv) {
  const r = pv.record;
  const head = pins.length === 1 ? `${pins[0]}番 → ${r.earnedPoints}点` : `${pins.length}本 → ${r.earnedPoints}点`;
  return [
    h('div', { class: 'preview-main' }, head),
    h('div', null, `確定後の累計 ${r.scoreBefore} → ${r.scoreAfter}点`, pins.length > 1 ? h('span', { class: 'small muted' }, `（${pins.join('・')}）`) : null),
    pv.outcome.overshoot && h('div', { class: 'warn' }, '50点を超えるため25点になります'),
    pv.outcome.win && h('div', { class: 'win' }, '50点・勝利'),
  ];
}

function togglePin(n) {
  if (!ui.ctl.canInput()) return;
  if (ui.selected.has(n)) ui.selected.delete(n);
  else ui.selected.add(n);
  ui.restoredType = null;
  render();
}

async function decide(input) {
  const ctl = ui.ctl;
  if (!ctl.canInput()) return;
  const expected = ctl.state.sequence + 1;
  const pending = ctl.submit(input, expected); // 同期的に排他ロックがかかる
  render();
  handleSaveResult(await pending);
}

async function retrySave() {
  const pending = ui.ctl.retry();
  render();
  handleSaveResult(await pending);
}

function discardSave() {
  ui.ctl.discardPending();
  ui.saveError = null;
  render();
}

function handleSaveResult(r) {
  const ctl = ui.ctl;
  if (r.status === 'saved') {
    ui.selected = new Set();
    ui.restoredType = null;
    ui.saveError = null;
    ui.notice = null;
    const lookup = F.rosterLookup(ctl.game);
    const t = r.record;
    let msg = `${lookup.team(t.teamId)} ${F.pinsLabel(t)} ${t.earnedPoints}点、累計${t.scoreAfter}点。`;
    if (t.eliminatedAfter) msg += '失格。';
    if (r.outcome.finished) {
      announce(`${msg}ゲーム終了`);
      openGameEnd();
      return;
    }
    const next = ctl.turn;
    announce(`${msg}次は${lookup.team(next.teamId)}の${lookup.member(next.memberId)}さん`);
    render();
  } else if (r.status === 'error') {
    console.error(r.error);
    ui.saveError = describeStorageError(r.error);
    render();
  } else {
    render();
  }
}

/** 選択中と未選択を入れ替える（倒れなかったピンを選ぶほうが早いとき用） */
function invertSelection() {
  if (!ui.ctl.canInput()) return;
  ui.selected = new Set(L.PIN_NUMBERS.filter((n) => !ui.selected.has(n)));
  ui.restoredType = null;
  render();
}

async function undoLast() {
  const ctl = ui.ctl;
  if (!ctl.canUndo()) return;
  const last = ctl.throws[ctl.throws.length - 1];
  const lookup = F.rosterLookup(ctl.game);
  const ok = await dialog({
    title: '直前の1投を取り消しますか？',
    lines: [
      { text: F.describeThrow(last, lookup), cls: 'strong' },
      `${lookup.team(last.teamId)}の得点・ミス数・失格・手番を、この投擲の前に戻します。`,
      ctl.game.status === 'completed' ? 'ゲーム終了（勝敗）も取り消されます。' : null,
      '取り消した内容は入力欄に戻るので、修正して決定し直せます。',
    ],
    ok: '取り消す',
  });
  if (!ok) return;
  const r = await ctl.undo();
  if (r.status !== 'saved') {
    if (r.status === 'error') await alertDialog('取り消せませんでした', [describeStorageError(r.error)]);
    render();
    return;
  }
  const u = r.undone;
  ui.saveError = null;
  if (u.type === 'score') {
    ui.selected = new Set(u.selectedPins);
    ui.restoredType = null;
  } else {
    ui.selected = new Set();
    ui.restoredType = u.type;
  }
  ui.notice = {
    kind: 'info',
    text: `取り消しました（${F.describeThrow(u, lookup)}）。${u.type === 'score' ? '番号を選択し直した状態です。' : `「${F.TYPE_LABEL[u.type]}」でした。`}修正して決定してください。`,
  };
  announce('1投取り消しました');
  go('play');
}

function pauseSession() {
  goHome();
}

async function endSessionFromPlay() {
  const ctl = ui.ctl;
  const ok = await dialog({
    title: 'ここで対戦を終了しますか？',
    lines: [
      `進行中の第${ctl.game.gameNumber}ゲームは「中断」として残り、勝利数・合計点には含めません。`,
      'それまでに完了したゲームだけを集計します。終了後はこの対戦を編集できません。',
    ],
    ok: '対戦を終了',
    danger: true,
  });
  if (!ok) return;
  const s = await guarded(() => Svc.endSession(ui.store, ctl.session));
  if (!s) return;
  ui.activeSession = null;
  ui.ctl = null;
  await openSessionDetail(s.id, 'home');
}

// ───────────── ゲーム終了 ─────────────

async function openGameEnd() {
  const ctl = ui.ctl;
  ui.endBundle = await Svc.loadSessionBundle(ui.store, ctl.session.id);
  go('gameEnd');
}

function screenGameEnd() {
  const ctl = ui.ctl;
  const game = ctl.game;
  const lookup = F.rosterLookup(game);
  const results = game.results || [];
  const winner = game.winnerTeamId;
  const summary = L.summarizeSession(ctl.session, ui.endBundle ? ui.endBundle.games : [game]);
  return h(
    'main',
    { class: 'stack' },
    topbar(`第${game.gameNumber}ゲーム 終了`),
    updateBanner(),
    h('section', { class: 'winner', role: 'status' },
      h('div', { class: 'big' }, `🏆 ${lookup.team(winner)} の勝利`),
      h('div', null, `終了理由：${F.END_REASON_LABEL[game.endReason]}`),
    ),
    game.endReason === 'lastSurvivor' &&
      h('p', { class: 'small' }, `他のチームがすべて失格したため、${lookup.team(winner)}の記録点を50点としました（投擲は追加していません）。`),
    h('div', { class: 'table-wrap' },
      h('table', null,
        h('thead', null, h('tr', null, h('th', { class: 'name' }, 'チーム'), h('th', null, '記録点'), h('th', null, '状態'))),
        h('tbody', null,
          results.map((r) => h('tr', { class: r.isWinner ? 'winner-row' : '' },
            h('td', { class: 'name' }, lookup.team(r.teamId)),
            h('td', null, String(r.finalRecordedScore)),
            h('td', null, r.isWinner ? '勝利' : r.eliminated ? '失格' : '—'),
          )),
        ),
      ),
    ),
    h('p', { class: 'small muted' }, '勝者以外は最終得点のみを表示し、2位以下の順位は付けません。'),
    h('h2', null, 'ここまでの集計'),
    summaryTable(summary),
    h('button', { class: 'btn btn-primary btn-lg btn-block', type: 'button', onclick: goNextGame }, '次のゲームへ'),
    h('button', { class: 'btn btn-block', type: 'button', onclick: finishSession }, '対戦を終了'),
    h('div', { class: 'row' },
      h('button', { class: 'btn btn-sm grow', type: 'button', disabled: !ctl.canUndo(), onclick: undoLast }, '最後の1投を取り消す'),
      h('button', { class: 'btn btn-sm grow', type: 'button', onclick: () => openGameDetail(ctl.session.id, game.id, 'gameEnd') }, 'スコア表'),
    ),
    h('button', { class: 'btn btn-sm btn-ghost btn-block', type: 'button', onclick: goHome }, 'ホームへ（対戦は進行中のまま保存）'),
  );
}

function summaryTable(rows) {
  return h('div', { class: 'table-wrap' },
    h('table', null,
      h('thead', null, h('tr', null, h('th', { class: 'name' }, 'チーム'), h('th', null, '勝利数'), h('th', null, '合計点'), h('th', null, '完了ゲーム'))),
      h('tbody', null, rows.map((r) => h('tr', null,
        h('td', { class: 'name' }, r.name),
        h('td', null, String(r.wins)),
        h('td', null, String(r.totalPoints)),
        h('td', null, String(r.completedGames)),
      ))),
    ),
  );
}

function goNextGame() {
  const ctl = ui.ctl;
  const s = ctl.session;
  ui.order = {
    mode: 'next',
    gameNumber: s.gameIds.length + 1,
    name: s.name,
    teams: s.teams,
    previousResultOrder: true,
    ...L.defaultOrder(s.teams, ctl.game),
  };
  go('order');
}

async function finishSession() {
  const ok = await dialog({
    title: '対戦を終了しますか？',
    lines: ['これまでの記録は保存され、集計を表示します。', '終了後は、この対戦のゲームを編集できません。'],
    ok: '対戦を終了',
  });
  if (!ok) return;
  const s = await guarded(() => Svc.endSession(ui.store, ui.ctl.session));
  if (!s) return;
  ui.activeSession = null;
  ui.ctl = null;
  await openSessionDetail(s.id, 'home');
}

// ───────────── 履歴 ─────────────

async function openHistory() {
  const all = await ui.store.getAll();
  ui.historyData = all;
  go('history');
}

function screenHistory() {
  const { sessions, games } = ui.historyData;
  const sorted = [...sessions].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return h(
    'main',
    { class: 'stack' },
    topbar('過去の記録', backButton('ホーム', goHome)),
    updateBanner(),
    sorted.length === 0 && h('p', { class: 'muted' }, 'まだ記録はありません。'),
    sorted.map((s) => {
      const done = games.filter((g) => g.sessionId === s.id && g.status === 'completed').length;
      return h('button', { class: 'session-item', type: 'button', onclick: () => openSessionDetail(s.id, 'history') },
        h('div', { class: 'row' },
          h('span', { class: 'small muted grow' }, F.formatDateTime(s.createdAt)),
          h('span', { class: `badge ${s.status === 'inProgress' ? 'badge-ok' : ''}` }, F.SESSION_STATUS_LABEL[s.status]),
        ),
        h('div', { class: 'title' }, s.name),
        h('div', { class: 'small' }, s.teams.map((t) => t.name).join('・')),
        h('div', { class: 'small muted' }, `終了ゲーム数：${done}`),
      );
    }),
  );
}

async function openSessionDetail(sessionId, from) {
  const bundle = await Svc.loadSessionBundle(ui.store, sessionId);
  if (!bundle) {
    await goHome();
    return;
  }
  ui.view = { sessionId, from, bundle };
  go('sessionDetail');
}

function screenSessionDetail() {
  const { bundle, from } = ui.view;
  const { session, games } = bundle;
  const summary = L.summarizeSession(session, games);
  const fromPlay = from === 'play';
  const back = fromPlay ? () => go('play') : from === 'history' ? () => openHistory() : goHome;
  const backLabel = fromPlay ? '入力に戻る' : from === 'history' ? '一覧' : 'ホーム';
  return h(
    'main',
    { class: 'stack' },
    topbar('対戦の記録', backButton(backLabel, back)),
    h('div', null,
      h('h2', null, session.name),
      h('p', { class: 'small muted' }, `${F.formatDateTime(session.createdAt)} 開始`, session.endedAt ? `／${F.formatDateTime(session.endedAt)} 終了` : '', `／${F.SESSION_STATUS_LABEL[session.status]}`),
    ),
    session.status === 'inProgress' && !fromPlay &&
      h('button', { class: 'btn btn-primary btn-block', type: 'button', onclick: resumeActive }, 'この対戦を再開'),
    h('h3', null, 'チーム別集計'),
    summaryTable(summary),
    h('p', { class: 'small muted' }, '合計点は完了ゲームの記録点（失格は0点、最後に残ったチームは50点）の合計です。未完了・中断ゲームは含みません。勝利数が同じ場合は同列とし、総合順位は自動で決めません。'),
    h('h3', null, 'ゲーム別得点'),
    games.length === 0
      ? h('p', { class: 'muted' }, 'ゲームはありません。')
      : h('div', { class: 'table-wrap' },
        h('table', null,
          h('thead', null, h('tr', null, h('th', null, 'ゲーム'), session.teams.map((t) => h('th', { class: 'name' }, t.name)), h('th', null, '状態'))),
          h('tbody', null, games.map((g) => h('tr', {
            class: 'row-link', tabindex: '0', role: 'link', 'aria-label': `第${g.gameNumber}ゲームの詳細`,
            onclick: () => openGameDetail(session.id, g.id, 'sessionDetail'),
            onkeydown: (e) => { if (e.key === 'Enter') openGameDetail(session.id, g.id, 'sessionDetail'); },
          },
          h('td', null, `第${g.gameNumber}`),
          session.teams.map((t) => {
            const r = (g.results || []).find((x) => x.teamId === t.id);
            return h('td', null, r ? `${r.finalRecordedScore}${r.isWinner ? ' 🏆' : ''}${r.eliminated ? '（失格）' : ''}` : '—');
          }),
          h('td', null, F.GAME_STATUS_LABEL[g.status], ' ›'),
          ))),
        ),
      ),
    h('button', { class: 'btn btn-block', type: 'button', onclick: () => exportCsv(bundle) }, 'CSVで書き出す'),
    fromPlay
      ? h('button', { class: 'btn btn-primary btn-lg btn-block', type: 'button', onclick: back }, '入力に戻る')
      : h('button', { class: 'btn btn-block btn-ghost', type: 'button', style: 'color:var(--danger);border-color:var(--danger)', onclick: () => removeSession(session) }, 'この対戦を削除'),
  );
}

function exportCsv(bundle) {
  const csv = F.sessionToCsv(bundle.session, bundle.games, bundle.throwsByGame);
  const date = bundle.session.createdAt.slice(0, 10);
  download(`molkky-${date}-${F.safeFileName(bundle.session.name)}.csv`, csv, 'text/csv;charset=utf-8');
}

async function removeSession(session) {
  const ok = await dialog({
    title: 'この対戦を削除しますか？',
    lines: [
      { text: `「${session.name}」`, cls: 'strong' },
      'すべてのゲームと投擲記録が削除され、元に戻せません。必要なら先にCSVやバックアップを書き出してください。',
    ],
    ok: '削除する',
    danger: true,
  });
  if (!ok) return;
  const done = await guarded(async () => {
    await Svc.deleteSession(ui.store, session.id);
    return true;
  });
  if (!done) return;
  await refreshActive();
  if (ui.ctl && ui.ctl.session.id === session.id) ui.ctl = null;
  await openHistory();
}

async function openGameDetail(sessionId, gameId, from) {
  const bundle = await Svc.loadSessionBundle(ui.store, sessionId);
  ui.view = { ...(ui.view || {}), sessionId, gameId, gameFrom: from, bundle, from: ui.view && ui.view.sessionId === sessionId ? ui.view.from : 'history' };
  go('gameDetail');
}

function screenGameDetail() {
  const { bundle, gameId, gameFrom } = ui.view;
  const game = bundle.games.find((g) => g.id === gameId);
  const throws = bundle.throwsByGame[gameId] || [];
  const lookup = F.rosterLookup(game);
  const back = () => {
    if (gameFrom === 'play') go('play');
    else if (gameFrom === 'gameEnd') go('gameEnd');
    else go('sessionDetail');
  };
  const maxTurn = throws.reduce((m, t) => Math.max(m, t.teamTurnNumber), 0);
  const cell = (tid, r) => throws.find((t) => t.teamId === tid && t.teamTurnNumber === r);

  return h(
    'main',
    { class: 'stack' },
    topbar(`第${game.gameNumber}ゲームの記録`, backButton('戻る', back)),
    h('p', { class: 'small' },
      `状態：${F.GAME_STATUS_LABEL[game.status]}`,
      game.winnerTeamId ? `／勝者：${lookup.team(game.winnerTeamId)}（${F.END_REASON_LABEL[game.endReason]}）` : '',
      `／投擲順：${game.teamOrder.map((id) => lookup.team(id)).join(' → ')}`,
    ),
    h('h3', null, 'スコアシート'),
    h('p', { class: 'small muted' }, '「ー」はミス（0点）。投擲回はそのチームの何投目かを表します。'),
    h('div', { class: 'table-wrap' },
      h('table', { class: 'sheet' },
        h('thead', null,
          h('tr', null, h('th', { rowspan: '2' }, '回'), game.teamOrder.map((tid) => h('th', { colspan: '3', class: 'team-head' }, lookup.team(tid)))),
          h('tr', null, game.teamOrder.map(() => [h('th', { class: 'team-head' }, '選手'), h('th', null, '得点'), h('th', null, '累計')])),
        ),
        h('tbody', null,
          Array.from({ length: maxTurn }, (_, i) => i + 1).map((r) =>
            h('tr', null, h('th', null, String(r)), game.teamOrder.map((tid) => {
              const t = cell(tid, r);
              if (!t) return [h('td', { class: 'first' }, ''), h('td', null, ''), h('td', null, '')];
              return [
                h('td', { class: 'first' }, lookup.member(t.scheduledMemberId)),
                h('td', null, F.sheetPoints(t), t.type === 'footFault' && h('span', { class: 'tag' }, '踏み越え'), t.type === 'miss' && h('span', { class: 'tag' }, 'ミス')),
                h('td', { class: 'cum' }, String(t.scoreAfter), t.eliminatedAfter && h('span', { class: 'tag tag-out' }, '失格'),
                  t.type === 'score' && t.scoreBefore + t.earnedPoints > L.TARGET_SCORE && h('span', { class: 'tag' }, '超過')),
              ];
            })),
          ),
          game.results && h('tr', null, h('th', null, '記録'), game.teamOrder.map((tid) => {
            const r = game.results.find((x) => x.teamId === tid);
            return h('td', { colspan: '3', class: 'first cum' }, `${r.finalRecordedScore}点${r.isWinner ? ' 🏆' : ''}`);
          })),
        ),
      ),
    ),
    game.endReason === 'lastSurvivor' &&
      h('p', { class: 'small' }, `他のチームがすべて失格したため、${lookup.team(game.winnerTeamId)}の記録点を50点としました。`),
    h('h3', null, `投擲履歴（${throws.length}投）`),
    throws.length === 0 ? h('p', { class: 'muted' }, 'まだ投擲はありません。') : h('ol', { class: 'log' }, throws.map((t) => h('li', null, F.describeThrow(t, lookup)))),
  );
}

// ───────────── 設定・バックアップ・ルール ─────────────

function screenSettings() {
  return h(
    'main',
    { class: 'stack' },
    topbar('設定・バックアップ', backButton('ホーム', goHome)),
    updateBanner(),
    storageWarningBanner(),
    h('section', { class: 'card stack' },
      h('h2', null, '記録の保存について'),
      h('p', null, '記録はこの端末のブラウザ内（IndexedDB）に保存されます。通信やログインは不要です。'),
      h('p', null, 'ブラウザの履歴・サイトデータを削除すると記録も消えます。他の端末へ自動で共有されることはありません。大切な記録は定期的にバックアップしてください。'),
    ),
    h('section', { class: 'card stack' },
      h('h2', null, 'バックアップ（JSON）'),
      h('button', { class: 'btn btn-block', type: 'button', onclick: exportJson }, '全データを書き出す'),
      h('label', { class: 'btn btn-block', role: 'button', tabindex: '0', onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.currentTarget.querySelector('input').click(); } } },
        'バックアップから取り込む',
        h('input', { type: 'file', accept: 'application/json,.json', class: 'sr-only', onchange: importJson }),
      ),
      h('p', { class: 'small muted' }, '取り込みは全件成功か全件失敗のどちらかです。同じ対戦がすでにある場合は上書きの確認を行います。'),
    ),
    h('section', { class: 'card stack' },
      h('h2', null, 'アプリの更新'),
      h('p', { class: 'small' }, `現在の版：Ver.${APP_VERSION}`),
      h('button', { class: 'btn btn-block', type: 'button', onclick: checkForUpdate }, '最新版を確認'),
      h('p', { class: 'small muted' }, '新しい版があれば切り替えて開き直します。対戦の記録は消えません。'),
    ),
    rulesSection(),
    h('p', { class: 'small muted center' }, `モルとも Ver.${APP_VERSION}`),
  );
}

async function exportJson() {
  const data = B.buildExport(await ui.store.getAll());
  const stamp = new Date().toISOString().slice(0, 10);
  download(`molkky-backup-${stamp}.json`, JSON.stringify(data, null, 2), 'application/json');
}

async function importJson(e) {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  let data;
  try {
    data = B.parseAndValidate(await file.text());
  } catch (err) {
    await alertDialog('取り込めませんでした', [err.message, '端末のデータは変更していません。']);
    return;
  }
  try {
    const r = await B.importData(ui.store, data, {
      confirmOverwrite: (conflicts) =>
        dialog({
          title: '同じ対戦がすでにあります',
          lines: [
            `${conflicts.length}件の対戦が端末内の記録と同じIDです：`,
            conflicts.map((s) => `「${s.name}」`).join('、'),
            'バックアップの内容で上書きしますか？（取り消すと何も取り込みません）',
          ],
          ok: '上書きして取り込む',
          danger: true,
        }),
    });
    if (r.status === 'cancelled') {
      await alertDialog('取り込みを中止しました', ['端末のデータは変更していません。']);
      return;
    }
    await refreshActive();
    await alertDialog('取り込みました', [`${r.sessions}件の対戦を取り込みました${r.replaced ? `（うち${r.replaced}件を上書き）` : ''}。`]);
    render();
  } catch (err) {
    console.error(err);
    await alertDialog('取り込めませんでした', [err instanceof B.ImportError ? err.message : describeStorageError(err), '端末のデータは変更していません。']);
  }
}

function rulesSection() {
  const rows = [
    ['有効なスキットルが1本', 'その番号を加点'],
    ['有効なスキットルが2〜12本', '本数を加点'],
    ['ミス（0点）', '連続ミス数を1増やす（他チームの投擲を挟んでも、チーム内で投げる人が変わってもリセットしない）'],
    ['得点後の合計がちょうど50', 'その場で勝利・ゲーム終了'],
    ['得点後の合計が50超', '25点に戻して継続（ミスではないので連続ミスは0に戻る）'],
    ['3回連続で0点', '失格。そのゲームの記録点は0'],
    ['他チームがすべて失格', '残る1チームの記録点を50として終了'],
  ];
  const links = [
    ['日本モルック協会「モルックについて」', 'https://molkky.jp/molkky/'],
    ['公式ルールブックダウンロード', 'https://molkky.jp/play/official-rule-book/'],
    ['公式ルールガイドブック（PDF）', 'https://molkky.jp/cms/wp-content/uploads/2024/04/378dd3ddacfb58bad5afbe107e0afe09.pdf'],
    ['公式スコアシート ダウンロード', 'https://molkky.jp/play/official-score-sheet/'],
    ['公式スコアシート（PDF）', 'https://molkky.jp/cms/wp-content/uploads/2026/07/scoresheet.pdf'],
  ];
  return h('section', { class: 'card stack' },
    h('h2', null, 'このアプリで扱うルール'),
    h('div', { class: 'table-wrap' },
      h('table', { class: 'rules-table' },
        h('tbody', null, rows.map(([a, b]) => h('tr', null, h('th', null, a), h('td', null, b)))),
      ),
    ),
    h('p', { class: 'small' }, '1ターンは1投で、ミスでも次のチームへ移ります。各チームに手番が回るたびに、チーム内の次の選手が投げます。失格チームは以降とばします。'),
    h('p', { class: 'small' }, '倒れたピンのうち「得点として数えるピン」の判断は利用者が行ってください（完全に倒れていないピンは通常数えません）。'),
    h('p', { class: 'small' }, '対象外：踏み越え（フォルト）、投擲順違い、時間超過、ファウル裁定、時間切れ、モルックアウト等の大会の特殊な裁定。大会ルールへの完全対応ではありません。'),
    h('p', { class: 'small' }, '対戦の集計は「勝利数」と「完了ゲームの記録点の合計」を併記する本アプリ独自の方式です。総合優勝の自動認定や同点決着は行いません。公式資料の「セット」は本アプリの「ゲーム」に当たります。'),
    h('h3', null, `参照資料（確認日：${RULES_CHECKED}）`),
    h('ul', { class: 'small' }, links.map(([t, u]) => h('li', null, h('a', { href: u, target: '_blank', rel: 'noopener' }, t)))),
    h('p', { class: 'small muted' }, '協会の配布資料が更新されると内容が変わる場合があります。'),
  );
}

// ───────────── Service Worker（PWA） ─────────────

/** 新しい版が待機中なら知らせる。ホーム画面（未保存の入力がない）ならそのまま切り替える */
function checkWaitingWorker() {
  const reg = ui.swReg;
  if (!reg || !reg.waiting || !navigator.serviceWorker.controller) return false;
  ui.swWaiting = reg.waiting;
  if (ui.screen === 'home' && !document.querySelector('.overlay')) {
    applyUpdate();
  } else if (['gameEnd', 'history', 'settings'].includes(ui.screen)) {
    // ゲーム中は描画し直さず、終了画面などで知らせる
    render();
  }
  return true;
}

function watchInstalling(reg) {
  const w = reg.installing;
  if (w) w.addEventListener('statechange', () => w.state === 'installed' && checkWaitingWorker());
}

function setupServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then((reg) => {
    ui.swReg = reg;
    checkWaitingWorker();
    watchInstalling(reg);
    reg.addEventListener('updatefound', () => watchInstalling(reg));
  }).catch((e) => console.warn('Service Workerを登録できませんでした', e));

  // ホーム画面から開いたアプリは閉じずに再表示されることが多いので、表示のたびに更新を確認する
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && ui.swReg) ui.swReg.update().catch(() => {});
  });

  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (ui.applyingUpdate && !reloading) {
      reloading = true;
      location.reload();
    }
  });
}

function applyUpdate() {
  if (!ui.swWaiting || ui.applyingUpdate) return;
  ui.applyingUpdate = true;
  ui.swWaiting.postMessage({ type: 'SKIP_WAITING' });
}

/** 設定画面の「最新版を確認」 */
async function checkForUpdate() {
  const reg = ui.swReg;
  if (!reg) {
    await alertDialog('確認できません', ['このブラウザではオフライン機能（Service Worker）が使えないため、更新の確認はできません。ページを再読み込みしてください。']);
    return;
  }
  try {
    await reg.update();
    const w = reg.installing;
    if (w) {
      await new Promise((resolve) => {
        const done = () => ['installed', 'redundant', 'activated'].includes(w.state) && resolve();
        w.addEventListener('statechange', done);
        done();
      });
    }
  } catch (e) {
    console.warn(e);
    await alertDialog('確認できませんでした', ['インターネットに接続しているか確認してください。']);
    return;
  }
  if (reg.waiting && navigator.serviceWorker.controller) {
    ui.swWaiting = reg.waiting;
    applyUpdate();
  } else {
    await alertDialog('最新版です', [`モルとも Ver.${APP_VERSION} をお使いです。`]);
  }
}

// ───────────── 起動 ─────────────

const SCREENS = {
  home: screenHome,
  setup: screenSetup,
  order: screenOrder,
  play: screenPlay,
  gameEnd: screenGameEnd,
  history: screenHistory,
  sessionDetail: screenSessionDetail,
  gameDetail: screenGameDetail,
  settings: screenSettings,
};

async function boot() {
  try {
    ui.store = await IdbStore.open();
  } catch (e) {
    console.error(e);
    ui.store = new MemoryStore();
    ui.storageWarning = 'このブラウザでは記録を端末に保存できません（プライベートブラウズ等）。ページを閉じると記録は消えます。';
  }
  try {
    await refreshActive();
  } catch (e) {
    console.error(e);
  }
  go('home');
  setupServiceWorker();
}

boot();
