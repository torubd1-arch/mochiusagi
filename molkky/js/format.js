// 表示用の文言とCSV出力（純粋関数）
import { TARGET_SCORE, FOOT_FAULT_LINE } from './logic.js';

export const TYPE_LABEL = { score: '得点', miss: 'ミス', footFault: '踏み越え' };
export const END_REASON_LABEL = { reached50: '50点到達', lastSurvivor: '他チーム失格' };
export const GAME_STATUS_LABEL = { ready: '開始前', inProgress: '進行中', completed: '終了', abandoned: '中断' };
export const SESSION_STATUS_LABEL = { inProgress: '進行中', completed: '終了' };

/** ゲームのスナップショットからチーム・選手名を引く */
export function rosterLookup(game) {
  const teams = new Map();
  const members = new Map();
  for (const t of game.rosterSnapshot) {
    teams.set(t.id, t.name);
    for (const m of t.members) members.set(m.id, m.name);
  }
  return {
    team: (id) => teams.get(id) ?? '（不明）',
    member: (id) => members.get(id) ?? '（不明）',
  };
}

/** 「12番」「3本（7・9・12）」「ミス」など */
export function pinsLabel(t) {
  if (t.type !== 'score') return TYPE_LABEL[t.type];
  if (t.selectedPins.length === 1) return `${t.selectedPins[0]}番`;
  return `${t.selectedPins.length}本（${t.selectedPins.join('・')}）`;
}

/** 投擲の補足（50点超過・37点ルール・失格・勝利・連続ミス） */
export function throwNotes(t) {
  const notes = [];
  if (t.eliminatedAfter) notes.push('3回連続ミスで失格');
  else if (t.type === 'score') {
    if (t.scoreBefore + t.earnedPoints > TARGET_SCORE) notes.push('50点超過');
    else if (t.scoreAfter === TARGET_SCORE) notes.push('50点・勝利');
  } else {
    if (t.type === 'footFault' && t.scoreBefore >= FOOT_FAULT_LINE) notes.push('37点以上の踏み越え');
    notes.push(`連続ミス${t.missesAfter}`);
  }
  return notes;
}

/** 例：第6投／チームA／太郎／12番／12点／43→25／50点超過 */
export function describeThrow(t, lookup) {
  const parts = [
    `第${t.sequence}投`,
    lookup.team(t.teamId),
    lookup.member(t.scheduledMemberId),
    pinsLabel(t),
    `${t.earnedPoints}点`,
    `${t.scoreBefore}→${t.scoreAfter}`,
    ...throwNotes(t),
  ];
  return parts.join('／');
}

/** スコアシート形式の得点表記：0点（ミス・踏み越え）は「ー」 */
export function sheetPoints(t) {
  return t.type === 'score' ? String(t.earnedPoints) : 'ー';
}

/** 表計算ソフトで数式として解釈されないよう、文字列の先頭を無害化する */
export function neutralizeFormula(value) {
  const s = String(value ?? '');
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

export function csvCell(value) {
  const s = String(value ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** 利用者が入力した文字列用のセル（数式注入対策つき） */
function textCell(value) {
  return csvCell(neutralizeFormula(value));
}

export const CSV_HEADER = [
  'レコード種別', '対戦名', 'ゲーム', 'ゲーム状態', '投擲番号', 'チーム投擲回', 'チーム', '選手',
  '種別', '選択ピン', '得点', 'シート表記', '投擲前累計', '投擲後累計', '連続ミス', '失格',
  '記録点', '勝利', '終了理由', '補足',
];

/** 対戦単位のCSV（UTF-8 BOM付き）。投擲行（throw）とゲーム結果行（result）を含む */
export function sessionToCsv(session, games, throwsByGame) {
  const lines = [CSV_HEADER.map(csvCell).join(',')];
  const row = (cells) => lines.push(cells.join(','));
  for (const g of games) {
    const lookup = rosterLookup(g);
    for (const t of throwsByGame[g.id] ?? []) {
      row([
        'throw', textCell(session.name), g.gameNumber, csvCell(GAME_STATUS_LABEL[g.status]), t.sequence, t.teamTurnNumber,
        textCell(lookup.team(t.teamId)), textCell(lookup.member(t.scheduledMemberId)),
        csvCell(TYPE_LABEL[t.type]), csvCell(t.selectedPins.join(' ')), t.earnedPoints, csvCell(sheetPoints(t)),
        t.scoreBefore, t.scoreAfter, t.missesAfter, t.eliminatedAfter ? '失格' : '',
        '', '', '', csvCell(throwNotes(t).join(' ')),
      ]);
    }
    for (const r of g.results ?? []) {
      row([
        'result', textCell(session.name), g.gameNumber, csvCell(GAME_STATUS_LABEL[g.status]), '', '',
        textCell(lookup.team(r.teamId)), '', '', '', '', '', '', r.scoreAtLastThrow, '', r.eliminated ? '失格' : '',
        r.finalRecordedScore, r.isWinner ? '勝利' : '', csvCell(r.isWinner ? END_REASON_LABEL[g.endReason] : ''), '',
      ]);
    }
    if (!g.results) {
      row([
        'result', textCell(session.name), g.gameNumber, csvCell(GAME_STATUS_LABEL[g.status]), '', '', '', '', '', '', '', '',
        '', '', '', '', '', '', '', csvCell('未完了のため集計対象外'),
      ]);
    }
  }
  return '﻿' + lines.join('\r\n') + '\r\n';
}

export function formatDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** ファイル名に使えない文字を除いた名前 */
export function safeFileName(name) {
  return String(name).replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40) || 'molkky';
}
