// ============================================================
//  テンパズル v11 — BGM追加（チップチューン・フィーバー切替・残り10秒テンポアップ）
//  構成: 定数 → ペア情報 → 実績定義 → デイリープール → SE効果音
//        → BGM → ゲーム状態 → localStorage → タイマー → デイリー → 実績
//        → 盤面生成 → 初期化 → 描画 → 操作
//        → 正解/不正解 → 重力 → ゲームオーバー → フィーバー
//        → 表示更新 → リセット → ペアトラッキング → パネル描画 → タブ
//        → エフェクト共通 → エフェクト → キャラクター
//        → チュートリアル → 起動
// ============================================================

// ============================================================
//  定数
// ============================================================

const ROWS                  = 6;
const COLS                  = 5;
const TARGET                = 10;
const BASE_SCORE            = 10;
const FEVER_COMBO_THRESHOLD = 5;   // フィーバー突入に必要なコンボ数
const FEVER_DURATION        = 8000; // フィーバー持続 ms
const FEVER_MULTIPLIER      = 2;    // フィーバー時スコア倍率
const MIN_PAIRS_ON_BOARD    = 8;    // 盤面生成時に保証する最低ペア数
const GAME_TIME             = 90;   // 1プレイの制限時間（秒）

// ============================================================
//  コンボ仕様（ここだけ読めばコンボの動きが分かる）
// ============================================================
//
//  ・正解するたびに combo +1
//  ・ミスすると combo = 0 に戻る
//  ・時間が空いてもコンボは切れない（焦らせない設計）
//  ・5コンボで FEVER 突入
//
//  フィーバー終了後の扱い:
//    FEVER_RESET_COMBO_ON_END = true  → 終了時にコンボを0に戻す（現在の設定）
//    false にするとフィーバー後もコンボが引き継がれる
//
const FEVER_RESET_COMBO_ON_END = true;

/**
 * コンボ数 → スコア倍率テーブル
 * index 0 = 1コンボ(×1), index 1 = 2コンボ(×2), ..., index 4+ = ×8
 */
const COMBO_MULTS = [1, 2, 3, 5, 8];

/** コンボ数からスコア倍率を返す */
function getComboMult(c) {
  if (c <= 0) return 1;
  return COMBO_MULTS[Math.min(c - 1, COMBO_MULTS.length - 1)];
}

/** セル値ごとの基本色（パーティクル色に使用） */
const CELL_COLORS = {
  1: '#e74c3c', 2: '#e67e22', 3: '#f1c40f',
  4: '#2ecc71', 5: '#1abc9c', 6: '#3498db',
  7: '#9b59b6', 8: '#e91e63', 9: '#546e7a',
};

// ============================================================
//  ペア情報（図鑑・デイリー表示に使用）
// ============================================================

const PAIR_INFO = [
  { key: '19', label: '1 + 9', color: '#e74c3c' },
  { key: '28', label: '2 + 8', color: '#e67e22' },
  { key: '37', label: '3 + 7', color: '#f1c40f' },
  { key: '46', label: '4 + 6', color: '#2ecc71' },
  { key: '55', label: '5 + 5', color: '#1abc9c' },
];

// ============================================================
//  実績定義
// ============================================================

const ACHIEVEMENTS = [
  { id: 'firstFever', name: '初フィーバー',  desc: 'フィーバーに初めて突入した',      check: () => allTimeFeverCount >= 1  },
  { id: 'combo5',     name: '5コンボ達成',   desc: '5コンボを達成した',              check: () => allTimeMaxCombo >= 5    },
  { id: 'combo10',    name: '10コンボ達成',  desc: '10コンボを達成した',             check: () => allTimeMaxCombo >= 10   },
  { id: 'pair19_10',  name: '1+9 ×10',      desc: '1+9 を10回消した',              check: () => (pairCounts['19'] || 0) >= 10 },
  { id: 'pair28_10',  name: '2+8 ×10',      desc: '2+8 を10回消した',              check: () => (pairCounts['28'] || 0) >= 10 },
  { id: 'pair37_10',  name: '3+7 ×10',      desc: '3+7 を10回消した',              check: () => (pairCounts['37'] || 0) >= 10 },
  { id: 'pair46_10',  name: '4+6 ×10',      desc: '4+6 を10回消した',              check: () => (pairCounts['46'] || 0) >= 10 },
  { id: 'pair55_10',  name: '5+5 ×10',      desc: '5+5 を10回消した',              check: () => (pairCounts['55'] || 0) >= 10 },
  { id: 'allPairs10', name: '全ペア制覇',    desc: '全ペアを10回以上消した',         check: () => PAIR_INFO.every(p => (pairCounts[p.key] || 0) >= 10) },
  { id: 'score500',   name: 'スコア500',     desc: '1ゲームでスコア500を達成した',   check: () => highScore >= 500  },
  { id: 'score1000',  name: 'スコア1000',    desc: '1ゲームでスコア1000を達成した',  check: () => highScore >= 1000 },
];

// ============================================================
//  デイリーチャレンジ候補プール
// ============================================================

const DAILY_POOL = [
  { type: 'pair',  key: '19', target: 5, desc: '今日は 1+9 を5回消そう！' },
  { type: 'pair',  key: '28', target: 5, desc: '今日は 2+8 を5回消そう！' },
  { type: 'pair',  key: '37', target: 5, desc: '今日は 3+7 を5回消そう！' },
  { type: 'pair',  key: '46', target: 5, desc: '今日は 4+6 を5回消そう！' },
  { type: 'pair',  key: '55', target: 3, desc: '今日は 5+5 を3回消そう！' },
  { type: 'combo', target: 5, desc: '今日は5コンボを達成しよう！' },
  { type: 'combo', target: 7, desc: '今日は7コンボを達成しよう！' },
];

