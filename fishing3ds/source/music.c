// ================================================================
//  BGM（オリジナル曲。外部素材は使っていない）
// ================================================================
#include "music.h"
#include <math.h>
#include <string.h>

// 音名（MIDI ノート番号）
enum {
  R = 0,
  B1 = 35, C2 = 36, D2 = 38, E2 = 40, F2 = 41, G2 = 43, A2 = 45, B2 = 47,
  C3 = 48, D3 = 50, E3 = 52, F3 = 53, G3 = 55, A3 = 57, B3 = 59,
  C4 = 60, D4 = 62, E4 = 64, F4 = 65, Fs4 = 66, G4 = 67, A4 = 69, B4 = 71,
  C5 = 72, D5 = 74, Ds5 = 75, E5 = 76, F5 = 77, Fs5 = 78, G5 = 79, A5 = 81, B5 = 83,
  C6 = 84
};

#define N(a) (int)(sizeof(a) / sizeof((a)[0]))

// ---------------------------------------------------------------
//  タイトル「みずべの あさ」 3/4拍子（1小節 = 8分音符6つ）
//  C | Am | F | G | C | Am | F G | C
// ---------------------------------------------------------------
static const Note TITLE_MEL[] = {
  {E5,3},{D5,1},{C5,2},  {A4,4},{C5,2},  {C5,2},{F5,2},{A5,2},  {G5,3},{F5,1},{D5,2},
  {E5,3},{G5,1},{E5,2},  {C5,2},{A4,2},{C5,2},  {A4,2},{C5,1},{D5,2},{B4,1},  {C5,6},
};
// 水面のきらめき（分散和音）
#define ARP6(a,b,c,d) {a,1},{b,1},{c,1},{d,1},{c,1},{b,1}
static const Note TITLE_ARP[] = {
  ARP6(C4,E4,G4,C5), ARP6(A3,C4,E4,A4), ARP6(F4,A4,C5,F5), ARP6(G4,B4,D5,G5),
  ARP6(C4,E4,G4,C5), ARP6(A3,C4,E4,A4), {F4,1},{A4,1},{C5,1},{G4,1},{B4,1},{D5,1}, ARP6(C4,E4,G4,C5),
};
static const Note TITLE_BASS[] = {
  {C3,6}, {A2,6}, {F2,6}, {G2,6}, {C3,6}, {A2,6}, {F2,3},{G2,3}, {C3,6},
};

// ---------------------------------------------------------------
//  プレイ中「つりびより」 4/4拍子（1小節 = 8分音符8つ）
//  A: G | Em | C | D | G | Em | Am D | G
//  B: C | G | C | D | Em | C | Am D | G
// ---------------------------------------------------------------
static const Note PLAY_MEL[] = {
  {D5,2},{B4,1},{D5,1},{G5,2},{D5,2},   {E5,3},{D5,1},{B4,4},
  {C5,2},{E5,2},{G5,2},{E5,2},          {D5,6},{R,2},
  {D5,2},{B4,1},{D5,1},{G5,2},{A5,2},   {G5,3},{E5,1},{D5,2},{B4,2},
  {A4,2},{C5,2},{B4,2},{A4,2},          {G4,6},{R,2},
  {E5,2},{E5,1},{G5,1},{E5,2},{C5,2},   {D5,2},{B4,2},{G4,4},
  {E5,2},{G5,2},{A5,2},{G5,2},          {Fs5,4},{D5,2},{R,2},
  {E5,2},{G5,2},{E5,2},{B4,2},          {C5,2},{E5,2},{G5,4},
  {A5,2},{G5,2},{Fs5,2},{A5,2},         {G5,6},{R,2},
};
// ベース（ルートと5度を交互に。カントリー風の「ブン・チャッ」の「ブン」）
#define BASS_BAR(r,f)  {r,2},{f,2},{r,2},{f,2}
#define BASS_HALF(r,f) {r,2},{f,2}
static const Note PLAY_BASS[] = {
  BASS_BAR(G2,D3), BASS_BAR(E2,B2), BASS_BAR(C3,G2), BASS_BAR(D3,A2),
  BASS_BAR(G2,D3), BASS_BAR(E2,B2), BASS_HALF(A2,E3), BASS_HALF(D3,A2), BASS_BAR(G2,D3),
  BASS_BAR(C3,G2), BASS_BAR(G2,D3), BASS_BAR(C3,G2), BASS_BAR(D3,A2),
  BASS_BAR(E2,B2), BASS_BAR(C3,G2), BASS_HALF(A2,E3), BASS_HALF(D3,A2), BASS_BAR(G2,D3),
};
// 裏拍のきざみ（「チャッ」）
#define CHICK_BAR(a,b)  {R,1},{a,1},{R,1},{b,1},{R,1},{a,1},{R,1},{b,1}
#define CHICK_HALF(a,b) {R,1},{a,1},{R,1},{b,1}
static const Note PLAY_CHICK[] = {
  CHICK_BAR(B3,D4), CHICK_BAR(B3,E4), CHICK_BAR(C4,E4), CHICK_BAR(D4,Fs4),
  CHICK_BAR(B3,D4), CHICK_BAR(B3,E4), CHICK_HALF(C4,E4), CHICK_HALF(D4,Fs4), CHICK_BAR(B3,D4),
  CHICK_BAR(C4,E4), CHICK_BAR(B3,D4), CHICK_BAR(C4,E4), CHICK_BAR(D4,Fs4),
  CHICK_BAR(B3,E4), CHICK_BAR(C4,E4), CHICK_HALF(C4,E4), CHICK_HALF(D4,Fs4), CHICK_BAR(B3,D4),
};

