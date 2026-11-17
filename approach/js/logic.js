// 出題・判定・集計の純粋ロジック（DOM・localStorage に依存しない。テスト対象）

export const MIN_DISTANCE = 5;
export const MAX_DISTANCE = 20;
export const SHOT_COUNTS = [10, 20, 30];
export const MODES = ['random', 'fixed'];
export const MODE_LABELS = { random: 'ランダム', fixed: '固定' };

/** クラブ定義。将来クラブを増やすときはここに追加する */
export const CLUBS = [
  { id: 'PW', loft: 45 },
  { id: 'AW', loft: 50 },
  { id: 'SW', loft: 55 },
];
export const CLUB_IDS = CLUBS.map((c) => c.id);

export const RESULTS = ['success', 'near', 'failure'];
export const RESULT_LABELS = { success: '○ 成功', near: '△ 惜しい', failure: '× 失敗' };
export const MISS_TYPES = ['top', 'duff', 'short', 'over', 'other'];
export const MISS_LABELS = { top: 'トップ', duff: 'ダフリ', short: 'ショート', over: 'オーバー', other: 'その他' };
/** 判定ごとに選べるミス原因（トップは × のみ） */
export const MISS_TYPES_FOR = {
  success: [],
  near: ['duff', 'short', 'over', 'other'],
  failure: ['top', 'duff', 'short', 'over', 'other'],
};

export const STATUSES = ['active', 'completed', 'aborted'];

export const DEFAULT_SETTINGS = Object.freeze({
  mode: 'random',
  totalShots: 30,
  club: 'SW',
  randomDistances: [10, 15, 20],
  fixedDistance: 15,
});

export const ALL_DISTANCES = Array.from({ length: MAX_DISTANCE - MIN_DISTANCE + 1 }, (_, i) => MIN_DISTANCE + i);

export function isValidDistance(d) {
  return Number.isInteger(d) && d >= MIN_DISTANCE && d <= MAX_DISTANCE;
}

/** 範囲外・重複を除き昇順にした距離一覧 */
export function cleanDistances(list) {
  if (!Array.isArray(list)) return [];
  return [...new Set(list.filter(isValidDistance))].sort((a, b) => a - b);
}

/** 保存データなどから読んだ設定を、不正な項目だけ初期値に戻して返す */
export function normalizeSettings(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const randomDistances = cleanDistances(s.randomDistances);
  return {
    mode: MODES.includes(s.mode) ? s.mode : DEFAULT_SETTINGS.mode,
    totalShots: SHOT_COUNTS.includes(s.totalShots) ? s.totalShots : DEFAULT_SETTINGS.totalShots,
    club: CLUB_IDS.includes(s.club) ? s.club : DEFAULT_SETTINGS.club,
    // 0件は初期値に戻す（1件はユーザーが選択途中の状態として保持する）
    randomDistances: randomDistances.length ? randomDistances : [...DEFAULT_SETTINGS.randomDistances],
    fixedDistance: isValidDistance(s.fixedDistance) ? s.fixedDistance : DEFAULT_SETTINGS.fixedDistance,
  };
}

/** ランダム距離のオン・オフを切り替えた新しい距離一覧 */
export function toggleDistance(list, d) {
  if (!isValidDistance(d)) return cleanDistances(list);
  const set = new Set(cleanDistances(list));
  if (set.has(d)) set.delete(d); else set.add(d);
  return cleanDistances([...set]);
}

/** 開始できない理由を返す。開始できるときは null */
export function validateSettings(settings) {
  if (!MODES.includes(settings?.mode)) return '練習モードを選んでください';
  if (!SHOT_COUNTS.includes(settings.totalShots)) return '球数を選んでください';
  if (!CLUB_IDS.includes(settings.club)) return 'クラブを選んでください';
  if (settings.mode === 'random') {
    const raw = Array.isArray(settings.randomDistances) ? settings.randomDistances : [];
    if (raw.some((d) => !isValidDistance(d))) return `距離は${MIN_DISTANCE}〜${MAX_DISTANCE}ydで選んでください`;
    if (cleanDistances(raw).length < 2) return 'ランダムでは距離を2つ以上選んでください';
  } else if (!isValidDistance(settings.fixedDistance)) {
    return `距離は${MIN_DISTANCE}〜${MAX_DISTANCE}ydで選んでください`;
  }
  return null;
}

/** 設定から出題対象の距離一覧を返す */
export function selectedDistancesOf(settings) {
  return settings.mode === 'fixed' ? [settings.fixedDistance] : cleanDistances(settings.randomDistances);
}

function randomInt(n, rng) {
  return Math.min(n - 1, Math.floor(rng() * n));
}

function shuffle(list, rng) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1, rng);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * 各距離の出題回数（差は最大1回）。端数を受け持つ距離はランダムに決める。
 * 戻り値は Map(距離 → 回数)
 */