// ============================================================
//  Web Audio API — チップチューン効果音（SE）
// ============================================================

let audioCtx = null;
let soundOn  = localStorage.getItem('soundOn') !== '0';

function getAudioCtx() {
  if (!audioCtx) {
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {
      return null;
    }
  }
  if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
  return audioCtx;
}

function beep(freq, dur, { endFreq, type = 'square', vol = 0.2, delay = 0 } = {}) {
  try {
    const ctx = getAudioCtx();
    if (!ctx) return;
    const t    = ctx.currentTime + delay;
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (endFreq != null) osc.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  } catch (e) {}
}

function playSound(name) {
  if (!soundOn) return;
  switch (name) {
    case 'tap':
      beep(900, 0.04, { endFreq: 700, vol: 0.15 });
      break;
    case 'match':
      beep(660, 0.08, { vol: 0.20 });
      beep(880, 0.10, { endFreq: 1100, vol: 0.20, delay: 0.08 });
      break;
    case 'combo':
      beep( 523, 0.06, { vol: 0.20 });
      beep( 659, 0.06, { vol: 0.20, delay: 0.06 });
      beep(1047, 0.10, { endFreq: 1300, vol: 0.22, delay: 0.12 });
      break;
    case 'fever-match':
      beep(1047, 0.06, { vol: 0.22 });
      beep(1319, 0.09, { endFreq: 1568, vol: 0.22, delay: 0.06 });
      break;
    case 'wrong':
    case 'miss':
      beep(200, 0.06, { vol: 0.25 });
      beep(130, 0.09, { vol: 0.20, delay: 0.06 });
      break;
    case 'gameover':
      beep(440, 0.12, { vol: 0.20 });
      beep(370, 0.12, { vol: 0.20, delay: 0.15 });
      beep(311, 0.12, { vol: 0.20, delay: 0.30 });
      beep(220, 0.22, { vol: 0.20, delay: 0.45 });
      break;
    case 'fever':
      beep( 523, 0.05, { vol: 0.20 });
      beep( 659, 0.05, { vol: 0.20, delay: 0.05 });
      beep( 784, 0.05, { vol: 0.20, delay: 0.10 });
      beep(1047, 0.12, { endFreq: 1400, vol: 0.25, delay: 0.15 });
      break;
  }
}

function saveSoundOn() {
  localStorage.setItem('soundOn', soundOn ? '1' : '0');
}

// ============================================================
//  BGM — Web Audio API チップチューン
// ============================================================
//
//  外部ファイル不要。oscillator でメロディを生成してループ再生。
//
//  startBgm(type)       ゲーム開始/リスタート時に呼ぶ
//  stopBgm()            ゲームオーバー時に呼ぶ
//  switchBgm(type)      フィーバー突入/終了時に呼ぶ
//  setBgmUrgentMode(b)  残り10秒になったら true を渡す（テンポアップ）
//  type: 'normal' | 'fever'
//
// ============================================================

let bgmOn = localStorage.getItem('bgmOn') !== '0';
function saveBgmOn() { localStorage.setItem('bgmOn', bgmOn ? '1' : '0'); }

// ── シーケンス定義 ────────────────────────────────────────────
// [周波数Hz, 拍数] の配列
//   1拍 = 4分音符、0.5 = 8分音符、0.25 = 16分音符
//   周波数0は休符
//
// 通常BGM — Cメジャー, 明るい, 16拍ループ（120BPMで8秒）
const BGM_SEQ_NORMAL = [
  // Bar 1: Cコード分散
  [523, 0.5], [659, 0.5], [784, 0.5], [659, 0.5],   // C5 E5 G5 E5
  [523, 0.5], [587, 0.5], [659, 0.5], [523, 0.5],   // C5 D5 E5 C5
  // Bar 2: 低音からの上昇→解決
  [392, 0.5], [440, 0.5], [494, 0.5], [523, 0.5],   // G4 A4 B4 C5
  [587, 0.75],[659, 0.25],[523, 1.0],                // D5(付点) E5 C5(4分)
  // Bar 3: 高音域変奏
  [659, 0.5], [784, 0.5], [880, 0.5], [784, 0.5],   // E5 G5 A5 G5
  [659, 0.5], [523, 0.5], [587, 0.5], [659, 0.5],   // E5 C5 D5 E5
  // Bar 4: フィナーレへ
  [587, 0.5], [659, 0.5], [784, 0.5], [659, 0.5],   // D5 E5 G5 E5
  [587, 1.0], [523, 1.0],                            // D5(4分) C5(4分)
];
// 各バー4拍 × 4 = 16拍 ✓

// フィーバーBGM — 高音・躍動感, 16拍ループ（156BPMで約6.2秒）
const BGM_SEQ_FEVER = [
  // Bar 1: 高音域ダッシュ
  [784, 0.5],  [880, 0.5],  [1047, 0.5], [880, 0.5],  // G5 A5 C6 A5
  [784, 0.25], [659, 0.25], [784, 0.5],  [1047, 0.5], // G5 E5 G5 C6
  [659, 0.5],                                          // E5
  // Bar 2: テンションをキープ
  [880, 0.25], [784, 0.25], [659, 0.5],  [784, 0.5],  // A5 G5 E5 G5
  [880, 0.5],  [1047, 0.75],[880, 0.25],              // A5 C6(付点) A5
  [659, 0.5],  [523, 0.5],                            // E5 C5
  // Bar 3: ぐるぐる上昇
  [659, 0.5],  [784, 0.5],  [880, 0.5],  [1047, 0.5], // E5 G5 A5 C6
  [880, 0.5],  [784, 0.5],  [659, 0.5],  [784, 0.5],  // A5 G5 E5 G5
  // Bar 4: フィナーレ解決
  [880, 0.5],  [784, 0.5],  [659, 0.5],  [784, 0.5],  // A5 G5 E5 G5
  [659, 1.0],  [523, 1.0],                             // E5(4分) C5(4分)
];
// bar1: 0.5×4+0.25+0.25+0.5+0.5+0.5=4 ✓
// bar2: 0.25+0.25+0.5+0.5+0.5+0.75+0.25+0.5+0.5=4 ✓
// bar3: 0.5×8=4 ✓  bar4: 0.5×4+1+1=4 ✓  合計16拍 ✓

