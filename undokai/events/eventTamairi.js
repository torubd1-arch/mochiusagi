// 競技2: 玉入れ（新規）
window.EventTamairi = (function () {
  const MAX_ROUNDS = 10;
  const MAX_ADOPT = 5;
  const DICE_COUNT = 5;
  const POINTS_PER_HIT = 3;

  // 得点対象: 1か2の目
  function countHits(dice) {
    return dice.filter(v => v === 1 || v === 2).length;
  }

  return {
    id: 'tamairi',
    name: '玉入れ',

    getDescription() {
      return [
        '🏀 かごに向かって玉を投げよう！ダイス5個を振るよ',
        `最大${MAX_ROUNDS}回試行できて、そのうち${MAX_ADOPT}回分を採用できるよ`,
        '1か2の目が出たら玉がかごに入ったよ！1個につき3点！',
        '「採用」か「スキップ」を選んで、よい結果を5回選ぼう！',
      ];
    },

    init() {
      return {
        phase: 'pre_roll', // 'pre_roll' | 'choosing' | 'done'
        round: 1,
        adoptedCount: 0,
        currentDice: null,
        results: [], // { dice: [], hits: number, score: number, adopted: boolean }
        log: [],
      };
    },

    getDiceDisplay(s) {
      if (!s.currentDice) {
        return Array(DICE_COUNT).fill(null).map(() => ({ value: null, kept: false, clickable: false }));
      }
      return s.currentDice.map(v => {
        const isHit = v === 1 || v === 2;
        return {
          value: v,
          kept: isHit,
          clickable: false,
          dim: !isHit,
        };
      });
    },

    getStatusText(s) {
      if (s.phase === 'done') {
        const total = s.results.filter(r => r.adopted).reduce((a, r) => a + r.score, 0);
        return `完了 ／ 採用 ${s.adoptedCount}/${MAX_ADOPT} ／ 合計: ${total}点`;
      }
      const adoptLeft = MAX_ADOPT - s.adoptedCount;
      const roundsLeft = MAX_ROUNDS - s.round + 1;
      return `第${s.round}回／${MAX_ROUNDS} ／ 採用済み: ${s.adoptedCount}/${MAX_ADOPT} ／ 採用残: ${adoptLeft}回 ／ 試行残: ${roundsLeft}回`;
    },

    getAvailableActions(s) {
      if (s.phase === 'done') return [];

      if (s.phase === 'pre_roll') {
        return [{ id: 'ROLL', label: `🎲 振る（第${s.round}回）`, enabled: true }];
      }

      if (s.phase === 'choosing') {
        const hits = s.currentDice ? countHits(s.currentDice) : 0;
        const score = hits * POINTS_PER_HIT;
        const adoptLeft = MAX_ADOPT - s.adoptedCount;
        // 今回を含めた残り試行数
        const roundsLeft = MAX_ROUNDS - s.round + 1;
        const mustAdopt = adoptLeft >= roundsLeft;
        const canAdopt = s.adoptedCount < MAX_ADOPT;
        return [
          { id: 'ADOPT', label: `✅ 採用（${hits}個×${POINTS_PER_HIT}=${score}点）`, enabled: canAdopt },
          { id: 'SKIP',  label: '⏭️ スキップ', enabled: !mustAdopt },
        ];
      }

      return [];
    },

    applyAction(s, action) {
      s = JSON.parse(JSON.stringify(s));
      const type = typeof action === 'string' ? action : action.type;

      if (type === 'ROLL') {
        s.currentDice = rollDice(DICE_COUNT);
        const hits = countHits(s.currentDice);
        const score = hits * POINTS_PER_HIT;
        s.log.push(`第${s.round}回: [${s.currentDice.join(', ')}] → 1か2が${hits}こ！この回は${score}点！`);
        s.phase = 'choosing';
        return s;
      }

      if (type === 'ADOPT') {
        const hits = countHits(s.currentDice);
        const score = hits * POINTS_PER_HIT;
        s.results.push({ dice: [...s.currentDice], hits, score, adopted: true });
        s.adoptedCount++;
        s.log.push(`第${s.round}回: この回を採用した！ ${hits}個×${POINTS_PER_HIT}=${score}点（累計採用 ${s.adoptedCount}/${MAX_ADOPT}）`);
        s.round++;
        s.currentDice = null;
        if (s.adoptedCount >= MAX_ADOPT || s.round > MAX_ROUNDS) {
          s.phase = 'done';
        } else {
          s.phase = 'pre_roll';
        }
        return s;
      }

      if (type === 'SKIP') {
        const hits = countHits(s.currentDice);
        const score = hits * POINTS_PER_HIT;
        s.results.push({ dice: [...s.currentDice], hits, score, adopted: false });
        s.log.push(`第${s.round}回: 今回は見送る！（${score}点をスキップ）`);
        s.round++;
        s.currentDice = null;
        if (s.round > MAX_ROUNDS) {
          s.phase = 'done';
        } else {
          s.phase = 'pre_roll';
        }
        return s;
      }

      return s;
    },

    isFinished(s) { return s.phase === 'done'; },

    getResult(s) {
      const adopted = s.results.filter(r => r.adopted);
      if (adopted.length === 0) return { points: 0, details: '採用なし（0点）' };
      const pts = adopted.reduce((a, r) => a + r.score, 0);
      const detail = adopted.map((r, i) =>
        `採用${i + 1}: [${r.dice.join(',')}]→${r.hits}個×${POINTS_PER_HIT}=${r.score}点`
      ).join(' ／ ');
      return { points: pts, details: `${detail} → 合計: ${pts}点` };
    },
  };
})();