export function distributeCounts(distances, total, rng = Math.random) {
  const list = cleanDistances(distances);
  const counts = new Map(list.map((d) => [d, Math.floor(total / list.length)]));
  shuffle(list, rng).slice(0, total % list.length).forEach((d) => counts.set(d, counts.get(d) + 1));
  return counts;
}

/**
 * 出題順を作る。各距離の回数を均等（差は最大1回）にしたうえで、同じ距離が連続しない並びをランダムに選ぶ。
 * 連続を避けられない場合（距離が1種類など）は回数を優先する。
 */
export function buildSequence(distances, total, rng = Math.random) {
  const list = cleanDistances(distances);
  if (!list.length || !(total > 0)) return [];
  const counts = distributeCounts(list, total, rng);
  const seq = [];
  let last = null;
  for (let rem = total; rem > 0; rem--) {
    const available = list.filter((d) => counts.get(d) > 0);
    let candidates = available.filter((d) => d !== last);
    if (!candidates.length) candidates = available;
    // 残り回数が半数を超える距離は今出さないと後で連続が避けられないので優先する
    const forced = candidates.find((d) => counts.get(d) * 2 > rem);
    let pick = forced;
    if (pick === undefined) {
      // 残り回数に比例した重みで選ぶ（回数の多い距離を後に残しすぎない）
      const weight = candidates.reduce((sum, d) => sum + counts.get(d), 0);
      let r = rng() * weight;
      pick = candidates[candidates.length - 1];
      for (const d of candidates) {
        r -= counts.get(d);
        if (r < 0) { pick = d; break; }
      }
    }
    seq.push(pick);
    counts.set(pick, counts.get(pick) - 1);
    last = pick;
  }
  return seq;
}

export function newId(now = new Date(), rng = Math.random) {
  return `s-${now.getTime().toString(36)}-${Math.floor(rng() * 1e9).toString(36)}`;
}

/** 設定から練習中セッションを作る（開始時に全出題順を確定する） */
export function createSession(settings, { now = new Date(), rng = Math.random, id } = {}) {
  const error = validateSettings(settings);
  if (error) throw new Error(error);
  const selectedDistances = selectedDistancesOf(settings);
  const distanceSequence = settings.mode === 'fixed'
    ? Array(settings.totalShots).fill(settings.fixedDistance)
    : buildSequence(selectedDistances, settings.totalShots, rng);
  return {
    id: id ?? newId(now, rng),
    startedAt: now.toISOString(),
    endedAt: null,
    status: 'active',
    mode: settings.mode,
    club: settings.club,
    totalShots: settings.totalShots,
    selectedDistances,
    distanceSequence,
    shots: [],
  };
}

/** 次に打つ球（1始まりの番号・目標距離・クラブ）。全球入力済みなら null */
export function currentShot(session) {
  const i = session.shots.length;
  if (i >= session.totalShots) return null;
  return { shotNumber: i + 1, targetDistance: session.distanceSequence[i], club: session.club };
}

/** 判定とミス原因の組み合わせが正しいか */
export function isValidJudgement(result, missType) {
  if (!RESULTS.includes(result)) return false;
  if (result === 'success') return missType === null;
  return MISS_TYPES_FOR[result].includes(missType);
}

/**
 * 1球の結果を記録した新しいセッションを返す（元のセッションは変更しない）。
 * 不正な組み合わせ（トップを △ で記録など）や全球入力済みのときは例外。
 */
export function recordShot(session, result, missType = null) {
  if (session.status !== 'active') throw new Error('練習中ではありません');
  const shot = currentShot(session);
  if (!shot) throw new Error('全球入力済みです');
  if (!isValidJudgement(result, missType)) throw new Error('判定とミス原因の組み合わせが正しくありません');
  return {
    ...session,
    shots: [...session.shots, { ...shot, mode: session.mode, result, missType }],
  };
}

/** 直前の1球を取り消した新しいセッションを返す（出題順は変えない） */
export function undoShot(session) {
  if (!session.shots.length) return session;
  return { ...session, shots: session.shots.slice(0, -1) };
}

export function isFinished(session) {
  return session.shots.length >= session.totalShots;
}

export function completeSession(session, now = new Date()) {
  return { ...session, status: 'completed', endedAt: now.toISOString() };
}

export function abortSession(session, now = new Date()) {
  return { ...session, status: 'aborted', endedAt: now.toISOString() };
}

// ---- 集計 ----

/** 割合（%）。分母0は null */
export function rate(count, total) {
  return total > 0 ? (count / total) * 100 : null;
}

/** 割合の表示（小数第1位まで。null は「—」） */
export function formatRate(value) {
  return value === null || value === undefined ? '—' : `${value.toFixed(1)}%`;
}

