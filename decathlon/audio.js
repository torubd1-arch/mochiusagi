// ===== Audio System (WebAudio API chiptune) =====
const AudioSystem = (function () {
  let ctx = null;
  let masterGain = null;
  let muted = false;
  let volume = 0.4;
  let bgmTimeout = null;
  let bgmIndex = 0;
  let started = false;

  function ensureCtx() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      masterGain = ctx.createGain();
      masterGain.gain.value = volume;
      masterGain.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
  }

  function playNote(freq, duration, type = 'square', vol = 0.25) {
    if (muted || !started) return;
    try {
      ensureCtx();
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.connect(g);
      g.connect(masterGain);
      osc.type = type;
      osc.frequency.value = freq;
      g.gain.setValueAtTime(vol, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + duration);
    } catch (e) { /* ignore */ }
  }

  // ===== SFX =====
  const SFX = {
    roll() {
      playNote(180, 0.04, 'square', 0.2);
      setTimeout(() => playNote(240, 0.04, 'square', 0.2), 40);
      setTimeout(() => playNote(320, 0.06, 'square', 0.2), 80);
    },
    keep() {
      playNote(523, 0.08, 'square', 0.2);
      setTimeout(() => playNote(659, 0.12, 'square', 0.2), 70);
    },
    confirm() {
      [523, 659, 784].forEach((f, i) => setTimeout(() => playNote(f, 0.1, 'square', 0.25), i * 80));
    },
    success() {
      [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => playNote(f, 0.15, 'square', 0.35), i * 90));
    },
    fail() {
      playNote(220, 0.12, 'sawtooth', 0.3);
      setTimeout(() => playNote(165, 0.2, 'sawtooth', 0.25), 120);
    },
  };

  // ===== BGM: simple 8-bit melody =====
  // Format: [frequency, durationInSeconds]
  const BGM = [
    [523, 0.18], [659, 0.18], [784, 0.18], [659, 0.18],
    [523, 0.18], [523, 0.18], [523, 0.36],
    [698, 0.18], [784, 0.18], [880, 0.18], [784, 0.18],
    [698, 0.18], [698, 0.18], [698, 0.36],
    [784, 0.18], [880, 0.18], [1047, 0.36],
    [880, 0.18], [784, 0.36], [659, 0.36],
    [523, 0.18], [659, 0.18], [784, 0.18], [659, 0.18],
    [523, 0.36], [523, 0.18], [659, 0.18], [523, 0.54],
    [0, 0.18], // rest
    [440, 0.18], [523, 0.18], [587, 0.18], [659, 0.18],
    [698, 0.18], [784, 0.36], [698, 0.18], [659, 0.18],
    [587, 0.18], [523, 0.36], [440, 0.18], [392, 0.18],
    [349, 0.54], [0, 0.18],
  ];

  function scheduleBgmNote() {
    if (muted || !started) return;
    const [freq, dur] = BGM[bgmIndex % BGM.length];
    if (freq > 0) playNote(freq, dur * 0.85, 'square', 0.12);
    bgmTimeout = setTimeout(() => {
      bgmIndex++;
      scheduleBgmNote();
    }, dur * 1000);
  }

  function startBgm() {
    if (bgmTimeout !== null) return;
    scheduleBgmNote();
  }

  function stopBgm() {
    if (bgmTimeout !== null) {
      clearTimeout(bgmTimeout);
      bgmTimeout = null;
    }
  }

  function handleFirstInteraction() {
    if (started) return;
    started = true;
    ensureCtx();
    startBgm();
    document.removeEventListener('click', handleFirstInteraction);
    document.removeEventListener('keydown', handleFirstInteraction);
  }

  return {
    init() {
      document.addEventListener('click', handleFirstInteraction);
      document.addEventListener('keydown', handleFirstInteraction);
    },

    play(name) {
      if (muted || !started) return;
      if (SFX[name]) SFX[name]();
    },

    setMuted(val) {
      muted = val;
      if (muted) {
        stopBgm();
      } else if (started) {
        startBgm();
      }
      // Update UI
      const btn = document.getElementById('btn-mute');
      if (btn) btn.textContent = muted ? '🔇' : '🔊';
    },

    setVolume(val) {
      volume = parseFloat(val);
      if (masterGain) masterGain.gain.value = volume;
    },

    isMuted() { return muted; },
  };
})();