// ---------------------------------------------------------------
//  やりとり「ひきが つよい」 Em | C | D | B
// ---------------------------------------------------------------
static const Note FIGHT_MEL[] = {
  {B4,1},{R,1},{B4,1},{R,1},{E5,2},{D5,1},{B4,1},
  {C5,1},{R,1},{C5,1},{R,1},{E5,2},{G5,2},
  {Fs5,1},{R,1},{Fs5,1},{R,1},{D5,2},{A4,2},
  {B4,2},{Ds5,2},{Fs5,2},{A5,2},
};
#define DRIVE_BAR(lo,hi) {lo,1},{lo,1},{hi,1},{lo,1},{lo,1},{lo,1},{hi,1},{lo,1}
static const Note FIGHT_BASS[] = {
  DRIVE_BAR(E2,E3), DRIVE_BAR(C2,C3), DRIVE_BAR(D2,D3), DRIVE_BAR(B1,B2),
};

// ---------------------------------------------------------------
//  結果のファンファーレ（ループしない）
// ---------------------------------------------------------------
static const Note RESULT_MEL[] = {
  {G4,1},{C5,1},{E5,1},{G5,2},{E5,1},{G5,2},{C6,6},{R,2},
};
static const Note RESULT_HARM[] = {
  {E4,1},{G4,1},{C5,1},{E5,2},{C5,1},{E5,2},{G5,6},{R,2},
};
static const Note RESULT_BASS[] = {
  {C3,6},{G2,2},{C3,6},{R,2},
};

const Song SONGS[SONG_COUNT] = {
  [SONG_TITLE] = { "みずべの あさ", 84, true, -1, 3, {
    { WAVE_TRI, 0.30f, 0.95f, 1.6f, TITLE_MEL,  N(TITLE_MEL) },
    { WAVE_TRI, 0.12f, 0.90f, 2.0f, TITLE_ARP,  N(TITLE_ARP) },
    { WAVE_TRI, 0.30f, 0.95f, 1.2f, TITLE_BASS, N(TITLE_BASS) } } },
  [SONG_PLAY] = { "つりびより", 116, true, -1, 3, {
    { WAVE_TRI, 0.32f, 0.90f, 1.4f, PLAY_MEL,   N(PLAY_MEL) },
    { WAVE_TRI, 0.30f, 0.80f, 1.0f, PLAY_BASS,  N(PLAY_BASS) },
    { WAVE_SQ,  0.05f, 0.60f, 0.6f, PLAY_CHICK, N(PLAY_CHICK) } } },
  [SONG_FIGHT] = { "ひきが つよい", 152, true, -1, 2, {
    { WAVE_SQ,  0.12f, 0.55f, 0.9f, FIGHT_MEL,  N(FIGHT_MEL) },
    { WAVE_TRI, 0.34f, 0.70f, 0.9f, FIGHT_BASS, N(FIGHT_BASS) } } },
  [SONG_RESULT] = { "ファンファーレ", 132, false, SONG_TITLE, 3, {
    { WAVE_TRI, 0.32f, 0.95f, 1.5f, RESULT_MEL,  N(RESULT_MEL) },
    { WAVE_SQ,  0.06f, 0.90f, 1.5f, RESULT_HARM, N(RESULT_HARM) },
    { WAVE_TRI, 0.30f, 0.95f, 1.2f, RESULT_BASS, N(RESULT_BASS) } } },
};