// ── BPM設定 ──────────────────────────────────────────────────
const BGM_BPM = {
  normal:       120,   // 通常（120 BPM、8秒ループ）
  fever:        156,   // フィーバー（156 BPM、約6.2秒ループ）
  normalUrgent: 152,   // 通常・残り10秒テンポアップ
  feverUrgent:  196,   // フィーバー・残り10秒テンポアップ
};

// ── BGM内部状態 ──────────────────────────────────────────────
let bgmType        = null;     // null | 'normal' | 'fever'
let bgmUrgent      = false;
let bgmNoteIdx     = 0;
let bgmNextTime    = 0;
let bgmTickTimer   = null;
let bgmActiveNodes = [];       // { osc, envGain } の配列
let bgmGainNode    = null;     // BGM用マスターゲインノード

/** BGM用マスターゲインノードを返す（なければ作成） */
function getBgmGain() {
  const ctx = getAudioCtx();
  if (!ctx) return null;
  if (!bgmGainNode) {
    bgmGainNode = ctx.createGain();
    bgmGainNode.gain.value = 1.0;
    bgmGainNode.connect(ctx.destination);
  }
  return bgmGainNode;
}

/** 現在の状態から秒/拍（seconds per beat）を返す */
function getBgmSpb() {
  const key = bgmType === 'fever'
    ? (bgmUrgent ? 'feverUrgent' : 'fever')
    : (bgmUrgent ? 'normalUrgent' : 'normal');
  return 60 / BGM_BPM[key];
}

/** 音符1つをWeb Audio APIでスケジュール */
function scheduleBgmNote(freq, startTime, durationSec) {
  if (freq === 0) return; // 休符
  const ctx = getAudioCtx();
  const mg  = getBgmGain();
  if (!ctx || !mg) return;

  const osc     = ctx.createOscillator();
  const envGain = ctx.createGain();
  osc.connect(envGain);
  envGain.connect(mg);

  osc.type = 'square';
  osc.frequency.setValueAtTime(freq, startTime);

  const vol     = 0.06;                                    // BGMは控えめな音量
  const noteLen = Math.max(durationSec * 0.80, 0.02);      // ノートは80%、残り20%は無音（スタッカート感）

  envGain.gain.setValueAtTime(0, startTime);
  envGain.gain.linearRampToValueAtTime(vol, startTime + 0.008);              // アタック
  envGain.gain.setValueAtTime(vol, startTime + Math.max(noteLen - 0.025, 0.01));
  envGain.gain.exponentialRampToValueAtTime(0.001, startTime + noteLen);    // リリース

  osc.start(startTime);
  osc.stop(startTime + noteLen + 0.02);

  const entry = { osc, envGain };
  bgmActiveNodes.push(entry);
  osc.onended = () => { bgmActiveNodes = bgmActiveNodes.filter(n => n !== entry); };
}

// 先読みスケジューリング設定
const BGM_LOOKAHEAD = 0.15;  // 150ms 先読み
const BGM_TICK_MS   = 40;    // ティック間隔（ms）

/** スケジューラーのティック — 一定間隔で次の音符をキューに積む */
function bgmTick() {
  if (!bgmOn || !bgmType) return;
  const ctx = getAudioCtx();
  if (!ctx) return;

  if (ctx.state === 'suspended') {
    ctx.resume().catch(() => {});
    bgmTickTimer = setTimeout(bgmTick, BGM_TICK_MS);
    return;
  }

  // bgmNextTime が過去になっていたら（AudioContext停止後再開など）現在時刻に合わせる
  if (bgmNextTime < ctx.currentTime) {
    bgmNextTime = ctx.currentTime + 0.01;
  }

  const seq = bgmType === 'fever' ? BGM_SEQ_FEVER : BGM_SEQ_NORMAL;
  const spb = getBgmSpb();

  while (bgmNextTime < ctx.currentTime + BGM_LOOKAHEAD) {
    const [freq, beats] = seq[bgmNoteIdx % seq.length];
    scheduleBgmNote(freq, bgmNextTime, beats * spb);
    bgmNextTime += beats * spb;
    bgmNoteIdx++;
  }

  bgmTickTimer = setTimeout(bgmTick, BGM_TICK_MS);
}

/** 再生中のノードを停止してティックを止める */
function stopBgmNodes() {
  clearTimeout(bgmTickTimer);
  bgmTickTimer = null;
  const ctx    = getAudioCtx();
  const stopAt = ctx ? ctx.currentTime + 0.02 : 0;
  bgmActiveNodes.forEach(({ osc }) => {
    try { osc.stop(stopAt); } catch (e) {}
  });
  bgmActiveNodes = [];
}

// ── 公開 BGM API ─────────────────────────────────────────────

/** BGMを開始する。type='normal'|'fever' */
function startBgm(type) {
  stopBgmNodes();
  bgmType    = type;
  bgmNoteIdx = 0;
  if (!bgmOn) return;
  const ctx = getAudioCtx();
  if (!ctx) return;
  bgmNextTime = ctx.currentTime + 0.05;
  bgmTick();
}

/** BGMを停止する */
function stopBgm() {
  stopBgmNodes();
  bgmType = null;
}

/** BGMタイプを切り替える（同じタイプなら何もしない） */
function switchBgm(type) {
  if (bgmType === type) return;
  startBgm(type);
}