/** 球の一覧から成績を計算する */
export function summarize(shots) {
  const total = shots.length;
  const count = (fn) => shots.filter(fn).length;
  const success = count((s) => s.result === 'success');
  const near = count((s) => s.result === 'near');
  const failure = count((s) => s.result === 'failure');
  const top = count((s) => s.missType === 'top');
  const otherMiss = count((s) => s.missType !== null && s.missType !== 'top');
  return {
    total, success, near, failure, top, otherMiss,
    successRate: rate(success, total),
    topRate: rate(top, total),
    otherMissRate: rate(otherMiss, total),
  };
}

/** 距離別成績（距離の昇順） */
export function summarizeByDistance(shots) {
  const distances = [...new Set(shots.map((s) => s.targetDistance))].sort((a, b) => a - b);
  return distances.map((d) => ({ distance: d, ...summarize(shots.filter((s) => s.targetDistance === d)) }));
}

/** クラブ別成績（登録クラブすべて。打球0のクラブも含める） */
export function summarizeByClub(shots) {
  return CLUB_IDS.map((club) => ({ club, ...summarize(shots.filter((s) => s.club === club)) }));
}

/** 通常集計に含めるセッション（完了のみ。途中終了は含めない） */
export function completedSessions(history) {
  return history.filter((s) => s.status === 'completed');
}

/** 全体集計：完了セッションの全球 */
export function overallShots(history) {
  return completedSessions(history).flatMap((s) => s.shots);
}

/** 新しい順に並べた履歴 */
export function sortHistory(history) {
  return [...history].sort((a, b) => (a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0));
}

/** 直近 n 件の完了セッションの成績（新しい順） */
export function recentTrend(history, n = 10) {
  return sortHistory(completedSessions(history)).slice(0, n).map((s) => ({
    id: s.id, startedAt: s.startedAt, club: s.club, mode: s.mode, ...summarize(s.shots),
  }));
}

export function deleteSession(history, id) {
  return history.filter((s) => s.id !== id);
}

/** 設定距離の表示（例：10・15・20yd） */
export function distancesLabel(distances) {
  return `${distances.join('・')}yd`;
}

/** 日時の表示（例：2026/11/17 19:05） */
export function formatDateTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// ---- 二重タップ防止 ----

/**
 * 一定時間内の連続操作を1回にまとめるガード。
 * ○ をすばやく2回押すと、2回目が次の球の ○ になってしまうのを防ぐ。
 */
export function createTapGuard(intervalMs = 500, clock = () => Date.now()) {
  let until = 0;
  return {
    /** 操作を受け付けるなら true を返し、以後 intervalMs の間は false を返す */
    tryAcquire() {
      const t = clock();
      if (t < until) return false;
      until = t + intervalMs;
      return true;
    },
  };
}

// ---- 保存データの検証 ----

function normalizeShot(raw, index, session) {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.shotNumber !== index + 1) return null;
  if (raw.targetDistance !== session.distanceSequence[index]) return null;
  if (!CLUB_IDS.includes(raw.club)) return null;
  const missType = raw.missType ?? null;
  if (!isValidJudgement(raw.result, missType)) return null;
  return {
    shotNumber: raw.shotNumber,
    targetDistance: raw.targetDistance,
    club: raw.club,
    mode: MODES.includes(raw.mode) ? raw.mode : session.mode,
    result: raw.result,
    missType,
  };
}

/** 保存データから読んだセッションを検証する。不正なら null */
export function normalizeSession(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (typeof raw.id !== 'string' || !raw.id) return null;
  if (!STATUSES.includes(raw.status) || !MODES.includes(raw.mode) || !CLUB_IDS.includes(raw.club)) return null;
  if (!SHOT_COUNTS.includes(raw.totalShots)) return null;
  if (typeof raw.startedAt !== 'string' || Number.isNaN(Date.parse(raw.startedAt))) return null;
  const seq = raw.distanceSequence;
  if (!Array.isArray(seq) || seq.length !== raw.totalShots || !seq.every(isValidDistance)) return null;
  const selected = cleanDistances(raw.selectedDistances);
  if (!selected.length) return null;
  if (!Array.isArray(raw.shots) || raw.shots.length > raw.totalShots) return null;
  const base = {
    id: raw.id,
    startedAt: raw.startedAt,
    endedAt: typeof raw.endedAt === 'string' ? raw.endedAt : null,
    status: raw.status,
    mode: raw.mode,
    club: raw.club,
    totalShots: raw.totalShots,
    selectedDistances: selected,
    distanceSequence: [...seq],
  };
  const shots = raw.shots.map((s, i) => normalizeShot(s, i, base));
  if (shots.some((s) => !s)) return null;
  return { ...base, shots };
}
