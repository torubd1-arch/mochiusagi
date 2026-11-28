// 簡易シンセ（ndsp 1ch・モノラル16bit にソフトウェアでミックスして流す）
#include "audio.h"
#include <string.h>
#include <math.h>

#define SR          22050
#define BUF_SAMPLES 512
#define NBUF        4
#define MAX_VOICES  48
#define MASTER_GAIN 0.25f   // Web版の masterGain
#define OUTPUT_BOOST 2.0f   // 3DS 本体スピーカー向けの音量補正

typedef struct {
  bool   on;
  int    bus, wave;
  double t0, dur, env_t;
  float  f0, f1;
  float  env, env_k;   // 現在の音量と1サンプルごとの減衰率
  float  phase;
} Voice;

static Voice voices[MAX_VOICES];
static ndspWaveBuf wbuf[NBUF];
static s16 *pcm = NULL;
static bool ok = false;
static int next_buf = 0;
static double gen_time = 0;   // 生成済みサンプルの末尾時刻
static float bgm_bus = 0.40f, bgm_target = 0.40f;

bool audio_init(void) {
  if (R_FAILED(ndspInit())) { ok = false; return false; }
  pcm = (s16 *)linearAlloc(sizeof(s16) * BUF_SAMPLES * NBUF);
  if (!pcm) { ndspExit(); ok = false; return false; }
  memset(pcm, 0, sizeof(s16) * BUF_SAMPLES * NBUF);
  ndspSetOutputMode(NDSP_OUTPUT_MONO);
  ndspChnReset(0);
  ndspChnSetInterp(0, NDSP_INTERP_LINEAR);
  ndspChnSetRate(0, SR);
  ndspChnSetFormat(0, NDSP_FORMAT_MONO_PCM16);
  float mix[12] = { 0 };
  mix[0] = mix[1] = 1.0f;
  ndspChnSetMix(0, mix);
  memset(wbuf, 0, sizeof(wbuf));
  for (int i = 0; i < NBUF; i++) {
    wbuf[i].data_vaddr = pcm + i * BUF_SAMPLES;
    wbuf[i].nsamples = BUF_SAMPLES;
    wbuf[i].status = NDSP_WBUF_FREE;
  }
  memset(voices, 0, sizeof(voices));
  ok = true;
  return true;
}

void audio_exit(void) {
  if (!ok) return;
  ndspChnReset(0);
  ndspExit();
  linearFree(pcm);
  ok = false;
}

double audio_now(void) { return gen_time; }

void audio_set_bgm_volume(float target) { bgm_target = target; }

void audio_voice(int bus, int wave, double t0, double dur, float f0, float f1, float vol, double env_t) {
  if (!ok) return;
  for (int i = 0; i < MAX_VOICES; i++) {
    Voice *v = &voices[i];
    if (v->on) continue;
    v->on = true; v->bus = bus; v->wave = wave;
    v->t0 = t0; v->dur = dur; v->env_t = env_t;
    v->f0 = f0; v->f1 = f1;
    v->env = vol;
    // vol * (0.001/vol)^(t/env_t) を1サンプルずつの掛け算で表す
    v->env_k = powf(0.001f / vol, 1.0f / (float)(env_t * SR));
    v->phase = 0;
    return;
  }
}

static void fill(s16 *out) {
  const double dt = 1.0 / SR;
  // setTargetAtTime(τ=0.05) 相当の平滑化（バッファ単位）
  float k = 1.0f - expf(-(float)BUF_SAMPLES / SR / 0.05f);
  bgm_bus += (bgm_target - bgm_bus) * k;

  for (int s = 0; s < BUF_SAMPLES; s++) {
    double t = gen_time + s * dt;
    float mixv = 0;
    for (int i = 0; i < MAX_VOICES; i++) {
      Voice *v = &voices[i];
      if (!v->on || t < v->t0) continue;
      double lt = t - v->t0;
      if (lt >= v->dur) { v->on = false; continue; }
      float fr = v->f0 + (v->f1 - v->f0) * (float)(lt / v->dur);
      v->phase += fr / SR;
      if (v->phase >= 1.0f) v->phase -= floorf(v->phase);
      float w = (v->wave == WAVE_SQUARE) ? (v->phase < 0.5f ? 1.0f : -1.0f)
                                         : (4.0f * fabsf(v->phase - 0.5f) - 1.0f);
      float g = (lt < v->env_t) ? v->env : 0.001f;
      if (lt < v->env_t) v->env *= v->env_k;
      mixv += w * g * (v->bus == BUS_BGM ? bgm_bus : 1.0f);
    }
    float o = mixv * MASTER_GAIN * OUTPUT_BOOST;
    if (o > 1.0f) o = 1.0f;
    if (o < -1.0f) o = -1.0f;
    out[s] = (s16)(o * 32000.0f);
  }
  gen_time += BUF_SAMPLES * dt;
}

void audio_update(void) {
  if (!ok) {
    // 音が無い環境でも時刻だけは進めておく（BGM スケジューラ用）
    gen_time = osGetTime() / 1000.0;
    return;
  }
  // 再生が終わったバッファを順番どおりに補充する
  while (wbuf[next_buf].status == NDSP_WBUF_FREE || wbuf[next_buf].status == NDSP_WBUF_DONE) {
    s16 *p = pcm + next_buf * BUF_SAMPLES;
    fill(p);
    DSP_FlushDataCache(p, sizeof(s16) * BUF_SAMPLES);
    ndspChnWaveBufAdd(0, &wbuf[next_buf]);
    next_buf = (next_buf + 1) % NBUF;
  }
}