/**
 * 残り10秒のテンポアップ
 * isUrgent=true でテンポアップ、false で通常テンポに戻す（通常は1回だけ呼ぶ）
 * メロディの流れを保ちつつ、次の音符からテンポを変更する
 */
function setBgmUrgentMode(isUrgent) {
  if (bgmUrgent === isUrgent) return;
  bgmUrgent = isUrgent;
  if (!bgmType || !bgmOn) return;
  // 現在スケジュール済みのノードを止め、直ちに新テンポで再スケジュール
  stopBgmNodes();
  const ctx = getAudioCtx();
  if (ctx) bgmNextTime = ctx.currentTime + 0.04;
  bgmTick();
}

/**
 * BGMが未起動の場合に開始する
 * AudioContext が初回クリックで作成されたあとに呼ぶ
 */
function tryResumeBgm() {
  if (bgmOn && bgmType && !bgmTickTimer && !isOver) {
    const ctx = getAudioCtx();
    if (ctx) {
      bgmNextTime = ctx.currentTime + 0.05;
      bgmTick();
    }
  }
}

// ============================================================
//  ゲーム状態
// ============================================================

let grid        = [];
let selected    = null;
let score       = 0;
let combo       = 0;
let isFever     = false;
let feverTimer  = null;
let isAnimating = false;
let isOver      = false;

// --- タイマー状態 ---
let timeLeft      = GAME_TIME;
let timerInterval = null;

// --- localStorage 永続化 ---
let highScore            = parseInt(localStorage.getItem('highScore')    || '0', 10);
let allTimeMaxCombo      = parseInt(localStorage.getItem('maxCombo')     || '0', 10);
let allTimeFeverCount    = parseInt(localStorage.getItem('feverCount')   || '0', 10);
let pairCounts           = JSON.parse(localStorage.getItem('pairCounts') || '{}');
let unlockedAchievements = new Set(JSON.parse(localStorage.getItem('unlocked') || '[]'));

// --- デイリー（loadDailyState で初期化） ---
let daily      = null;
let dailyState = null;

// ============================================================
//  localStorage セーブ
// ============================================================

function saveHighScore()  { localStorage.setItem('highScore',  highScore); }
function saveMaxCombo()   { localStorage.setItem('maxCombo',   allTimeMaxCombo); }
function saveFeverCount() { localStorage.setItem('feverCount', allTimeFeverCount); }
function savePairCounts() { localStorage.setItem('pairCounts', JSON.stringify(pairCounts)); }
function saveUnlocked()   { localStorage.setItem('unlocked',   JSON.stringify([...unlockedAchievements])); }
function saveDailyState() { localStorage.setItem('daily',      JSON.stringify(dailyState)); }

// ============================================================
//  タイマー
// ============================================================

function startTimer() {
  timeLeft = GAME_TIME;
  updateTimerDisplay();
  clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    timeLeft--;
    updateTimerDisplay();
    if (timeLeft === 10) setBgmUrgentMode(true); // 残り10秒でBGMテンポアップ
    if (timeLeft <= 0) {
      stopTimer();
      if (!isOver) triggerGameOver();
    }
  }, 1000);
}

function stopTimer() {
  clearInterval(timerInterval);
  timerInterval = null;
}

function updateTimerDisplay() {
  const el = document.getElementById('timer-display');
  if (!el) return;
  const m = Math.floor(timeLeft / 60);
  const s = timeLeft % 60;
  el.textContent = `${m}:${String(s).padStart(2, '0')}`;
  el.classList.toggle('timer-low', timeLeft <= 10);
}

// ============================================================
//  デイリーチャレンジ
// ============================================================

function getTodayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function selectDailyChallenge(dateKey) {
  const hash = [...dateKey].reduce((s, c) => s + c.charCodeAt(0), 0);
  return DAILY_POOL[hash % DAILY_POOL.length];
}

function loadDailyState() {
  const today  = getTodayKey();
  const stored = JSON.parse(localStorage.getItem('daily') || '{}');
  daily = selectDailyChallenge(today);
  if (stored.date === today) {
    dailyState = stored;
  } else {
    dailyState = { date: today, progress: 0, completed: false };
    saveDailyState();
  }
}

function updateDailyPairProgress(pairKey) {
  if (daily.type !== 'pair' || daily.key !== pairKey || dailyState.completed) return;
  dailyState.progress++;
  if (dailyState.progress >= daily.target) {
    dailyState.completed = true;
    updateTabBadges();
    showToast('デイリー達成！', 'daily');
  }
  saveDailyState();
}

function updateDailyComboProgress(comboVal) {
  if (daily.type !== 'combo' || dailyState.completed) return;
  if (comboVal > (dailyState.progress || 0)) {
    dailyState.progress = comboVal;
    saveDailyState();
  }
  if (dailyState.progress >= daily.target) {
    dailyState.completed = true;
    updateTabBadges();
    showToast('デイリー達成！', 'daily');
    saveDailyState();
  }
}

// ============================================================
//  実績トラッキング
// ============================================================

function checkAllAchievements() {
  ACHIEVEMENTS.forEach(ach => {
    if (!unlockedAchievements.has(ach.id) && ach.check()) {
      unlockedAchievements.add(ach.id);
      saveUnlocked();
      showToast(`じっせきかいじょ: ${ach.name}`, 'achievement');
    }
  });
}

// ============================================================
//  盤面生成
// ============================================================

function randomNum() {
  return Math.floor(Math.random() * 9) + 1;
}

function hasSufficientPairs() {
  const vals = grid.flat();
  let count = 0;
  for (let i = 0; i < vals.length; i++) {
    for (let j = i + 1; j < vals.length; j++) {
      if (vals[i] + vals[j] === TARGET) {
        count++;
        if (count >= MIN_PAIRS_ON_BOARD) return true;
      }
    }
  }
  return false;
}

