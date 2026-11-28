// ================================================================
//  BGM を PC で WAV に書き出す（実機が無くても曲を確認するため）
//  source/music.c の曲データとシーケンサーをそのまま使い、
//  音の合成は source/audio.c と同じ計算（矩形波・三角波・指数減衰）で行う。
//  使い方: make → out/ に曲ごとの WAV ができる
// ================================================================
#include <stdio.h>
#include <stdint.h>
#include <string.h>
#include <math.h>
#include "music.h"

#define SR           22050
#define BUF_SAMPLES  512
#define MAX_VOICES   48
#define MASTER_GAIN  0.25f   // audio.c と同じ
#define OUTPUT_BOOST 2.0f
#define BGM_BUS      0.60f   // main.c の BGM_VOL

typedef struct { int on, wave; double t0, dur, env_t; float f, env, env_k, phase; } Voice;
static Voice voices[MAX_VOICES];
static double gen_time = 0;

static void voice(int wave, double t, double dur, float freq, float vol, double decay) {
  for (int i = 0; i < MAX_VOICES; i++) {
    Voice *v = &voices[i];
    if (v->on) continue;
    v->on = 1; v->wave = wave; v->t0 = t; v->dur = dur; v->env_t = decay;
    v->f = freq; v->env = vol; v->phase = 0;
    v->env_k = powf(0.001f / vol, 1.0f / (float)(decay * SR));
    return;
  }
  fprintf(stderr, "voices full at %.2f\n", t);
}

static void fill(int16_t *out) {
  for (int s = 0; s < BUF_SAMPLES; s++) {
    double t = gen_time + (double)s / SR;
    float mix = 0;
    for (int i = 0; i < MAX_VOICES; i++) {
      Voice *v = &voices[i];
      if (!v->on || t < v->t0) continue;
      double lt = t - v->t0;
      if (lt >= v->dur) { v->on = 0; continue; }
      v->phase += v->f / SR;
      if (v->phase >= 1.0f) v->phase -= floorf(v->phase);
      float w = v->wave == WAVE_SQ ? (v->phase < 0.5f ? 1.0f : -1.0f) : (4.0f * fabsf(v->phase - 0.5f) - 1.0f);
      float g = lt < v->env_t ? v->env : 0.001f;
      if (lt < v->env_t) v->env *= v->env_k;
      mix += w * g * BGM_BUS;
    }
    float o = mix * MASTER_GAIN * OUTPUT_BOOST;
    if (o > 1) o = 1;
    if (o < -1) o = -1;
    out[s] = (int16_t)(o * 32000.0f);
  }
  gen_time += (double)BUF_SAMPLES / SR;
}

static void put16(FILE *f, int v) { fputc(v & 255, f); fputc((v >> 8) & 255, f); }
static void put32(FILE *f, uint32_t v) { put16(f, v & 0xFFFF); put16(f, v >> 16); }

// song を sec 秒ぶん書き出す。speed_from 秒以降はテンポを speed 倍にする
static void render(const char *path, int song, double sec, double speed_from, float speed) {
  static int16_t pcm[SR * 120];
  Music m;
  memset(voices, 0, sizeof(voices));
  gen_time = 0;
  music_init(&m);
  music_play(&m, song, 0, false);
  int n = 0, total = (int)(sec * SR);
  if (total > SR * 120) total = SR * 120;
  while (n + BUF_SAMPLES <= total) {
    if (gen_time >= speed_from) music_set_speed(&m, speed);
    music_update(&m, gen_time, voice);
    fill(pcm + n);
    n += BUF_SAMPLES;
  }
  FILE *f = fopen(path, "wb");
  if (!f) { perror(path); return; }
  fwrite("RIFF", 1, 4, f); put32(f, 36 + n * 2); fwrite("WAVEfmt ", 1, 8, f);
  put32(f, 16); put16(f, 1); put16(f, 1); put32(f, SR); put32(f, SR * 2); put16(f, 2); put16(f, 16);
  fwrite("data", 1, 4, f); put32(f, n * 2);
  for (int i = 0; i < n; i++) put16(f, pcm[i]);
  fclose(f);
  printf("%-24s %5.1f 秒  （%s）\n", path, (double)n / SR, SONGS[song].name);
}

int main(void) {
  double step_play = 60.0 / SONGS[SONG_PLAY].bpm / 2.0;
  double loop_play = song_steps(&SONGS[SONG_PLAY], 0) * step_play;
  render("out/1_title.wav",  SONG_TITLE,  40, 1e9, 1.0f);
  // プレイ中：2周したあと、残り10秒のテンポアップ（1.2倍）を聴けるようにする
  render("out/2_play.wav",   SONG_PLAY,   loop_play * 2 + 14, loop_play * 2 + 0.05, 1.2f);
  render("out/3_fight.wav",  SONG_FIGHT,  16, 1e9, 1.0f);
  render("out/4_result.wav", SONG_RESULT, 14, 1e9, 1.0f);   // ファンファーレ → タイトルの曲
  return 0;
}
