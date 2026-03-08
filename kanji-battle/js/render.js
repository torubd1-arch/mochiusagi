// js/render.js - SVG描画・アニメーション管理

const Renderer = (() => {
  // ストローク状態
  const STATE = { DONE: 'done', CURRENT: 'current', FUTURE: 'future' };
  const COLOR = {
    done:    '#1a1a2e',   // 書き終えた画: 濃い色
    current: '#e74c3c',   // 今の画: 赤
    future:  '#d0d0d8',   // まだの画: 薄グレー
    bg:      '#e8e8f0',   // 全体のガイド
  };

  let svgEl = null;
  let pathEls = [];
  let currentKanji = null;

  // --- 内部ユーティリティ ---
  function makePath(d, color, strokeWidth = 8) {
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', d);
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke', color);
    p.setAttribute('stroke-width', strokeWidth);
    p.setAttribute('stroke-linecap', 'round');
    p.setAttribute('stroke-linejoin', 'round');
    return p;
  }

  function animatePath(el, durationMs = 600) {
    return new Promise(resolve => {
      const len = el.getTotalLength ? el.getTotalLength() : 200;
      el.style.transition = 'none';
      el.style.strokeDasharray = len;
      el.style.strokeDashoffset = len;
      // reflow
      el.getBoundingClientRect();
      el.style.transition = `stroke-dashoffset ${durationMs}ms ease`;
      el.style.strokeDashoffset = '0';
      setTimeout(() => {
        el.style.strokeDasharray = '';
        el.style.strokeDashoffset = '';
        resolve();
      }, durationMs + 50);
    });
  }

  return {
    // SVG要素を設定
    setSVG(el) {
      svgEl = el;
    },

    // 漢字をSVGに描画 (completedCount 番目まで完了状態で表示)
    render(kanji, completedCount = 0, highlightIndex = -1) {
      if (!svgEl) return;
      currentKanji = kanji;
      svgEl.innerHTML = '';
      pathEls = [];

      kanji.strokes.forEach((stroke, i) => {
        let color;
        if (i < completedCount)       color = COLOR.done;
        else if (i === highlightIndex) color = COLOR.current;
        else                           color = COLOR.future;

        const p = makePath(stroke.path, color);
        svgEl.appendChild(p);
        pathEls.push(p);
      });
    },

    // 1画だけアニメーション (書き順デモ用)
    async animateStroke(index, color = COLOR.current) {
      if (!pathEls[index]) return;
      const el = pathEls[index];
      el.setAttribute('stroke', color);
      await animatePath(el, 600);
      el.setAttribute('stroke', COLOR.done);
    },

    // 全画をアニメーション再生 (れんしゅうモード)
    async playAll(kanji, onStep) {
      if (!svgEl) return;
      currentKanji = kanji;
      svgEl.innerHTML = '';
      pathEls = [];

      // まず全て薄グレーで描画
      kanji.strokes.forEach(stroke => {
        const p = makePath(stroke.path, COLOR.future);
        svgEl.appendChild(p);
        pathEls.push(p);
      });

      for (let i = 0; i < kanji.strokes.length; i++) {
        pathEls[i].setAttribute('stroke', COLOR.current);
        await animatePath(pathEls[i], 650);
        pathEls[i].setAttribute('stroke', COLOR.done);
        if (onStep) onStep(i);
        await new Promise(r => setTimeout(r, 200));
      }
    },

    // 指定画を強調表示 (不正解時のヒント)
    highlightStroke(index) {
      if (!pathEls[index]) return;
      // ピカピカ点滅
      let count = 0;
      const iv = setInterval(() => {
        const el = pathEls[index];
        el.setAttribute('stroke', count % 2 === 0 ? '#ff4444' : COLOR.future);
        count++;
        if (count >= 6) {
          clearInterval(iv);
          el.setAttribute('stroke', COLOR.current);
        }
      }, 200);
    },

    // 特定画をアニメーション付きで見せる (不正解後のお手本)
    async showCorrectStroke(kanji, index, prevCompleted) {
      this.render(kanji, prevCompleted, -1);
      await new Promise(r => setTimeout(r, 300));
      if (!pathEls[index]) return;
      pathEls[index].setAttribute('stroke', COLOR.current);
      await animatePath(pathEls[index], 700);
      pathEls[index].setAttribute('stroke', '#e74c3c');
    },

    // 現在のpathEls参照を返す
    getPathEls() {
      return pathEls;
    }
  };
})();