function generateBoard() {
  let attempts = 0;
  do {
    grid = Array.from({ length: ROWS }, () =>
      Array.from({ length: COLS }, randomNum)
    );
    attempts++;
  } while (!hasSufficientPairs() && attempts < 20);
}

// ============================================================
//  初期化
// ============================================================

function init() {
  generateBoard();
  selected    = null;
  score       = 0;
  combo       = 0;
  isAnimating = false;
  isOver      = false;
  isFever     = false;
  bgmUrgent   = false;  // BGMテンポをリセット（残り10秒フラグ解除）

  clearTimeout(feverTimer);
  clearTimeout(charResetTimer);

  hideGameOver();
  updateFeverUI(false);
  setCharState('normal', '', '');
  render();
  updateScoreDisplay();
  updateComboDisplay();
  startTimer();
  startBgm('normal');   // 通常BGMを開始
}

// ============================================================
//  描画（グリッド）
// ============================================================

function render(newCells = []) {
  const gridEl = document.getElementById('grid');
  gridEl.innerHTML = '';
  const newSet = new Set(newCells.map(({ r, c }) => `${r},${c}`));

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const cell = document.createElement('div');
      cell.className   = 'cell';
      cell.dataset.row = r;
      cell.dataset.col = c;
      cell.textContent = grid[r][c];
      cell.dataset.val = grid[r][c];

      if (selected && selected.row === r && selected.col === c) cell.classList.add('selected');
      if (newSet.has(`${r},${c}`))                              cell.classList.add('drop-in');

      cell.addEventListener('click', () => onCellClick(r, c));
      gridEl.appendChild(cell);
    }
  }
}

function getCellEl(r, c) {
  return document.querySelector(`.cell[data-row="${r}"][data-col="${c}"]`);
}

// ============================================================
//  インタラクション
// ============================================================

async function onCellClick(r, c) {
  getAudioCtx(); // iOS Safari: ユーザー操作内で AudioContext を起動
  tryResumeBgm(); // BGMが未起動なら開始（初回クリック対応）

  if (isAnimating || isOver) return;

  if (selected && selected.row === r && selected.col === c) {
    selected = null; render(); return;
  }

  if (!selected) {
    playSound('tap');
    selected = { row: r, col: c }; render(); return;
  }

  const a = grid[selected.row][selected.col];
  const b = grid[r][c];

  if (a + b === TARGET) await handleCorrectMatch(selected.row, selected.col, r, c);
  else                  await handleWrongMatch(selected.row, selected.col, r, c);
}

// ============================================================
//  正解処理
// ============================================================

/**
 * 正解ペアの処理
 *
 * コンボ仕様（v10 から時間制限なし）:
 *   - 正解するたびに combo +1
 *   - ミスすると combo = 0（時間が空いてもコンボは切れない）
 *
 * フィーバー仕様:
 *   - FEVER_COMBO_THRESHOLD コンボ達成で突入
 *   - 終了時は FEVER_RESET_COMBO_ON_END の設定に従う
 *
 * スコア:
 *   - BASE_SCORE × getComboMult(combo) × feverMult
 */
async function handleCorrectMatch(r1, c1, r2, c2) {
  isAnimating = true;
  const valA = grid[r1][c1];
  const valB = grid[r2][c2];

  // --- コンボ更新（時間制限なし・ミスのみリセット）---
  combo++;

  if (combo > allTimeMaxCombo) {
    allTimeMaxCombo = combo;
    saveMaxCombo();
  }

  // --- フィーバーチェック ---
  const wasAlreadyFever = isFever;
  if (!isFever) checkFeverStart();

  // --- スコア計算 ---
  const comboMult = getComboMult(combo);
  const feverMult = isFever ? FEVER_MULTIPLIER : 1;
  const points    = BASE_SCORE * comboMult * feverMult;
  score += points;

  // --- 演出 ---
  showEquation(valA, valB, r1, c1, r2, c2);
  spawnParticles(r1, c1, r2, c2, valA, valB);
  showScorePopup(r1, c1, points, combo);

  // 音
  if (wasAlreadyFever) {
    playSound('fever-match');
  } else {
    playSound(combo >= 2 ? 'combo' : 'match');
  }

  // --- キャラクター反応 ---
  if (wasAlreadyFever) {
    showCharSpeech(document.getElementById('speech-left'), '！');
  } else if (!isFever) {
    if      (combo >= 5) setCharState('combo', 'すごい！！', '!!!');
    else if (combo >= 3) setCharState('combo', 'はやい！',   '!!');
    else if (combo >= 2) setCharState('happy', 'いいね！',   'やった！');
    else                 setCharState('happy', 'いいね！',    '');
  }
  // フィーバー突入時: startFever() 内で setCharState('fever') 済み

  // ポップアウト
  const elA = getCellEl(r1, c1);
  const elB = getCellEl(r2, c2);
  if (elA) elA.classList.add('pop-out');
  if (elB) elB.classList.add('pop-out');

  await delay(180);

  // --- グリッド更新 ---
  grid[r1][c1] = null;
  grid[r2][c2] = null;
  const newCells = applyGravity();
  selected = null;
  render(newCells);
  updateScoreDisplay();
  updateComboDisplay();

  recordPair(valA, valB);
  updateDailyComboProgress(combo);
  checkAllAchievements();

  isAnimating = false;

  if (!hasPossibleMove()) { await delay(400); triggerGameOver(); }
}

// ============================================================
//  不正解処理
// ============================================================

/**
 * 不正解: コンボを0にリセット（時間ではなくミスでのみリセット）
 */
async function handleWrongMatch(r1, c1, r2, c2) {
  isAnimating = true;

  combo = 0;
  updateComboDisplay();

  setCharState('sad', 'がんばれ！', 'おしい！');

  const elA = getCellEl(r1, c1);
  if (elA) {
    elA.classList.add('wrong');
    playSound('wrong');
    await delay(320);
    elA.classList.remove('wrong');
  }
  selected = null;
  render();
  isAnimating = false;
}

