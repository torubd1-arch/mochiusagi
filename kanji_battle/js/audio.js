// js/audio.js - Web Audio API による効果音

const Audio = (() => {
  let ctx = null;

  function getCtx() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
    // モバイル等でサスペンドされていたら再開
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function playTone(freq, startTime, duration, type = 'square', vol = 0.25) {
    const ac = getCtx();
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.connect(gain);
    gain.connect(ac.destination);
    osc.type = type;
    osc.frequency.setValueAtTime(freq, startTime);
    gain.gain.setValueAtTime(vol, startTime);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
    osc.start(startTime);
    osc.stop(startTime + duration + 0.01);
  }

  return {
    // 正解音 (ピコン↑↑)
    playCorrect() {
      try {
        const ac = getCtx();
        const now = ac.currentTime;
        playTone(523, now,        0.08, 'square', 0.2);
        playTone(659, now + 0.09, 0.08, 'square', 0.2);
        playTone(784, now + 0.18, 0.12, 'square', 0.22);
      } catch(e) {}
    },

    // 不正解音 (ブー、やさしめ)
    playWrong() {
      try {
        const ac = getCtx();
        const now = ac.currentTime;
        playTone(330, now,        0.1, 'sine', 0.15);
        playTone(262, now + 0.12, 0.2, 'sine', 0.12);
      } catch(e) {}
    },

    // 攻撃音
    playAttack() {
      try {
        const ac = getCtx();
        const now = ac.currentTime;
        playTone(440, now,       0.05, 'square', 0.25);
        playTone(220, now + 0.06, 0.1, 'square', 0.15);
      } catch(e) {}
    },

    // 敵ダメージ音
    playHit() {
      try {
        const ac = getCtx();
        const now = ac.currentTime;
        playTone(200, now,       0.06, 'sawtooth', 0.2);
        playTone(150, now + 0.07, 0.1, 'sawtooth', 0.1);
      } catch(e) {}
    },

    // 勝利音
    playVictory() {
      try {
        const ac = getCtx();
        const now = ac.currentTime;
        const melody = [523, 659, 784, 1047, 784, 1047];
        const timings = [0, 0.12, 0.24, 0.36, 0.5, 0.62];
        melody.forEach((freq, i) => {
          playTone(freq, now + timings[i], 0.18, 'square', 0.2);
        });
      } catch(e) {}
    },

    // ゲームオーバー音 (使う場合)
    playGameOver() {
      try {
        const ac = getCtx();
        const now = ac.currentTime;
        playTone(392, now,       0.2, 'square', 0.2);
        playTone(349, now + 0.22, 0.2, 'square', 0.2);
        playTone(294, now + 0.44, 0.4, 'square', 0.2);
      } catch(e) {}
    },

    // 決定音
    playSelect() {
      try {
        const ac = getCtx();
        const now = ac.currentTime;
        playTone(440, now, 0.06, 'square', 0.15);
      } catch(e) {}
    }
  };
})();
