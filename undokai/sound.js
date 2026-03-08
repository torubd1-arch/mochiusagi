// ===== Sound System: 8bit / ファミコン風 =====
const Sound = (function () {
  let ctx = null;
  let muted = false;
  let unlocked = false;

  // BGM管理
  let currentBgmName = null;  // 現在選択されているBGM名
  let bgmEnabled = false;     // ゲームがBGMを望んでいるか
  let bgmActive = false;      // 実際にスケジューリング中か
  let bgmTimer = null;

  // ---- AudioContext ----
  function getCtx() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  // ---- Low-level note player ----
  function playNote(freq, type, dur, vol, t, c) {
    if (freq <= 0 || vol <= 0) return;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.connect(gain);
    gain.connect(c.destination);
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(dur * 0.85, 0.01));
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  function playSeq(melody, type, vol, c) {
    const t0 = c.currentTime + 0.02;
    let t = t0;
    melody.forEach(([freq, dur]) => {
      playNote(freq, type, dur, vol, t, c);
      t += dur;
    });
    return t - t0;
  }

  // ---- Sound Effects ----
  const SE = {
    roll() {
      const c = getCtx(); const t = c.currentTime;
      [[440,0.04],[370,0.04],[311,0.04],[262,0.05]].forEach(([f,d],i) =>
        playNote(f, 'square', d, 0.17, t + i * 0.033, c));
    },
    reroll() {
      const c = getCtx(); const t = c.currentTime;
      [[330,0.05],[294,0.05],[262,0.06]].forEach(([f,d],i) =>
        playNote(f, 'triangle', d, 0.14, t + i * 0.04, c));
    },
    decide() {
      const c = getCtx(); const t = c.currentTime;
      playNote(523, 'square', 0.08, 0.16, t, c);
      playNote(659, 'square', 0.10, 0.16, t + 0.09, c);
    },
    adopt() {
      const c = getCtx(); const t = c.currentTime;
      [[523,0.07],[659,0.07],[784,0.13]].forEach(([f,d],i) =>
        playNote(f, 'square', d, 0.19, t + i * 0.07, c));
    },
    fanfare() {
      const c = getCtx(); const t = c.currentTime;
      [[523,0.10],[659,0.10],[784,0.10],[1047,0.28]].forEach(([f,d],i) =>
        playNote(f, 'square', d, 0.21, t + i * 0.12, c));
    },
    gameover() {
      const c = getCtx();
      playSeq([
        [523,0.12],[659,0.12],[784,0.12],[659,0.12],
        [784,0.12],[1047,0.12],[880,0.12],[1047,0.40],
      ], 'square', 0.21, c);
    },
    minus6() {
      const c = getCtx(); const t = c.currentTime;
      [[392,0.08],[330,0.08],[262,0.08],[196,0.16]].forEach(([f,d],i) =>
        playNote(f, 'square', d, 0.18, t + i * 0.07, c));
    },
    jingle() {
      const c = getCtx();
      playSeq([
        [784,0.12],[784,0.08],[784,0.12],
        [659,0.12],[784,0.12],[1047,0.25],[0,0.12],
        [523,0.10],[659,0.10],[784,0.10],[1047,0.10],[880,0.32],
      ], 'square', 0.21, c);
    },
  };

  // ---- BGM定義 ----

  // プレイ中BGM: 運動会マーチ (~8.6秒/ループ)
  const BGM_PLAY = {
    vol: 0.055,
    melody: [
      [523,0.20],[659,0.20],[784,0.20],[659,0.20],
      [523,0.20],[784,0.40],[0,0.20],
      [698,0.20],[784,0.20],[880,0.20],[784,0.20],
      [698,0.40],[0,0.40],
      [523,0.20],[659,0.20],[784,0.20],[880,0.20],
      [1047,0.40],[880,0.20],[784,0.20],
      [659,0.40],[523,0.40],[0,0.40],
      [880,0.20],[784,0.20],[659,0.20],[523,0.20],
      [659,0.40],[784,0.40],
      [523,0.40],[0,0.60],
    ],
  };

  // 結果発表BGM: 表彰式風エンディング (~7.2秒/ループ)
  const BGM_ENDING = {
    vol: 0.08,
    melody: [
      // フレーズA: ファンファーレ調の入り
      [523,0.15],[523,0.15],[523,0.15],          // C C C
      [523,0.45],[0,0.15],                        // C (hold)
      [523,0.15],[659,0.15],[784,0.15],           // C E G
      [1047,0.45],[0,0.30],                       // C6 (hold)
      // フレーズB: テーマメロディ
      [880,0.20],[784,0.20],[659,0.20],           // A G E
      [784,0.40],[0,0.15],                        // G (hold)
      [659,0.20],[784,0.20],[880,0.20],           // E G A
      [1047,0.50],[0,0.20],                       // C6 (hold)
      // フレーズC: サビ・クライマックス
      [1047,0.20],[880,0.20],[784,0.20],          // C A G
      [659,0.20],[784,0.20],[880,0.20],           // E G A
      [1047,0.70],[0,0.50],                       // C6 (long)
    ],
  };

  const BGMS = { play: BGM_PLAY, ending: BGM_ENDING };

  // ---- BGM内部制御 ----
  function stopBgmInternal() {
    bgmActive = false;
    if (bgmTimer) { clearTimeout(bgmTimer); bgmTimer = null; }
  }

  function playBgmLoop() {
    if (!bgmActive || !bgmEnabled || muted) return;
    const bgm = BGMS[currentBgmName];
    if (!bgm) return;
    const c = getCtx();
    const t0 = c.currentTime + 0.05;
    let t = t0;
    const totalDurMs = bgm.melody.reduce((a, [, d]) => a + d, 0) * 1000;
    bgm.melody.forEach(([freq, dur]) => {
      playNote(freq, 'square', dur * 0.82, bgm.vol, t, c);
      t += dur;
    });
    bgmTimer = setTimeout(playBgmLoop, totalDurMs - 120);
  }

  // ---- Public API ----
  return {
    unlock() {
      try {
        getCtx();
        unlocked = true;
      } catch (e) {}
    },

    playSe(name) {
      if (muted || !unlocked) return;
      try { SE[name]?.(); } catch (e) {}
    },

    /**
     * BGM開始。name = 'play'（プレイ中）| 'ending'（結果発表）
     * 現在流れているBGMがあれば自動的に切り替える。
     */
    startBgm(name = 'play') {
      if (!unlocked) return;
      stopBgmInternal();          // 現在のBGMを停止
      currentBgmName = name;
      bgmEnabled = true;
      if (!muted) {
        bgmActive = true;
        playBgmLoop();
      }
    },

    stopBgm() {
      bgmEnabled = false;
      currentBgmName = null;
      stopBgmInternal();
    },

    toggleMute() {
      muted = !muted;
      if (muted) {
        stopBgmInternal();
      } else if (bgmEnabled && unlocked && currentBgmName) {
        bgmActive = true;
        playBgmLoop();
      }
      return muted;
    },

    isMuted() { return muted; },
  };
})();
