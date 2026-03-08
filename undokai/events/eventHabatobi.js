// 競技5: 走り幅跳び（Decathlonの走り幅跳びを流用）
window.EventHabatobi = (function () {

  function newAttemptState() {
    return {
      phase: 'approach', // 'approach' | 'jump' | 'foul'
      appDice: null,
      appKept: [],
      appRollsLeft: 5,
      appKeptSinceRoll: false,
      appRerolled: false,   // 一度でもREROLLしたか
      jmpNumDice: 0,
      jmpConfirmed: [],
      jmpCurrentRoll: null,
      jmpCurrentKept: [],
      foul: false,
    };
  }

  return {
    id: 'habatobi',
    name: '走り幅跳び',

    getDescription() {
      return [
        '🦘 3回挑戦して、一番いい記録が得点！',
        '【助走】5個のダイスを振って、合計9以下になるようにキープ（10以上はファウル！）',
        '【ジャンプ】キープした個数のダイスを振って、合計が得点になるよ',
        '⚠️ 助走で最低1個キープしないとジャンプできないよ！',
      ];
    },

    init() {
      return {
        attempt: 1,
        attempts: [],
        ...newAttemptState(),
        betweenAttempt: false,
        log: [],
      };
    },

    getDiceDisplay(s) {
      if (s.betweenAttempt) return [];

      if (s.phase === 'approach' || s.phase === 'foul') {
        if (!s.appDice) return Array(5).fill(null).map(() => ({ value: null, kept: false, clickable: false }));
        return s.appDice.map((v, i) => ({
          value: v,
          kept: s.appKept.includes(i),
          clickable: s.phase === 'approach',
          foulDie: s.foul,
        }));
      }

      if (s.phase === 'jump') {
        if (!s.jmpCurrentRoll) return Array(s.jmpNumDice).fill(null).map(() => ({ value: null, kept: false, clickable: false }));
        return s.jmpCurrentRoll.map((v, i) => ({
          value: v,
          kept: s.jmpCurrentKept.includes(i),
          clickable: true,
        }));
      }
      return [];
    },

    getStatusText(s) {
      if (s.betweenAttempt) {
        const last = s.attempts[s.attempts.length - 1];
        return `試技${s.attempt - 1}回目: ${last.foul ? 'ファウル（0点）' : last.score + '点'}`;
      }
      if (s.phase === 'approach') {
        const sum = s.appKept.reduce((a, i) => a + (s.appDice ? s.appDice[i] : 0), 0);
        let hint = '';
        if (s.appDice) {
          if (s.appRerolled && !s.appKeptSinceRoll) {
            hint = '　⚠️ リロール後のダイスから1つえらんでね！';
          } else if (s.appKept.length === 0) {
            hint = '　👆 まず1個クリックしてキープしよう！';
          } else {
            hint = `　キープ合計: ${sum}`;
          }
        }
        return `試技${s.attempt}/3 ／ 助走フェーズ${hint} ／ 追加ロール残: ${s.appRollsLeft}`;
      }
      if (s.phase === 'jump') {
        const confirmed = s.jmpConfirmed.reduce((a, b) => a + b, 0);
        const cur = s.jmpCurrentKept.reduce((a, i) => a + (s.jmpCurrentRoll ? s.jmpCurrentRoll[i] : 0), 0);
        return `試技${s.attempt}/3 ／ ジャンプフェーズ ／ キープ合計: ${confirmed + cur}点`;
      }
      if (s.phase === 'foul') return `試技${s.attempt}/3 ／ ファウル！合計10以上になったよ`;
      return '';
    },

    getAvailableActions(s) {
      if (s.betweenAttempt) {
        const label = s.attempt > 3 ? '結果確認' : `次の試技へ（${s.attempt}/3）`;
        return [{ id: 'NEXT_ATTEMPT', label, enabled: true }];
      }

      if (s.phase === 'approach') {
        if (!s.appDice) return [{ id: 'ROLL', label: '🎲 助走ロール！', enabled: true }];
        const hasKept = s.appKept.length > 0;
        // リロール後は新しいダイスから最低1個選ぶまでジャンプ不可
        const needSelectAfterReroll = s.appRerolled && !s.appKeptSinceRoll;
        const canJump = hasKept && !needSelectAfterReroll;
        return [
          { id: 'REROLL', label: `♻️ 振り直し（残${s.appRollsLeft}）`, enabled: s.appRollsLeft > 0 && s.appKeptSinceRoll },
          { id: 'GO_JUMP', label: '🦘 ジャンプへ！', enabled: canJump },
        ];
      }

      if (s.phase === 'jump') {
        if (!s.jmpCurrentRoll) return [{ id: 'ROLL', label: '🎲 ジャンプロール！', enabled: true }];
        const hasKept = s.jmpCurrentKept.length > 0;
        return [
          { id: 'REROLL', label: '♻️ ジャンプ振り直し', enabled: hasKept && s.jmpCurrentRoll.length > s.jmpCurrentKept.length },
          { id: 'STOP', label: '✅ STOP（得点確定）', enabled: true },
        ];
      }

      if (s.phase === 'foul') {
        const label = s.attempt >= 3 ? '試技終了・結果へ' : '次の試技へ';
        return [{ id: 'NEXT_ATTEMPT', label, enabled: true }];
      }
      return [];
    },

    applyAction(s, action) {
      s = JSON.parse(JSON.stringify(s));
      const type = typeof action === 'string' ? action : action.type;

      if (type === 'NEXT_ATTEMPT') {
        s.betweenAttempt = false;
        if (s.attempts.length >= 3) {
          s.phase = 'done';
        } else {
          Object.assign(s, newAttemptState());
        }
        return s;
      }

      if (type === 'ROLL') {
        if (s.phase === 'approach') {
          s.appDice = rollDice(5);
          s.appKeptSinceRoll = false;
          s.log.push(`[試技${s.attempt}][助走] ロール: [${s.appDice.join(', ')}]`);
        } else if (s.phase === 'jump') {
          s.jmpCurrentRoll = rollDice(s.jmpNumDice);
          s.jmpCurrentKept = [];
          s.log.push(`[試技${s.attempt}][ジャンプ] ロール: [${s.jmpCurrentRoll.join(', ')}]`);
        }
      } else if (type === 'TOGGLE') {
        const i = action.index;
        if (s.phase === 'approach' && s.appDice) {
          const idx = s.appKept.indexOf(i);
          if (idx >= 0) {
            s.appKept.splice(idx, 1);
            s.appKeptSinceRoll = s.appKept.length > 0;
            s.log.push(`[試技${s.attempt}][助走] キープ解除: ${s.appDice[i]}`);
          } else {
            const newSum = s.appKept.reduce((a, ki) => a + s.appDice[ki], 0) + s.appDice[i];
            if (newSum >= 10) {
              s.appKept.push(i);
              s.foul = true;
              s.phase = 'foul';
              s.log.push(`[試技${s.attempt}][助走] ファウル！合計 ${newSum} が10以上になった`);
              s.attempts.push({ score: 0, foul: true });
              s.attempt++;
              s.betweenAttempt = true;
            } else {
              s.appKept.push(i);
              s.appKeptSinceRoll = true;
              s.log.push(`[試技${s.attempt}][助走] キープ: ${s.appDice[i]}（合計${newSum}）`);
            }
          }
        } else if (s.phase === 'jump' && s.jmpCurrentRoll) {
          const idx = s.jmpCurrentKept.indexOf(i);
          if (idx >= 0) {
            s.jmpCurrentKept.splice(idx, 1);
            s.log.push(`[試技${s.attempt}][ジャンプ] キープ解除: ${s.jmpCurrentRoll[i]}`);
          } else {
            s.jmpCurrentKept.push(i);
            s.log.push(`[試技${s.attempt}][ジャンプ] キープ: ${s.jmpCurrentRoll[i]}`);
          }
        }
      } else if (type === 'REROLL') {
        if (s.phase === 'approach') {
          if (!s.appKeptSinceRoll) {
            s.log.push('先に1個キープしてから振り直してね！');
            return s;
          }
          s.appRollsLeft--;
          const keptVals = s.appKept.map(i => s.appDice[i]);
          const newDice = rollDice(5 - keptVals.length);
          const newAppDice = [];
          let newIdx = 0;
          for (let i = 0; i < 5; i++) {
            const kIdx = s.appKept.indexOf(i);
            if (kIdx >= 0) newAppDice.push(s.appDice[i]);
            else newAppDice.push(newDice[newIdx++]);
          }
          s.appDice = newAppDice;
          s.appKeptSinceRoll = false;
          s.appRerolled = true;
          s.log.push(`[試技${s.attempt}][助走] 振り直し: [${s.appDice.join(', ')}] (残${s.appRollsLeft}) ← 1つ以上えらんでね`);
        } else if (s.phase === 'jump') {
          s.jmpCurrentKept.forEach(i => s.jmpConfirmed.push(s.jmpCurrentRoll[i]));
          const newCount = s.jmpCurrentRoll.length - s.jmpCurrentKept.length;
          s.jmpCurrentRoll = rollDice(newCount);
          s.jmpCurrentKept = [];
          s.log.push(`[試技${s.attempt}][ジャンプ] 振り直し: [${s.jmpCurrentRoll.join(', ')}] (確保済: ${s.jmpConfirmed.join(', ')})`);
        }
      } else if (type === 'GO_JUMP') {
        if (s.appKept.length === 0) {
          s.log.push('まず1個キープしないとジャンプできないよ！');
          return s;
        }
        if (s.appRerolled && !s.appKeptSinceRoll) {
          s.log.push('リロールしたダイスから1つ以上えらんでください！');
          return s;
        }
        s.jmpNumDice = s.appKept.length;
        const appSum = s.appKept.reduce((a, i) => a + s.appDice[i], 0);
        s.log.push(`[試技${s.attempt}] 助走確定（合計${appSum}）、ジャンプへ（${s.jmpNumDice}個）`);
        s.phase = 'jump';
        s.jmpCurrentRoll = null;
        s.jmpCurrentKept = [];
        s.jmpConfirmed = [];
      } else if (type === 'STOP') {
        s.jmpCurrentKept.forEach(i => s.jmpConfirmed.push(s.jmpCurrentRoll[i]));
        const score = s.jmpConfirmed.reduce((a, b) => a + b, 0);
        s.log.push(`[試技${s.attempt}][ジャンプ] STOP → ${score}点`);
        s.attempts.push({ score, foul: false });
        s.attempt++;
        s.betweenAttempt = true;
        s.phase = 'approach';
      }

      return s;
    },

    isFinished(s) {
      return s.phase === 'done';
    },

    getResult(s) {
      if (s.attempts.length === 0) return { points: 0, details: '未完了' };
      const best = Math.max(...s.attempts.map(a => a.score));
      const detail = s.attempts.map((a, i) => `試技${i + 1}: ${a.foul ? 'ファウル' : a.score + '点'}`).join(' ／ ');
      return { points: best, details: `${detail} → 最高: ${best}点` };
    },
  };
})();