// ============================================================
//  重力・補充
// ============================================================

function applyGravity() {
  const newCells = [];
  for (let c = 0; c < COLS; c++) {
    const values = [];
    for (let r = 0; r < ROWS; r++) {
      if (grid[r][c] !== null) values.push(grid[r][c]);
    }
    const newCount = ROWS - values.length;
    for (let r = 0; r < ROWS; r++) {
      if (r < newCount) { grid[r][c] = randomNum(); newCells.push({ r, c }); }
      else              { grid[r][c] = values[r - newCount]; }
    }
  }
  return newCells;
}

// ============================================================
//  ゲームオーバー
// ============================================================

function hasPossibleMove() {
  const vals = [];
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      vals.push(grid[r][c]);
  for (let i = 0; i < vals.length; i++)
    for (let j = i + 1; j < vals.length; j++)
      if (vals[i] + vals[j] === TARGET) return true;
  return false;
}

function triggerGameOver() {
  isOver = true;
  stopTimer();
  clearTimeout(feverTimer);
  isFever = false;
  updateFeverUI(false);
  stopBgm();                // BGMを停止
  playSound('gameover');
  setCharState('gameover', 'おつかれ！', '');
  document.getElementById('final-score').textContent = score;
  document.getElementById('final-best').textContent  = highScore;
  document.getElementById('game-over').classList.remove('hidden');
}

function hideGameOver() {
  document.getElementById('game-over').classList.add('hidden');
}

// ============================================================
//  フィーバーモード
// ============================================================

function checkFeverStart() {
  if (!isFever && combo >= FEVER_COMBO_THRESHOLD) startFever();
}

function startFever() {
  isFever = true;
  allTimeFeverCount++;
  saveFeverCount();
  clearTimeout(feverTimer);
  feverTimer = setTimeout(endFever, FEVER_DURATION);
  updateFeverUI(true);
  updateFeverBar();
  showFeverBanner();
  playSound('fever');
  switchBgm('fever');                              // フィーバーBGMへ切替
  setCharState('fever', 'FEVER!!', 'FEVER!!');
}

/**
 * フィーバー終了
 * コンボリセットの有無は FEVER_RESET_COMBO_ON_END で制御
 */
function endFever() {
  isFever = false;
  if (FEVER_RESET_COMBO_ON_END) {
    combo = 0;
  }
  updateFeverUI(false);
  updateComboDisplay();
  showToast('FEVER END', 'fever-end');
  switchBgm('normal');                             // 通常BGMへ戻す
  setCharState('normal', '', '');
}

function updateFeverUI(active) {
  const gridEl  = document.getElementById('grid');
  const barWrap = document.getElementById('fever-bar-wrap');
  const appEl   = document.getElementById('app');

  if (active) {
    gridEl.classList.add('fever-mode');
    barWrap.classList.add('active');
    appEl.classList.add('app-fever');
  } else {
    gridEl.classList.remove('fever-mode');
    barWrap.classList.remove('active');
    appEl.classList.remove('app-fever');
    const bar = document.getElementById('fever-bar');
    bar.style.transition = 'none';
    bar.style.width = '0%';
  }
}

function updateFeverBar() {
  const bar = document.getElementById('fever-bar');
  bar.style.transition = 'none';
  bar.style.width = '100%';
  void bar.offsetWidth;
  bar.style.transition = `width ${FEVER_DURATION}ms linear`;
  bar.style.width = '0%';
}

function showFeverBanner() {
  const banner = document.getElementById('fever-banner');
  banner.classList.remove('active');
  void banner.offsetWidth;
  banner.classList.add('active');
  banner.addEventListener('animationend', () => banner.classList.remove('active'), { once: true });
}

// ============================================================
//  スコア・コンボ表示
// ============================================================

function updateScoreDisplay() {
  document.getElementById('score').textContent = score;
  if (score > highScore) {
    highScore = score;
    saveHighScore();
  }
  document.getElementById('high-score').textContent = highScore;
}

/**
 * コンボ表示を更新する
 * combo=0    → "-"
 * combo=1    → 白（×1）
 * combo=2    → 緑（×2）
 * combo=3    → 橙（×3）
 * combo=4+   → 赤（×5以上）
 * isFever    → 金
 */
function updateComboDisplay() {
  const el = document.getElementById('combo');
  el.classList.remove('combo-cool', 'combo-warm', 'combo-hot', 'fever-mode', 'combo-pulse');

  if (combo <= 0) {
    el.textContent = '-';
    return;
  }

  el.textContent = `x${combo}`;

  if (isFever)         el.classList.add('fever-mode');
  else if (combo >= 4) el.classList.add('combo-hot');
  else if (combo >= 3) el.classList.add('combo-warm');
  else if (combo >= 2) el.classList.add('combo-cool');

  void el.offsetWidth;
  el.classList.add('combo-pulse');
}

// ============================================================
//  リセット
// ============================================================

function resetHighScore() {
  if (!confirm('ハイスコアをリセットしますか？')) return;
  highScore = 0;
  saveHighScore();
  updateScoreDisplay();
}

function resetAchievements() {
  if (!confirm('じっせき・ハイスコア・ずかんをすべてリセットしますか？')) return;
  unlockedAchievements = new Set();
  saveUnlocked();
  highScore = 0;
  saveHighScore();
  updateScoreDisplay();
  pairCounts = {};
  savePairCounts();
  renderAchievementsPanel();
}

// ============================================================
//  ペアトラッキング
// ============================================================

function getPairKey(a, b) {
  return `${Math.min(a, b)}${Math.max(a, b)}`;
}

