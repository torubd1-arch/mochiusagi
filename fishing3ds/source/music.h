// ================================================================
//  BGM（曲データとシーケンサー）
//  3DS のライブラリには依存しない（PC 上の自動テストでもビルドできる）。
//  実際に音を鳴らすのは呼び出し側から渡す関数（main.c では audio_voice）。
// ================================================================
#pragma once
#include <stdbool.h>
#include <stdint.h>

enum { WAVE_SQ, WAVE_TRI };   // audio.h の WAVE_SQUARE / WAVE_TRIANGLE と同じ並び

typedef enum {
  SONG_TITLE,    // タイトル：「みずべの あさ」（ワルツ。水面のきらめきのような分散和音）
  SONG_PLAY,     // プレイ中：「つりびより」（のんびりしたカントリー調）
  SONG_FIGHT,    // やりとり中：「ひきが つよい」（速いテンポの短調）
  SONG_RESULT,   // 結果画面：ファンファーレ（1回だけ鳴らして、タイトルの曲へ）
  SONG_COUNT
} SongId;

#define MUSIC_PARTS 3

// 1音：note は MIDI ノート番号（0=休符）、len は 8分音符の数
typedef struct { uint8_t note, len; } Note;

typedef struct {
  int         wave;      // WAVE_SQ / WAVE_TRI
  float       vol;       // 音量
  float       gate;      // 音の長さ（音符の長さに対する割合）
  float       decay;     // 減衰の時間（鳴らす長さに対する倍率。大きいほど音が残る）
  const Note *notes;
  int         count;
} Part;

typedef struct {
  const char *name;
  float       bpm;       // 4分音符のテンポ
  bool        loop;
  int         next;      // ループしない曲の後に続ける曲（-1=止まる）
  int         part_count;
  Part        parts[MUSIC_PARTS];
} Song;

extern const Song SONGS[SONG_COUNT];
int song_steps(const Song *s, int part);   // パートの長さ（8分音符の数）

// 1音を鳴らす関数（t: 開始時刻, dur: 長さ, freq: 周波数, vol: 音量, decay: 減衰時間）
typedef void (*MusicNoteFn)(int wave, double t, double dur, float freq, float vol, double decay);

typedef struct {
  int    song;           // 再生中の曲（-1=なし）
  bool   paused;
  double next_t;         // 次のステップ（8分音符）の開始時刻
  int    step;           // 曲の中の現在のステップ
  int    idx[MUSIC_PARTS];   // 各パートの次の音符
  int    left[MUSIC_PARTS];  // 各パートの今の音符の残りステップ（0=次の音符を鳴らす）
  float  speed;          // テンポの倍率（残り時間が少ないときに速くする）
  int    resume_step[SONG_COUNT];  // 曲を切り替えたときの続きの位置
} Music;

#define MUSIC_LOOKAHEAD 0.15   // この秒数先までの音を予約しておく

void  music_init(Music *m);
// 曲を切り替える。同じ曲なら何もしない。resume=true なら前回の続きから
void  music_play(Music *m, int song, double now, bool resume);
void  music_stop(Music *m);
void  music_pause(Music *m, bool paused, double now);
void  music_set_speed(Music *m, float speed);
// 毎フレーム呼ぶ。now+MUSIC_LOOKAHEAD までの音を fn で予約する
void  music_update(Music *m, double now, MusicNoteFn fn);
float music_freq(int note);