// ----- モンスターSVG生成 -----
function buildMonsterSVG(variant, color, hpRatio = 1) {
  const c = color || '#e74c3c';
  const sad = hpRatio < 0.5;
  const mouthPath = sad
    ? `M 78,140 Q 100,130 122,140`
    : `M 78,140 Q 100,152 122,140`;

  const variants = [
    // 0: スライム
    `<ellipse cx="100" cy="125" rx="72" ry="62" fill="${c}"/>
     <ellipse cx="100" cy="185" rx="30" ry="12" fill="${c}" opacity="0.3"/>
     <path d="M 60,135 Q 50,160 52,178 Q 58,160 66,178 Q 72,160 76,178" fill="${c}"/>
     <path d="M 140,135 Q 138,160 136,178 Q 144,160 148,178 Q 152,160 154,178" fill="${c}"/>
     <circle cx="78"  cy="108" r="18" fill="white"/>
     <circle cx="122" cy="108" r="18" fill="white"/>
     <circle cx="83"  cy="112" r="9"  fill="#222"/>
     <circle cx="127" cy="112" r="9"  fill="#222"/>
     <circle cx="87"  cy="108" r="4"  fill="white"/>
     <circle cx="131" cy="108" r="4"  fill="white"/>
     <path d="${mouthPath}" stroke="#333" stroke-width="4" fill="none" stroke-linecap="round"/>`,

    // 1: バット
    `<path d="M 100,125 L 28,70 Q 14,50 36,62 Q 48,68 60,86 L 100,125" fill="${c}"/>
     <path d="M 100,125 L 172,70 Q 186,50 164,62 Q 152,68 140,86 L 100,125" fill="${c}"/>
     <ellipse cx="100" cy="135" rx="55" ry="50" fill="${c}"/>
     <polygon points="82,88 76,104 90,104" fill="${c}"/>
     <polygon points="118,88 112,104 126,104" fill="${c}"/>
     <circle cx="82"  cy="120" r="14" fill="white"/>
     <circle cx="118" cy="120" r="14" fill="white"/>
     <circle cx="85"  cy="124" r="7"  fill="#222"/>
     <circle cx="121" cy="124" r="7"  fill="#222"/>
     <polygon points="90,160 95,175 100,160" fill="white"/>
     <polygon points="100,160 105,175 110,160" fill="white"/>
     <path d="${mouthPath}" stroke="#333" stroke-width="3" fill="none" stroke-linecap="round"/>`,

    // 2: ゴーレム
    `<rect x="35" y="55" width="130" height="125" rx="12" fill="${c}"/>
     <rect x="8"  y="70" width="32"  height="28" rx="6" fill="${c}"/>
     <rect x="160" y="70" width="32" height="28" rx="6" fill="${c}"/>
     <rect x="55" y="80" width="34"  height="28" rx="4" fill="white"/>
     <rect x="111" y="80" width="34" height="28" rx="4" fill="white"/>
     <rect x="63" y="86" width="18"  height="16" rx="2" fill="#222"/>
     <rect x="119" y="86" width="18" height="16" rx="2" fill="#222"/>
     <rect x="60" y="128" width="80" height="22" rx="4" fill="#333"/>
     <rect x="68" y="131" width="14" height="18" fill="white"/>
     <rect x="86" y="131" width="14" height="18" fill="white"/>
     <rect x="104" y="131" width="14" height="18" fill="white"/>
     <rect x="122" y="131" width="14" height="18" fill="white"/>`,

    // 3: ゴースト
    `<path d="M 46,96 Q 46,42 100,38 Q 154,42 154,96 L 154,178 Q 142,164 130,178 Q 118,164 100,178 Q 82,164 70,178 Q 58,164 46,178 Z" fill="${c}" opacity="0.88"/>
     <ellipse cx="78"  cy="108" r="18" fill="white"/>
     <ellipse cx="122" cy="108" r="18" fill="white"/>
     <ellipse cx="78"  cy="112" r="9"  fill="#222"/>
     <ellipse cx="122" cy="112" r="9"  fill="#222"/>
     <path d="${mouthPath}" stroke="#333" stroke-width="3" fill="none" stroke-linecap="round"/>`,

    // 4: ドラゴン
    `<polygon points="76,52 68,22 86,48" fill="#c0392b"/>
     <polygon points="124,52 132,22 114,48" fill="#c0392b"/>
     <path d="M 38,106 L 8,58 Q 4,42 20,54 L 34,82" fill="#c0392b" opacity="0.75"/>
     <path d="M 162,106 L 192,58 Q 196,42 180,54 L 166,82" fill="#c0392b" opacity="0.75"/>
     <ellipse cx="100" cy="128" rx="68" ry="62" fill="${c}"/>
     <circle cx="76"  cy="110" r="18" fill="#ffe066"/>
     <circle cx="124" cy="110" r="18" fill="#ffe066"/>
     <ellipse cx="76"  cy="114" rx="6" ry="12" fill="#222"/>
     <ellipse cx="124" cy="114" rx="6" ry="12" fill="#222"/>
     <ellipse cx="88"  cy="136" rx="6" ry="4" fill="#c0392b"/>
     <ellipse cx="112" cy="136" rx="6" ry="4" fill="#c0392b"/>
     <path d="${mouthPath}" stroke="#333" stroke-width="3" fill="none" stroke-linecap="round"/>`
  ];

  const body = variants[variant % variants.length];
  return `<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
}

// 星パーティクルを飛ばす演出
function spawnStars(count = 6) {
  const container = document.getElementById('particle-layer');
  if (!container) return;
  for (let i = 0; i < count; i++) {
    const el = document.createElement('div');
    el.className = 'star-particle';
    el.textContent = ['★','✦','✧','✩'][Math.floor(Math.random()*4)];
    const bx = container.getBoundingClientRect();
    el.style.left = (30 + Math.random() * 140) + '%';
    el.style.top  = (20 + Math.random() * 60)  + '%';
    el.style.setProperty('--dx', (Math.random() - 0.5) * 120 + 'px');
    el.style.setProperty('--dy', -(40 + Math.random() * 80) + 'px');
    el.style.animationDelay = (i * 80) + 'ms';
    container.appendChild(el);
    setTimeout(() => el.remove(), 1200 + i * 80);
  }
}
