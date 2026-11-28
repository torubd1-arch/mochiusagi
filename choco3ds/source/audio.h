// 簡易シンセ（Web Audio のオシレーター相当を ndsp で再現）
#pragma once
#include <3ds.h>
#include <stdbool.h>

enum { BUS_BGM, BUS_SE };
enum { WAVE_SQUARE, WAVE_TRIANGLE };

bool   audio_init(void);   // 失敗時（dspfirm.cdc が無い等）は false。以後は無音で動作
void   audio_exit(void);
void   audio_update(void); // 毎フレーム呼ぶ（バッファ補充）
double audio_now(void);    // AudioContext.currentTime 相当（秒）

// 1音を予約する
//  t0: 開始時刻, dur: 停止までの長さ, f0→f1: 周波数の直線変化（dur かけて）
//  vol: 開始音量, env_t: vol→0.001 へ指数減衰する時間
void audio_voice(int bus, int wave, double t0, double dur, float f0, float f1, float vol, double env_t);
void audio_set_bgm_volume(float target); // setTargetAtTime(…, 0.05) 相当