function recordPair(a, b) {
  const key = getPairKey(a, b);
  pairCounts[key] = (pairCounts[key] || 0) + 1;
  savePairCounts();
  updateDailyPairProgress(key);
}

// ============================================================
//  パネル描画 — 図鑑
// ============================================================

function renderPairsPanel() {
  const counts   = PAIR_INFO.map(p => pairCounts[p.key] || 0);
  const maxCount = Math.max(...counts, 1);
  const total    = counts.reduce((s, v) => s + v, 0);

  const rows = PAIR_INFO.map((p, i) => {
    const count = counts[i];
    const pct   = Math.round(count / maxCount * 100);
    return `
      <div class="pair-row">
        <div class="pair-label">${p.label}</div>
        <div class="pair-bar-wrap">
          <div class="pair-bar" style="width:${pct}%;background:${p.color}"></div>
        </div>
        <div class="pair-count">${count}<small> 回</small></div>
      </div>`;
  }).join('');

  document.getElementById('pairs-content').innerHTML = `
    <div class="panel-header">
      <div class="panel-title">ずかん</div>
      <div class="panel-sub">合計 ${total} 回</div>
    </div>
    <div class="pair-list">${rows}</div>
    <div class="pair-total">消したペア合計 <strong>${total}</strong> 回</div>`;
}

// ============================================================
//  パネル描画 — 実績
// ============================================================

function renderAchievementsPanel() {
  const sorted = [
    ...ACHIEVEMENTS.filter(a =>  unlockedAchievements.has(a.id)),
    ...ACHIEVEMENTS.filter(a => !unlockedAchievements.has(a.id)),
  ];

  const items = sorted.map(ach => {
    const unlocked = unlockedAchievements.has(ach.id);
    return `
      <div class="ach-item ${unlocked ? 'ach-unlocked' : 'ach-locked'}">
        <div class="ach-star">${unlocked ? '★' : '☆'}</div>
        <div class="ach-info">
          <div class="ach-name">${ach.name}</div>
          <div class="ach-desc">${ach.desc}</div>
        </div>
      </div>`;
  }).join('');

  document.getElementById('achievements-content').innerHTML = `
    <div class="panel-header">
      <div class="panel-title">じっせき</div>
      <div class="panel-sub">${unlockedAchievements.size} / ${ACHIEVEMENTS.length} かいじょずみ</div>
      <button class="reset-panel-btn" id="reset-ach-btn">↺ リセット</button>
    </div>
    <div class="ach-list">${items}</div>`;
  document.getElementById('reset-ach-btn').addEventListener('click', resetAchievements);
}

// ============================================================
//  パネル描画 — デイリー
// ============================================================

function renderDailyPanel() {
  const today       = getTodayKey();
  const displayDate = today.replace(/-/g, '/');
  const progress    = dailyState.progress || 0;
  const target      = daily.target;
  const completed   = dailyState.completed;
  const pct         = Math.min(Math.round(progress / target * 100), 100);

  const progressText = daily.type === 'pair'
    ? `${Math.min(progress, target)} / ${target} 回`
    : completed ? '達成' : `最大コンボ ${progress} / ${target}`;

  const statusHtml = completed
    ? `<div class="daily-status daily-done">達成！ おめでとうございます</div>`
    : `<div class="daily-status daily-todo">ゲームで挑戦しよう</div>`;

  document.getElementById('daily-content').innerHTML = `
    <div class="panel-header">
      <div class="panel-title">デイリー</div>
      <div class="panel-sub">${displayDate}</div>
    </div>
    <div class="daily-card">
      <p class="daily-mission">${daily.desc}</p>
      <div class="daily-bar-wrap">
        <div class="daily-bar ${completed ? 'daily-bar-done' : ''}" style="width:${pct}%"></div>
      </div>
      <div class="daily-progress-label">${progressText}</div>
      ${statusHtml}
    </div>
    <div class="daily-note">毎日0時にミッションが更新されます</div>`;
}

// ============================================================
//  タブ UI
// ============================================================

function switchTab(tabName) {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(`panel-${tabName}`).classList.add('active');
  document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');

  if (tabName === 'pairs')        renderPairsPanel();
  if (tabName === 'achievements') renderAchievementsPanel();
  if (tabName === 'daily')        renderDailyPanel();
}

function updateTabBadges() {
  document.querySelector('[data-tab="daily"]')
    .classList.toggle('tab-done', dailyState.completed);
}

// ============================================================
//  エフェクト共通ヘルパー
// ============================================================

function spawnAbsEl(className, x, y) {
  const appEl = document.getElementById('app');
  const el    = document.createElement('div');
  el.className  = className;
  el.style.left = `${x}px`;
  el.style.top  = `${y}px`;
  appEl.appendChild(el);
  el.addEventListener('animationend', () => el.remove(), { once: true });
  return el;
}

// ============================================================
//  エフェクト
// ============================================================

function spawnParticles(r1, c1, r2, c2, valA, valB) {
  const ar = document.getElementById('app').getBoundingClientRect();

  [[r1, c1, valA], [r2, c2, valB]].forEach(([r, c, val]) => {
    const el = getCellEl(r, c);
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cx = rect.left - ar.left + rect.width  / 2;
    const cy = rect.top  - ar.top  + rect.height / 2;

    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2 + Math.random() * 0.4;
      const dist  = 16 + Math.random() * 22;
      const dot   = spawnAbsEl('particle', cx, cy);
      dot.style.background = isFever
        ? `hsl(${Math.floor(Math.random() * 360)}, 100%, 65%)`
        : (CELL_COLORS[val] || '#fff');
      dot.style.setProperty('--dx', `${Math.cos(angle) * dist}px`);
      dot.style.setProperty('--dy', `${Math.sin(angle) * dist}px`);
    }
  });
}