// ---------------------------------------------------------------
//  シーケンサー
//  すべてのパートを共通の「ステップ（8分音符）」で進めるので、
//  テンポを変えても何周してもパート同士がずれない。
// ---------------------------------------------------------------
int song_steps(const Song *s, int part) {
  int n = 0;
  for (int i = 0; i < s->parts[part].count; i++) n += s->parts[part].notes[i].len;
  return n;
}

float music_freq(int note) { return 440.0f * powf(2.0f, (note - 69) / 12.0f); }

void music_init(Music *m) {
  memset(m, 0, sizeof(*m));
  m->song = -1;
  m->speed = 1.0f;
}

// 曲の step の位置から鳴らせるように、各パートの位置を合わせる
// （音符の途中から始まる場合、その音符は鳴らさずに次の音符を待つ）
static void seek(Music *m, int step) {
  const Song *s = &SONGS[m->song];
  int total = song_steps(s, 0);
  step = total > 0 ? step % total : 0;
  m->step = step;
  for (int p = 0; p < s->part_count; p++) {
    const Part *pt = &s->parts[p];
    int pos = 0, i = 0;
    while (i < pt->count && pos + pt->notes[i].len <= step) pos += pt->notes[i++].len;
    if (pos == step) {
      m->idx[p] = i;
      m->left[p] = 0;
    } else {
      m->idx[p] = i + 1;
      m->left[p] = pos + pt->notes[i].len - step;
    }
  }
}

void music_play(Music *m, int song, double now, bool resume) {
  if (m->song == song) { m->paused = false; return; }
  if (m->song >= 0) m->resume_step[m->song] = m->step;
  m->song = song;
  m->paused = false;
  m->next_t = now + 0.05;
  seek(m, resume ? m->resume_step[song] : 0);
}

void music_stop(Music *m) {
  if (m->song >= 0) m->resume_step[m->song] = m->step;
  m->song = -1;
}

void music_pause(Music *m, bool paused, double now) {
  if (m->paused == paused) return;
  m->paused = paused;
  if (!paused) m->next_t = now + 0.05;
}

void music_set_speed(Music *m, float speed) { m->speed = speed > 0.1f ? speed : 0.1f; }

void music_update(Music *m, double now, MusicNoteFn fn) {
  if (m->song < 0 || m->paused) return;
  if (m->next_t < now - 0.5) m->next_t = now;   // 大きく遅れた（HOME メニューなど）ら追いつかせる
  while (m->song >= 0 && m->next_t < now + MUSIC_LOOKAHEAD) {
    const Song *s = &SONGS[m->song];
    double step_dur = 60.0 / (s->bpm * m->speed) / 2.0;
    for (int p = 0; p < s->part_count; p++) {
      const Part *pt = &s->parts[p];
      if (m->left[p] > 0 || m->idx[p] >= pt->count) continue;
      const Note *n = &pt->notes[m->idx[p]++];
      m->left[p] = n->len;
      if (n->note && fn) {
        double dur = n->len * step_dur * pt->gate;
        fn(pt->wave, m->next_t, dur, music_freq(n->note), pt->vol, dur * pt->decay);
      }
    }
    for (int p = 0; p < s->part_count; p++) if (m->left[p] > 0) m->left[p]--;
    m->next_t += step_dur;
    m->step++;
    if (m->step < song_steps(s, 0)) continue;
    // 曲の終わり
    m->resume_step[m->song] = 0;
    if (s->loop) {
      seek(m, 0);
    } else if (s->next >= 0) {
      m->song = s->next;
      seek(m, 0);
      m->next_t += 0.4;   // ひと呼吸おいて次の曲へ
    } else {
      m->song = -1;
    }
  }
}