function showEquation(a, b, r1, c1, r2, c2) {
  const el1 = getCellEl(r1, c1);
  const el2 = getCellEl(r2, c2);
  if (!el1 || !el2) return;

  const ar  = document.getElementById('app').getBoundingClientRect();
  const r1r = el1.getBoundingClientRect();
  const r2r = el2.getBoundingClientRect();
  const cx  = ((r1r.left + r1r.right + r2r.left + r2r.right) / 4) - ar.left;
  const cy  = ((r1r.top  + r1r.bottom + r2r.top  + r2r.bottom) / 4) - ar.top;

  const popup = spawnAbsEl('equation-popup', cx, cy);
  popup.textContent = `${a} + ${b} = 10`;
}

function showScorePopup(r1, c1, points, comboVal) {
  const cellEl = getCellEl(r1, c1);
  if (!cellEl) return;

  const cr   = cellEl.getBoundingClientRect();
  const ar   = document.getElementById('app').getBoundingClientRect();
  const x    = cr.left - ar.left + cr.width  / 2;
  const y    = cr.top  - ar.top  + cr.height / 2;
  const mult = getComboMult(comboVal);
  const popup = spawnAbsEl('score-popup', x, y);

  if (isFever) {
    popup.textContent = `+${points}`;
    popup.classList.add('popup-fever');
  } else if (mult > 1) {
    popup.textContent = `+${points} ×${mult}`;
    if      (mult >= 5) popup.classList.add('combo-hot');
    else if (mult >= 3) popup.classList.add('combo-warm');
    else                popup.classList.add('combo-cool');
  } else {
    popup.textContent = `+${points}`;
  }
}

function showToast(text, type = 'default') {
  const toast = document.createElement('div');
  toast.className   = `toast toast-${type}`;
  toast.textContent = text;
  document.body.appendChild(toast);
  toast.addEventListener('animationend', () => toast.remove(), { once: true });
}

// ============================================================
//  キャラクター
// ============================================================

let charResetTimer = null;

/**
 * キャラクターの状態を設定する
 * state: 'normal' | 'happy' | 'sad' | 'combo' | 'fever' | 'gameover'
 */
function setCharState(state, speechL = '', speechR = '') {
  const charL = document.getElementById('char-left');
  const charR = document.getElementById('char-right');
  if (!charL || !charR) return;

  const stateClasses = ['char-happy', 'char-sad', 'char-combo', 'char-fever', 'char-gameover'];
  [charL, charR].forEach(el => {
    stateClasses.forEach(s => el.classList.remove(s));
    if (state !== 'normal') el.classList.add(`char-${state}`);
  });

  showCharSpeech(document.getElementById('speech-left'),  speechL);
  showCharSpeech(document.getElementById('speech-right'), speechR);

  clearTimeout(charResetTimer);
  if (state !== 'normal' && state !== 'fever' && state !== 'gameover') {
    charResetTimer = setTimeout(() => setCharState('normal'), 1800);
  }
}

function showCharSpeech(el, text) {
  if (!el) return;
  el.classList.remove('visible');
  el.textContent = text || '';
  if (!text) return;
  void el.offsetWidth;
  el.classList.add('visible');
  el.addEventListener('animationend', () => el.classList.remove('visible'), { once: true });
}

// ============================================================
//  チュートリアル
// ============================================================

function initTutorial() {
  if (localStorage.getItem('tutorialSeen')) return;
  const overlay = document.getElementById('tutorial');
  overlay.classList.remove('hidden');
  document.getElementById('tutorial-btn').addEventListener('click', () => {
    overlay.classList.add('hidden');
    localStorage.setItem('tutorialSeen', '1');
    tryResumeBgm(); // チュートリアル閉じた時点でBGM開始
  }, { once: true });
}

// ============================================================
//  ユーティリティ
// ============================================================

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================
//  起動
// ============================================================

document.getElementById('tab-bar').addEventListener('click', e => {
  const btn = e.target.closest('.tab-btn');
  if (btn) switchTab(btn.dataset.tab);
});

document.getElementById('restart-btn').addEventListener('click', () => {
  getAudioCtx();
  init();
});

document.getElementById('retry-btn').addEventListener('click', () => {
  getAudioCtx();
  init();
});

document.getElementById('reset-hs-btn').addEventListener('click', resetHighScore);

// ── SE ON/OFF トグル ─────────────────────────────────────────
const soundBtnEl = document.getElementById('sound-btn');

function updateSoundBtn() {
  soundBtnEl.textContent = soundOn ? '🔊' : '🔇';
  soundBtnEl.classList.toggle('sound-locked', soundOn && !audioCtx);
}

soundBtnEl.addEventListener('click', () => {
  soundOn = !soundOn;
  saveSoundOn();
  if (soundOn) getAudioCtx();
  updateSoundBtn();
  tryResumeBgm(); // SE ONにした時に AudioContext が作られるのでBGMも再開
});

// ── BGM ON/OFF トグル ────────────────────────────────────────
const bgmBtnEl = document.getElementById('bgm-btn');

function updateBgmBtn() {
  bgmBtnEl.classList.toggle('bgm-off', !bgmOn);
  bgmBtnEl.title = bgmOn ? 'BGM ON（クリックでOFF）' : 'BGM OFF（クリックでON）';
}

bgmBtnEl.addEventListener('click', () => {
  bgmOn = !bgmOn;
  saveBgmOn();
  getAudioCtx(); // AudioContext を起動（iOS対応）
  if (bgmOn) {
    tryResumeBgm(); // BGMを再開
  } else {
    stopBgmNodes(); // BGMを停止（tickも止める）
  }
  updateBgmBtn();
});

// ── データ読み込みと起動 ─────────────────────────────────────
loadDailyState();
updateTabBadges();
updateSoundBtn();
updateBgmBtn();
init();
initTutorial();
