// ================================================================
//  チョコキャッチ！ 3DS版
//  Web版（choco/index.html）のゲーム仕様をそのまま移植したもの
//
//  画面構成
//   上画面 (400x240): ゲームフィールド / タイトル説明 / 結果 / ずかん一覧
//   下画面 (320x240): スコア・のこり時間などの表示、タッチボタン
//
//  ゲーム内の座標は 800x480 の論理座標で扱い、上画面へ 0.5 倍で描く。
//  （Web版は 800x600。高さが違う分は落下速度を補正して
//    「アイテムがプレイヤーに届くまでの時間」を揃えている）
// ================================================================
#include <3ds.h>
#include <citro2d.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>
#include <time.h>
#include "data.h"
#include "draw.h"
#include "icons.h"
#include "audio.h"
#include "save.h"

#define PI_F  3.14159265f
#define TAU_F 6.28318531f

// ================================================================
//  定数（Web版と同じ値）
// ================================================================
#define CANVAS_W            800.0f
#define CANVAS_H            480.0f
#define WORLD_SCALE         0.5f
#define GAME_DURATION       30.0f
#define PLAYER_SPEED        320.0f
#define PLAYER_W            44.0f
#define PLAYER_H            90.0f
#define STUN_DURATION       1.5f
#define STUN_BLINK_INTERVAL 0.2f
#define SPAWN_RATE_MIN      3.0f
#define SPAWN_RATE_MAX      5.0f
#define GROUND_Y            (CANVAS_H - 70.0f)
// Web版: 出現位置(-40)からプレイヤー位置(530)まで 570。3DS版は GROUND_Y+40
#define FALL_SCALE          ((GROUND_Y + 40.0f) / 570.0f)
#define FALL_SPEED_MIN      (250.0f * FALL_SCALE)
#define FALL_SPEED_MAX      (450.0f * FALL_SCALE)
#define CHOCO_SIZE          32.0f
#define DUMBBELL_BAR_W      48.0f
#define DUMBBELL_BALL_R     11.0f
#define POPUP_DURATION      0.9f
#define NEW_POPUP_DURATION  0.8f
#define SPECIAL_POPUP_DUR   0.85f
#define LAST_SECONDS        5.0f
#define RARE_CHANCE         0.08f

#define BROWN_CHOCO_SCORE   1
#define PURPLE_CHOCO_SCORE  2
#define HAT_SCORE           3
#define HELD_SCORE          3

#define SPAWN_RATIO_BROWN    0.45f
#define SPAWN_RATIO_PURPLE   0.10f
#define SPAWN_RATIO_DUMBBELL 0.18f
#define SPAWN_RATIO_HAT      0.12f
// HELD = 残り 0.15

#define HAT_ITEM_W  36.0f
#define HAT_ITEM_H  36.0f
#define HELD_ITEM_W 36.0f
#define HELD_ITEM_H 36.0f

#define BGM_BPM      150.0f
#define BGM_BPM_FAST 195.0f
#define BGM_VOL_NORM 0.40f
#define BGM_VOL_LAST 0.65f

// ずかん（3DS版は 6列×3行 = 18件/ページ、5ページ）
#define COLL_COLS      6
#define COLL_ROWS      3
#define COLL_PAGE_SIZE (COLL_COLS * COLL_ROWS)
#define COLL_PAGES     (NUM_IDS / COLL_PAGE_SIZE)
#define COLL_CELL_W    64.0f
#define COLL_CELL_H    66.0f
#define COLL_START_X   ((400.0f - COLL_COLS * COLL_CELL_W) / 2)
#define COLL_START_Y   38.0f

static const float BGM_NOTES[][2] = {
  { 523.25f, 1 }, { 659.25f, 1 }, { 783.99f, 1 }, { 659.25f, 1 },
  { 587.33f, 1 }, { 698.46f, 1 }, { 880.00f, 1 }, { 698.46f, 1 },
  { 659.25f, 1 }, { 783.99f, 1 }, { 987.77f, 1 }, { 783.99f, 1 },
  { 1046.50f, 2 }, { 783.99f, 2 },
};
#define BGM_LEN ((int)(sizeof(BGM_NOTES) / sizeof(BGM_NOTES[0])))

// ================================================================
//  型・ゲーム変数
// ================================================================
enum { ST_TITLE, ST_PLAYING, ST_GAMEOVER, ST_COLLECTION };
enum { CHAR_GIRL, CHAR_BOY };

typedef struct { int cat, base, color; bool rare; float x, y, speed; } Item;
typedef struct { float x, y, timer; char text[16]; u32 color; } Popup;
typedef struct { float x, y, timer; } NewPopup;
typedef struct { float x, y, vx, vy, r, life; u32 color; } Particle;
typedef struct { float x, y, w, h; } Rect;

#define MAX_ITEMS    64
#define MAX_POPUPS   32
#define MAX_NEWPOPS  16
#define NUM_PARTS    40

static int   game_state = ST_TITLE, score = 0;
static float time_left = GAME_DURATION;
static int   character_type = CHAR_GIRL;
static float spawn_timer = 0, timer_blink_timer = 0;
static bool  timer_blink_visible = true;
static float screen_flash_timer = 0;
static u32   screen_flash_color = RGB(0xFFFFFF);
static char  special_popup_text[32] = "";
static float special_popup_timer = 0;
static int   coll_tab = CAT_HAT, coll_page = 0;
static bool  sound_on = true;
static bool  confirm_reset = false;

static float full_complete_timer = 0, full_complete_rainbow_timer = 0;
static bool  full_complete_is_first = false;
static Particle parts[NUM_PARTS];
static int n_parts = 0;

static Item     items[MAX_ITEMS];     static int n_items = 0;
static Popup    popups[MAX_POPUPS];   static int n_popups = 0;
static NewPopup newpops[MAX_NEWPOPS]; static int n_newpops = 0;

// 今回のプレイで取ったもの（重複なし・取った順）
static int  sess_hats[NUM_IDS], n_sess_hats = 0;
static int  sess_held[NUM_IDS], n_sess_held = 0;
static bool sess_hat_seen[NUM_IDS], sess_held_seen[NUM_IDS];

static struct {
  float x, y, stun_timer, blink_timer;
  bool  blink_visible;
  float leg_angle, leg_swing_dir;
  bool  is_moving, has_crown;
  int   hat_base, hat_color, held_base, held_color; // -1 = なし
} player;

// 入力（下画面のタッチ移動ボタン）
static bool touch_left = false, touch_right = false;

// 日替わりラッキーアイテム
static int lucky_cat = CAT_HAT, lucky_idx = 0;

// ================================================================
//  ユーティリティ
// ================================================================
static u32 rng_state = 1;
static float frand(void) {
  rng_state ^= rng_state << 13;
  rng_state ^= rng_state >> 17;
  rng_state ^= rng_state << 5;
  return (rng_state >> 8) / 16777216.0f;
}
static float rnd(float a, float b) { return frand() * (b - a) + a; }
static int   irand(int n) { int v = (int)(frand() * n); return v >= n ? n - 1 : v; }
static bool  in_rect(float mx, float my, Rect r) { return mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h; }

static bool is_lucky(int cat, int idx) { return cat == lucky_cat && idx == lucky_idx; }

static void item_name(char *buf, size_t cap, int cat, int idx) {
  const char *bn = (cat == CAT_HAT) ? HAT_BASE_NAMES[idx_base(idx)] : HELD_BASE_NAMES[idx_base(idx)];
  snprintf(buf, cap, "%s(%s)", bn, COLOR_NAME[idx_color(idx)]);
}

// UTF-8 文字数で切り詰め（超えたら「…」を付ける）
static void utf8_trunc(char *dst, size_t cap, const char *src, int maxch) {
  int total = 0;
  for (const unsigned char *q = (const unsigned char *)src; *q; q++) if ((*q & 0xC0) != 0x80) total++;
  if (total <= maxch) { snprintf(dst, cap, "%s", src); return; }
  int count = 0; size_t i = 0;
  while (src[i]) {
    if (((unsigned char)src[i] & 0xC0) != 0x80) { if (count == maxch) break; count++; }
    i++;
  }
  snprintf(dst, cap, "%.*s…", (int)i, src);
}

// ================================================================
//  Lucky Item（日替わり。Web版と同じ計算なので同じ日は同じアイテム）
// ================================================================
static void select_lucky(void) {
  time_t now = time(NULL);
  struct tm *t = gmtime(&now); // 3DS の time() は本体設定の現地時刻を返す
  char key[40];
  snprintf(key, sizeof(key), "%04d-%02d-%02d", t->tm_year + 1900, t->tm_mon + 1, t->tm_mday);
  s32 h = 0;
  for (const char *p = key; *p; p++) h = (s32)((u32)h * 31u + (u32)(unsigned char)*p);
  s64 ah = h < 0 ? -(s64)h : (s64)h;
  int k = (int)(ah % (NUM_IDS * 2));
  if (k < NUM_IDS) { lucky_cat = CAT_HAT; lucky_idx = k; }
  else             { lucky_cat = CAT_HELD; lucky_idx = k - NUM_IDS; }
}

// ================================================================
//  スコア計算
// ================================================================
static int calculate_score(int cat, int idx, bool rare) {
  if (cat == CAT_BROWN) return BROWN_CHOCO_SCORE;
  if (cat == CAT_PURPLE) return PURPLE_CHOCO_SCORE;
  int base = (cat == CAT_HAT) ? HAT_SCORE : HELD_SCORE;
  int mult = 1;
  if (rare) mult *= 2;
  if (is_lucky(cat, idx)) mult *= 2;
  return base * mult;
}

// ================================================================
//  図鑑
// ================================================================
static int count_got(const CollEntry *tbl) {
  int n = 0;
  for (int i = 0; i < NUM_IDS; i++) if (tbl[i].normal + tbl[i].rare > 0) n++;
  return n;
}
static int count_rare(const CollEntry *tbl) {
  int n = 0;
  for (int i = 0; i < NUM_IDS; i++) if (tbl[i].rare > 0) n++;
  return n;
}

// ================================================================
//  音
// ================================================================
enum {
  SE_CHOCOLATE, SE_PURPLE, SE_HAT, SE_HELD, SE_RARE, SE_LUCKY, SE_NEW_ITEM,
  SE_CROWN, SE_DUMBBELL, SE_START, SE_GAMEOVER, SE_FULLCOMPLETE,
};

static bool   bgm_running = false;
static int    bgm_note_index = 0;
static double bgm_next_time = 0;

static void tone(const float *freqs, int n, float dur, float vol, int wave, float gap) {
  double t = audio_now();
  for (int i = 0; i < n; i++)
    audio_voice(BUS_SE, wave, t + i * gap, dur, freqs[i], freqs[i] * 1.1f, vol, dur);
}

static void play_se(int type) {
  if (!sound_on) return;
  double t = audio_now();
  switch (type) {
  case SE_CHOCOLATE:  { const float f[] = { 800, 1200 };             tone(f, 2, 0.08f, 0.15f, WAVE_SQUARE, 0.08f); break; }
  case SE_PURPLE:     { const float f[] = { 1200, 1600 };            tone(f, 2, 0.10f, 0.18f, WAVE_SQUARE, 0.10f); break; }
  case SE_HAT:        { const float f[] = { 600, 900 };              tone(f, 2, 0.07f, 0.18f, WAVE_SQUARE, 0.07f); break; }
  case SE_HELD:       { const float f[] = { 750, 950 };              tone(f, 2, 0.07f, 0.18f, WAVE_SQUARE, 0.07f); break; }
  case SE_RARE:       { const float f[] = { 700, 1050, 1300 };       tone(f, 3, 0.09f, 0.20f, WAVE_SQUARE, 0.09f); break; }
  case SE_LUCKY:      { const float f[] = { 900, 1100, 1400, 1700 }; tone(f, 4, 0.10f, 0.22f, WAVE_TRIANGLE, 0.09f); break; }
  case SE_NEW_ITEM:   { const float f[] = { 700, 1000, 1400 };       tone(f, 3, 0.09f, 0.22f, WAVE_SQUARE, 0.10f); break; }
  case SE_CROWN:      { const float f[] = { 800, 1200, 1600 };       tone(f, 3, 0.07f, 0.22f, WAVE_SQUARE, 0.07f); break; }
  case SE_START:      { const float f[] = { 400, 800 };              tone(f, 2, 0.15f, 0.20f, WAVE_SQUARE, 0.15f); break; }
  case SE_DUMBBELL:
    audio_voice(BUS_SE, WAVE_SQUARE, t, 0.2, 300, 120, 0.30f, 0.2);
    break;
  case SE_GAMEOVER: {
    const float f[] = { 523.25f, 392.00f, 261.63f };
    for (int i = 0; i < 3; i++) audio_voice(BUS_SE, WAVE_SQUARE, t + i * 0.13, 0.12, f[i], f[i], 0.25f, 0.11);
    break;
  }
  case SE_FULLCOMPLETE: {
    // 上昇アルペジオ（長め）
    const float f[] = { 261.63f, 329.63f, 392.00f, 523.25f, 659.25f, 783.99f, 1046.50f, 1318.51f };
    for (int i = 0; i < 8; i++) audio_voice(BUS_SE, WAVE_TRIANGLE, t + i * 0.11, 0.46, f[i], f[i], 0.28f, 0.45);
    break;
  }
  }
}

static void schedule_bgm(void) {
  if (!bgm_running) return;
  if (!sound_on || game_state != ST_PLAYING) { bgm_running = false; return; }
  audio_set_bgm_volume(time_left <= LAST_SECONDS ? BGM_VOL_LAST : BGM_VOL_NORM);
  double now = audio_now();
  if (bgm_next_time < now - 0.5) bgm_next_time = now; // 大きく遅れたら追いつかせる
  while (bgm_next_time < now + 0.12) {
    bool fast = (time_left <= LAST_SECONDS && game_state == ST_PLAYING);
    double dur = (60.0 / (fast ? BGM_BPM_FAST : BGM_BPM) / 2.0) * BGM_NOTES[bgm_note_index][1];
    float fr = BGM_NOTES[bgm_note_index][0];
    audio_voice(BUS_BGM, WAVE_SQUARE, bgm_next_time, dur, fr, fr, 0.3f, dur * 0.82);
    bgm_next_time += dur;
    bgm_note_index = (bgm_note_index + 1) % BGM_LEN;
  }
}
static void play_bgm(void) {
  if (!sound_on) return;
  bgm_running = true; bgm_note_index = 0; bgm_next_time = audio_now() + 0.05;
  schedule_bgm();
}
static void stop_bgm(void) { bgm_running = false; }

static void toggle_sound(void) {
  sound_on = !sound_on;
  if (!sound_on) stop_bgm();
  else if (game_state == ST_PLAYING) play_bgm();
}

// ================================================================
//  ゲームリセット
// ================================================================
static void reset_game(void) {
  score = 0; time_left = GAME_DURATION; n_items = 0; n_popups = 0; n_newpops = 0;
  spawn_timer = 1.0f / rnd(SPAWN_RATE_MIN, SPAWN_RATE_MAX);
  timer_blink_timer = 0; timer_blink_visible = true;
  screen_flash_timer = 0; special_popup_text[0] = 0; special_popup_timer = 0;
  full_complete_timer = 0; n_parts = 0;
  n_sess_hats = 0; n_sess_held = 0;
  memset(sess_hat_seen, 0, sizeof(sess_hat_seen));
  memset(sess_held_seen, 0, sizeof(sess_held_seen));
  player.x = CANVAS_W / 2; player.y = GROUND_Y;
  player.stun_timer = 0; player.blink_timer = 0; player.blink_visible = true;
  player.leg_angle = 0; player.leg_swing_dir = 1; player.is_moving = false;
  player.has_crown = false; player.hat_base = -1; player.hat_color = -1;
  player.held_base = -1; player.held_color = -1;
  save.plays++; save_write();
  game_state = ST_PLAYING; play_se(SE_START); play_bgm();
}
static void try_start(void) {
  if (game_state == ST_TITLE || game_state == ST_GAMEOVER) reset_game();
}

// ================================================================
//  アイテム生成
// ================================================================
static void spawn_item(void) {
  if (n_items >= MAX_ITEMS) return;
  Item *it = &items[n_items];
  float r = frand();
  it->rare = false; it->base = 0; it->color = 0;
  it->y = -40; it->speed = rnd(FALL_SPEED_MIN, FALL_SPEED_MAX);
  if (r < SPAWN_RATIO_BROWN) {
    it->cat = CAT_BROWN; it->x = rnd(60, CANVAS_W - 60);
  } else if (r < SPAWN_RATIO_BROWN + SPAWN_RATIO_PURPLE) {
    it->cat = CAT_PURPLE; it->x = rnd(60, CANVAS_W - 60);
  } else if (r < SPAWN_RATIO_BROWN + SPAWN_RATIO_PURPLE + SPAWN_RATIO_DUMBBELL) {
    it->cat = CAT_DUMBBELL; it->x = rnd(80, CANVAS_W - 80);
  } else {
    bool hat = r < SPAWN_RATIO_BROWN + SPAWN_RATIO_PURPLE + SPAWN_RATIO_DUMBBELL + SPAWN_RATIO_HAT;
    it->cat = hat ? CAT_HAT : CAT_HELD;
    it->base = irand(NUM_BASES);
    it->color = irand(NUM_COLORS);
    it->rare = frand() < RARE_CHANCE;
    it->x = rnd(60, CANVAS_W - 60);
  }
  n_items++;
}

// ================================================================
//  衝突判定
// ================================================================
static bool check_collision(const Item *it) {
  float hw = PLAYER_W / 2, hh = PLAYER_H / 2, ihw, ihh;
  if (it->cat == CAT_BROWN || it->cat == CAT_PURPLE) { ihw = CHOCO_SIZE / 2; ihh = CHOCO_SIZE / 2; }
  else if (it->cat == CAT_HAT)  { ihw = HAT_ITEM_W / 2;  ihh = HAT_ITEM_H / 2; }
  else if (it->cat == CAT_HELD) { ihw = HELD_ITEM_W / 2; ihh = HELD_ITEM_H / 2; }
  else { ihw = DUMBBELL_BAR_W / 2 + DUMBBELL_BALL_R; ihh = DUMBBELL_BALL_R; }
  return fabsf(player.x - it->x) < hw + ihw && fabsf(player.y - it->y) < hh + ihh;
}

// ================================================================
//  図鑑更新・フルコンプリート
// ================================================================
static void add_popup(float x, float y, const char *text, u32 color) {
  if (n_popups >= MAX_POPUPS) return;
  Popup *p = &popups[n_popups++];
  p->x = x; p->y = y; p->timer = POPUP_DURATION; p->color = color;
  snprintf(p->text, sizeof(p->text), "%s", text);
}

static void trigger_full_complete(void) {
  full_complete_timer = full_complete_is_first ? 2.5f : 0.8f;
  full_complete_rainbow_timer = 0;
  n_parts = 0;
  if (full_complete_is_first) {
    play_se(SE_FULLCOMPLETE);
    static const u32 pc[7] = { RGB(0xFF0000), RGB(0xFF8800), RGB(0xFFFF00), RGB(0x00FF88), RGB(0x0088FF), RGB(0x8800FF), RGB(0xFF00FF) };
    for (int i = 0; i < NUM_PARTS; i++) {
      float ang = (float)i / NUM_PARTS * TAU_F;
      Particle *p = &parts[n_parts++];
      p->x = CANVAS_W / 2; p->y = CANVAS_H / 2;
      p->vx = cosf(ang) * rnd(80, 260); p->vy = sinf(ang) * rnd(80, 260);
      p->color = pc[i % 7]; p->r = rnd(5, 11); p->life = rnd(1.4f, 2.4f);
    }
  }
}

static void check_full_complete(bool is_new) {
  if (!is_new) return;
  if (count_got(save.hats) == NUM_IDS && count_got(save.held) == NUM_IDS) {
    full_complete_is_first = !save.full_complete_once;
    if (!save.full_complete_once) save.full_complete_once = 1;
    trigger_full_complete();
  }
}

static bool collect_item(int cat, int idx, bool rare, float ix, float iy) {
  CollEntry *e = (cat == CAT_HAT) ? &save.hats[idx] : &save.held[idx];
  bool is_new = (e->normal + e->rare) == 0;
  if (rare) e->rare++; else e->normal++;
  if (is_new && n_newpops < MAX_NEWPOPS) {
    NewPopup *p = &newpops[n_newpops++];
    p->x = ix; p->y = iy - 30; p->timer = NEW_POPUP_DURATION;
  }
  check_full_complete(is_new);
  return is_new;
}

static void apply_special_effect(bool lucky, bool rare) {
  if (lucky && rare) { snprintf(special_popup_text, sizeof(special_popup_text), "RARE LUCKY! x4"); screen_flash_color = RGB(0xFFD700); }
  else if (lucky)    { snprintf(special_popup_text, sizeof(special_popup_text), "LUCKY! x2");      screen_flash_color = RGB(0xFFFF88); }
  else               { snprintf(special_popup_text, sizeof(special_popup_text), "RARE! x2");       screen_flash_color = RGB(0xCC88FF); }
  special_popup_timer = SPECIAL_POPUP_DUR; screen_flash_timer = 0.22f;
  play_se(lucky ? SE_LUCKY : SE_RARE);
}

// ================================================================
//  更新
// ================================================================
static void update(float dt, u32 kHeld) {
  if (game_state != ST_PLAYING) return;

  time_left -= dt;
  if (time_left <= 0) {
    time_left = 0;
    if (score > save.high_score) save.high_score = score;
    if (score > save.best_score) save.best_score = score;
    save_write();
    game_state = ST_GAMEOVER; stop_bgm(); play_se(SE_GAMEOVER);
    return;
  }

  if (time_left <= LAST_SECONDS) {
    timer_blink_timer += dt;
    if (timer_blink_timer >= 0.25f) { timer_blink_timer = 0; timer_blink_visible = !timer_blink_visible; }
  } else { timer_blink_timer = 0; timer_blink_visible = true; }
  if (screen_flash_timer > 0)  screen_flash_timer  = fmaxf(0, screen_flash_timer - dt);
  if (special_popup_timer > 0) special_popup_timer = fmaxf(0, special_popup_timer - dt);
  if (full_complete_timer > 0) {
    full_complete_timer = fmaxf(0, full_complete_timer - dt);
    full_complete_rainbow_timer += dt;
    for (int i = 0; i < n_parts; i++) {
      Particle *p = &parts[i];
      p->x += p->vx * dt; p->y += p->vy * dt;
      p->vy += 200 * dt; // 重力
      p->life = fmaxf(0, p->life - dt);
    }
  }

  // スタン
  if (player.stun_timer > 0) {
    player.stun_timer -= dt; player.blink_timer += dt;
    if (player.blink_timer >= STUN_BLINK_INTERVAL) { player.blink_timer = 0; player.blink_visible = !player.blink_visible; }
    if (player.stun_timer <= 0) { player.stun_timer = 0; player.blink_visible = true; }
  }

  // 移動（十字キー / スライドパッド / 下画面ボタン）
  player.is_moving = false;
  if (player.stun_timer <= 0) {
    bool left  = (kHeld & KEY_LEFT)  || touch_left;
    bool right = (kHeld & KEY_RIGHT) || touch_right;
    if (left)  { player.x -= PLAYER_SPEED * dt; player.is_moving = true; }
    if (right) { player.x += PLAYER_SPEED * dt; player.is_moving = true; }
    player.x = fmaxf(PLAYER_W / 2, fminf(CANVAS_W - PLAYER_W / 2, player.x));
  }

  // 足アニメ
  if (player.is_moving) {
    player.leg_angle += player.leg_swing_dir * dt * 7;
    if (fabsf(player.leg_angle) > 0.55f) player.leg_swing_dir *= -1;
  } else {
    player.leg_angle *= 0.85f;
    if (fabsf(player.leg_angle) < 0.01f) player.leg_angle = 0;
  }

  // スポーン
  spawn_timer -= dt;
  if (spawn_timer <= 0) { spawn_timer = 1.0f / rnd(SPAWN_RATE_MIN, SPAWN_RATE_MAX); spawn_item(); }

  // アイテム更新
  int w = 0;
  for (int i = 0; i < n_items; i++) {
    Item it = items[i];
    it.y += it.speed * dt;
    bool remove = false;
    if (it.y > CANVAS_H + 40) remove = true;
    else if (check_collision(&it)) {
      remove = true;
      char buf[16];
      if (it.cat == CAT_BROWN) {
        score += BROWN_CHOCO_SCORE;
        add_popup(it.x, it.y, "+1", RGB(0xFF8800));
        play_se(SE_CHOCOLATE);
      } else if (it.cat == CAT_PURPLE) {
        score += PURPLE_CHOCO_SCORE;
        add_popup(it.x, it.y, "+2", RGB(0xCC88FF));
        play_se(SE_PURPLE);
      } else if (it.cat == CAT_HAT || it.cat == CAT_HELD) {
        bool hat = it.cat == CAT_HAT;
        int idx = item_idx(it.base, it.color);
        int gain = calculate_score(it.cat, idx, it.rare);
        score += gain;
        if (hat) {
          player.hat_base = it.base; player.hat_color = it.color;
          player.has_crown = (it.base == HAT_CROWN || it.base == HAT_CROWN_PRINCE || it.base == HAT_CROWN_QUEEN);
          if (player.has_crown) play_se(SE_CROWN);
          if (!sess_hat_seen[idx]) { sess_hat_seen[idx] = true; sess_hats[n_sess_hats++] = idx; }
        } else {
          player.held_base = it.base; player.held_color = it.color;
          if (!sess_held_seen[idx]) { sess_held_seen[idx] = true; sess_held[n_sess_held++] = idx; }
        }
        bool lucky = is_lucky(it.cat, idx), rare = it.rare;
        u32 pcol = rare ? RGB(0xFFD700) : (lucky ? RGB(0xFFFF44) : (hat ? RGB(0x88FF88) : RGB(0xAADDFF)));
        snprintf(buf, sizeof(buf), "+%d", gain);
        add_popup(it.x, it.y, buf, pcol);
        bool is_new = collect_item(it.cat, idx, rare, it.x, it.y);
        if (lucky || rare) apply_special_effect(lucky, rare);
        else if (is_new) play_se(SE_NEW_ITEM);
        else if (hat) { if (!player.has_crown) play_se(SE_HAT); }
        else play_se(SE_HELD);
      } else if (it.cat == CAT_DUMBBELL) {
        if (player.stun_timer <= 0) {
          player.stun_timer = STUN_DURATION; player.blink_timer = 0; player.blink_visible = true;
          play_se(SE_DUMBBELL);
        }
      }
    }
    if (!remove) items[w++] = it;
  }
  n_items = w;

  // ポップアップ更新
  w = 0;
  for (int i = 0; i < n_popups; i++) {
    popups[i].timer -= dt; popups[i].y -= 50 * dt;
    if (popups[i].timer > 0) popups[w++] = popups[i];
  }
  n_popups = w;
  w = 0;
  for (int i = 0; i < n_newpops; i++) {
    newpops[i].timer -= dt; newpops[i].y -= 35 * dt;
    if (newpops[i].timer > 0) newpops[w++] = newpops[i];
  }
  n_newpops = w;
}

// ================================================================
//  描画：ゲームフィールド（論理座標 800x480）
// ================================================================
static void draw_background(void) {
  dr_rect_vgrad(0, 0, CANVAS_W, CANVAS_H, RGB(0x87CEEB), RGB(0xD0EEFF));
  float gt = GROUND_Y + PLAYER_H / 2 + 2;
  dr_rect(0, gt, CANVAS_W, CANVAS_H - gt, RGB(0xA0785A));
  dr_rect(0, gt, CANVAS_W, 8, RGB(0x4CAF50));
}

static void draw_falling(const Item *it) {
  bool hat = it->cat == CAT_HAT;
  int idx = item_idx(it->base, it->color);
  bool rare = it->rare, lucky = is_lucky(it->cat, idx);
  u32 hex = COLOR_HEX[it->color];
  dr_save();
  dr_translate(it->x, it->y);
  float a = dr_get_alpha();
  // カラーリング
  dr_set_alpha(a * 0.7f); dr_arc_stroke(0, 0, 21, 21, 0, 0, TAU_F, 3, hex); dr_set_alpha(a);
  // rare 金縁
  if (rare) {
    dr_arc_stroke(0, 0, 25, 25, 0, 0, TAU_F, 2, RGB(0xFFD700));
    dr_circle(0, 0, 25, RGBA(0xFFC800, 46));
  }
  // lucky 点線リング
  if (lucky) {
    dr_arc_dash(0, 0, 27, 2, 4, 3, RGB(0xFFFF00));
    const float dots[5][2] = { { -17, -6 }, { 17, -6 }, { 0, -22 }, { 13, 13 }, { -13, 13 } };
    for (int i = 0; i < 5; i++) dr_circle(dots[i][0], dots[i][1], 2.5f, RGB(0xFFFF00));
  }
  dr_save();
  if (hat) { dr_scale(0.9f, 0.9f); draw_hat_icon(it->base, hex); }
  else     { dr_scale(0.85f, 0.85f); draw_held_icon(it->base, hex); }
  dr_restore();
  u32 sc = rare ? RGB(0xFFD700) : (lucky ? RGB(0xFFFF66) : (hat ? RGB(0xAAFFAA) : RGB(0xAADDFF)));
  char pts[16];
  snprintf(pts, sizeof(pts), "+%d%s", calculate_score(it->cat, idx, rare), rare ? "★" : "");
  dr_text(pts, 0, 18, 11, sc, AL_CENTER, BL_TOP);
  dr_restore();
}

static void draw_chocolate(const Item *it, bool purple) {
  float s = CHOCO_SIZE, hs = s / 2;
  dr_rect(it->x - hs, it->y - hs, s, s, purple ? RGB(0x6A1CB7) : RGB(0x5C2A0E));
  dr_rect(it->x - hs + 2, it->y - hs + 2, s / 2 - 2, s / 2 - 2, purple ? RGB(0x9B40E0) : RGB(0x7B3E18));
  u32 lc = purple ? RGB(0x4A0E8F) : RGB(0x3B1505);
  dr_line(it->x, it->y - hs, it->x, it->y + hs, 1.5f, lc);
  dr_line(it->x - hs, it->y, it->x + hs, it->y, 1.5f, lc);
  if (purple) dr_text("2", it->x, it->y, 13, RGB(0xFFFFFF), AL_CENTER, BL_MIDDLE);
}

static void draw_dumbbell(const Item *it) {
  float br = DUMBBELL_BALL_R, bw = DUMBBELL_BAR_W, cx = it->x, cy = it->y;
  dr_rect(cx - bw / 2, cy - 3, bw, 6, RGB(0x999999));
  dr_circle(cx - bw / 2, cy, br, RGB(0x777777));
  dr_circle(cx - bw / 2 - 3, cy - 4, br * 0.35f, RGB(0xBBBBBB));
  dr_circle(cx + bw / 2, cy, br, RGB(0x777777));
  dr_circle(cx + bw / 2 - 3, cy - 4, br * 0.35f, RGB(0xBBBBBB));
}

// 稲妻マーク（Web版の ⚡ 絵文字の代わり）
static void draw_bolt(float x, float yb, u32 c) {
  dr_tri(x + 4, yb - 24, x - 7, yb - 10, x + 1, yb - 10, c);
  dr_tri(x - 1, yb - 12, x + 7, yb - 12, x - 4, yb, c);
}

static void draw_player_at(float x, float y, bool stun, bool visible) {
  if (!visible) return;
  bool girl = character_type == CHAR_GIRL;
  u32 skin = stun ? RGB(0xFFE033) : RGB(0xFFCC88);
  u32 body = stun ? RGB(0xFFD000) : (girl ? RGB(0xEE5599) : RGB(0x3355EE));
  u32 leg  = stun ? RGB(0xFFD000) : (girl ? RGB(0xCC4488) : RGB(0x1A2A88));
  dr_save();
  dr_translate(x, y);

  const float lw = 9, lh = 30, la = player.leg_angle;
  dr_save(); dr_translate(-10, 14); dr_rotate(la);
  dr_rect(-lw / 2, 0, lw, lh, leg); dr_rect(-lw / 2 - 3, lh - 7, lw + 8, 7, RGB(0x222222)); dr_restore();
  dr_save(); dr_translate(10, 14); dr_rotate(-la);
  dr_rect(-lw / 2, 0, lw, lh, leg); dr_rect(-lw / 2 - 3, lh - 7, lw + 8, 7, RGB(0x222222)); dr_restore();

  dr_save(); dr_translate(-20, -12); dr_rotate(-0.25f - la * 0.4f);
  dr_rect(-28, -4, 28, 8, body); dr_circle(-28, 0, 6, skin); dr_restore();
  dr_save(); dr_translate(20, -12); dr_rotate(0.25f + la * 0.4f);
  dr_rect(0, -4, 28, 8, body); dr_circle(28, 0, 6, skin); dr_restore();

  // 手持ちアイテム
  if (player.held_base >= 0) {
    dr_save(); dr_translate(46, -10); dr_scale(0.72f, 0.72f);
    draw_held_icon(player.held_base, COLOR_HEX[player.held_color]);
    dr_restore();
  }

  dr_rect(-18, -30, 36, 44, body);
  // 女の子スカート
  if (girl && !stun) {
    const float sk[] = { -20, 5, 20, 5, 27, 24, -27, 24 };
    dr_poly(sk, 4, RGB(0xFF88CC));
  }
  dr_line(0, -30, 0, 14, 2, stun ? RGB(0xAA6600) : (girl ? RGB(0xAA1155) : RGB(0x1133AA)));

  dr_rect(-7, -36, 14, 10, skin);
  // ツインテール（頭の後ろ側）
  if (!stun && girl) {
    dr_circle(-21, -55, 7, RGB(0x774422));
    dr_circle(21, -55, 7, RGB(0x774422));
  }
  const float hr = 20;
  dr_circle(0, -52, hr, skin);
  dr_arc_stroke(0, -52, hr, hr, 0, 0, TAU_F, 1.5f, stun ? RGB(0xCC8800) : RGB(0xD4A070));
  // 髪（頭の上部：y < -59 の部分）
  if (!stun) {
    float al = asinf(7.0f / hr);
    float a0 = PI_F + al, a1 = TAU_F - al;
    float pts[2 * 17];
    for (int i = 0; i <= 16; i++) {
      float t = a0 + (a1 - a0) * i / 16;
      pts[i * 2] = cosf(t) * hr; pts[i * 2 + 1] = -52 + sinf(t) * hr;
    }
    dr_poly(pts, 17, girl ? RGB(0x774422) : RGB(0x333333));
  }

  if (stun) {
    u32 r = RGB(0xFF3300);
    dr_line(-12, -58, -6, -52, 2.5f, r); dr_line(-6, -58, -12, -52, 2.5f, r);
    dr_line(6, -58, 12, -52, 2.5f, r);   dr_line(12, -58, 6, -52, 2.5f, r);
    draw_bolt(0, -74, RGB(0xFFE000));
  } else {
    dr_circle(-8, -55, 3, RGB(0x333333));
    dr_circle(8, -55, 3, RGB(0x333333));
    dr_arc_stroke(0, -47, 7, 7, 0, 0.1f, PI_F - 0.1f, 2, RGB(0x333333));
  }

  // 帽子
  if (player.hat_base >= 0) {
    dr_save(); dr_translate(0, -(52 + hr) - 8);
    if (player.has_crown) dr_scale(1.1f, 1.1f); // 王冠系は少し大きく
    draw_hat_icon(player.hat_base, COLOR_HEX[player.hat_color]);
    dr_restore();
  }
  dr_restore();
}

static void draw_popups(void) {
  float a = dr_get_alpha();
  for (int i = 0; i < n_popups; i++) {
    dr_set_alpha(popups[i].timer / POPUP_DURATION);
    dr_text(popups[i].text, popups[i].x, popups[i].y, 22, popups[i].color, AL_CENTER, BL_MIDDLE);
  }
  dr_set_alpha(a);
}

static void draw_new_popups(void) {
  for (int i = 0; i < n_newpops; i++) {
    NewPopup *p = &newpops[i];
    dr_save();
    dr_set_alpha(p->timer / NEW_POPUP_DURATION);
    dr_round_rect(p->x - 32, p->y - 14, 64, 28, 6, RGB(0xCC2200));
    dr_text("NEW!", p->x, p->y, 18, RGB(0xFFFF00), AL_CENTER, BL_MIDDLE);
    dr_restore();
  }
}

static void draw_special_popup(void) {
  if (special_popup_timer <= 0) return;
  float ratio = special_popup_timer / SPECIAL_POPUP_DUR;
  dr_save();
  dr_set_alpha(fminf(1, ratio * 2));
  bool rl = strstr(special_popup_text, "RARE LUCKY") != NULL, l = strstr(special_popup_text, "LUCKY") != NULL;
  u32 bg = rl ? RGB(0x775500) : (l ? RGB(0x554400) : RGB(0x440066));
  u32 tc = rl ? RGB(0xFFD700) : (l ? RGB(0xFFFF00) : RGB(0xCC88FF));
  dr_round_rect(CANVAS_W / 2 - 155, CANVAS_H / 2 + 52, 310, 52, 12, bg);
  dr_text(special_popup_text, CANVAS_W / 2, CANVAS_H / 2 + 78, 28, tc, AL_CENTER, BL_MIDDLE);
  dr_restore();
}

static void draw_full_complete_anim(void) {
  if (full_complete_timer <= 0) return;
  float ratio = full_complete_timer / (full_complete_is_first ? 2.5f : 0.8f);

  if (full_complete_is_first) {
    // 虹フラッシュ
    float rh = full_complete_rainbow_timer * 3;
    int r = (int)(sinf(rh) * 127 + 128), g = (int)(sinf(rh + 2) * 127 + 128), b = (int)(sinf(rh + 4) * 127 + 128);
    dr_save(); dr_set_alpha(0.25f);
    dr_rect(0, 0, CANVAS_W, CANVAS_H, RGB((r << 16) | (g << 8) | b));
    dr_restore();
    // パーティクル
    dr_save();
    for (int i = 0; i < n_parts; i++) {
      Particle *p = &parts[i];
      if (p->life <= 0) continue;
      dr_set_alpha(fminf(1, p->life * 1.5f));
      dr_circle(p->x, p->y, p->r, p->color);
    }
    dr_restore();
  }

  // テキスト
  dr_save();
  dr_set_alpha(fminf(1, ratio * 1.5f));
  float pulse = 1 + sinf(full_complete_rainbow_timer * 8) * 0.04f;
  dr_translate(CANVAS_W / 2, CANVAS_H / 2); dr_scale(pulse, pulse);
  if (full_complete_is_first) {
    dr_round_rect(-230, -55, 460, 110, 20, RGBA(0x000000, 178));
    dr_text("★ FULL COMPLETE! ★", 2, 2, 42, RGB(0xFF8800), AL_CENTER, BL_MIDDLE);
    dr_text("★ FULL COMPLETE! ★", 0, 0, 42, RGB(0xFFD700), AL_CENTER, BL_MIDDLE);
    dr_text("ぼうし90しゅ + もちもの90しゅ コンプリート！", 0, 38, 20, RGB(0xFFFFFF), AL_CENTER, BL_MIDDLE);
  } else {
    dr_round_rect(-200, -32, 400, 64, 16, RGBA(0x000000, 153));
    dr_text("☆ FULL COMPLETE! ☆", 0, 0, 28, RGB(0xFFD700), AL_CENTER, BL_MIDDLE);
  }
  dr_restore();
}

static void draw_world(void) {
  dr_reset();
  dr_scale(WORLD_SCALE, WORLD_SCALE);
  draw_background();
  for (int i = 0; i < n_items; i++) {
    const Item *it = &items[i];
    if (it->cat == CAT_BROWN) draw_chocolate(it, false);
    else if (it->cat == CAT_PURPLE) draw_chocolate(it, true);
    else if (it->cat == CAT_HAT || it->cat == CAT_HELD) draw_falling(it);
    else draw_dumbbell(it);
  }
  draw_player_at(player.x, player.y, player.stun_timer > 0, player.blink_visible);
  draw_popups();
  draw_new_popups();
  draw_special_popup();
  if (screen_flash_timer > 0) {
    dr_save(); dr_set_alpha((screen_flash_timer / 0.22f) * 0.40f);
    dr_rect(0, 0, CANVAS_W, CANVAS_H, screen_flash_color);
    dr_restore();
  }
  draw_full_complete_anim();
  dr_reset();
}

// ================================================================
//  描画：上画面（タイトル / ゲームオーバー / ずかん）
// ================================================================
static void draw_top_title(void) {
  dr_reset();
  dr_save(); dr_scale(WORLD_SCALE, WORLD_SCALE); draw_background(); dr_restore();
  dr_rect(0, 0, 400, 240, RGBA(0x000014, 158));
  char buf[128];

  // タイトル（チョコのアイコン付き）
  const char *title = "チョコキャッチ！";
  float tw = dr_text_width(title, 26);
  dr_text(title, 201, 27, 26, RGB(0x0088FF), AL_CENTER, BL_MIDDLE);
  dr_text(title, 200, 26, 26, RGB(0xFFFFFF), AL_CENTER, BL_MIDDLE);
  Item choco = { CAT_BROWN, 0, 0, false, 0, 0, 0 };
  dr_save(); dr_translate(200 - tw / 2 - 16, 26); dr_scale(0.6f, 0.6f);
  draw_chocolate(&choco, false); dr_restore();

  float y = 56, step = 15;
  dr_text("スライドパッド / じゅうじキー でいどう", 200, y, 11, RGB(0xEEEEEE), AL_CENTER, BL_MIDDLE); y += step;
  dr_text("ちゃチョコ +1てん", 200, y, 11, RGB(0xFFCC88), AL_CENTER, BL_MIDDLE); y += step;
  dr_text("むらさきチョコ +2てん", 200, y, 11, RGB(0xCC88FF), AL_CENTER, BL_MIDDLE); y += step;
  dr_text("ぼうし・もちもの +3てん（rare ★ は2ばい！）", 200, y, 11, RGB(0xAAFFAA), AL_CENTER, BL_MIDDLE); y += step;
  snprintf(buf, sizeof(buf), "！ てつアレイにあたると %.1f びょうスタン！", STUN_DURATION);
  dr_text(buf, 200, y, 11, RGB(0xFFAAAA), AL_CENTER, BL_MIDDLE); y += step;
  snprintf(buf, sizeof(buf), "せいげんじかん %d びょう！", (int)GAME_DURATION);
  dr_text(buf, 200, y, 11, RGB(0xFFDD44), AL_CENTER, BL_MIDDLE); y += step + 4;

  char ln[64]; item_name(ln, sizeof(ln), lucky_cat, lucky_idx);
  snprintf(buf, sizeof(buf), "★ Today's Lucky: %s （2ばいスコア！）", ln);
  dr_text(buf, 200, y, 12, RGB(0xFFFF88), AL_CENTER, BL_MIDDLE); y += 18;
  snprintf(buf, sizeof(buf), "さいこうスコア: %ld てん", (long)save.high_score);
  dr_text(buf, 200, y, 12, RGB(0x88CCFF), AL_CENTER, BL_MIDDLE);

  snprintf(buf, sizeof(buf), "ぼうし %d/90  もちもの %d/90  プレイ %ldかい%s",
           count_got(save.hats), count_got(save.held), (long)save.plays,
           save.full_complete_once ? " ★COMPLETE!" : "");
  dr_text(buf, 200, 208, 10, RGB(0xAAAAAA), AL_CENTER, BL_MIDDLE);
  dr_text("v3 - ぼうし90しゅ・もちもの90しゅ", 200, 225, 9, RGB(0x888888), AL_CENTER, BL_MIDDLE);
}

// 名前リストを幅に合わせて折り返して描く（最大 max_lines 行）
// 名前は最大8件なのでバッファは十分。snprintf の切り詰め警告は想定内のため止める
#pragma GCC diagnostic ignored "-Wformat-truncation"
static void draw_name_list(const char *prefix, int cat, const int *ids, int n,
                           float x, float y, float maxw, float px, float lh, int max_lines, u32 c) {
  char line[512], piece[96], name[64], tmp[512];
  snprintf(line, sizeof(line), "%s", prefix);
  if (n == 0) {
    snprintf(tmp, sizeof(tmp), "%sなし", prefix);
    dr_text(tmp, x, y, px, c, AL_LEFT, BL_MIDDLE);
    return;
  }
  int shown = n > 8 ? 8 : n, lines = 0;
  bool truncated = false;
  for (int i = 0; i < shown; i++) {
    item_name(name, sizeof(name), cat, ids[i]);
    bool last = (i == shown - 1);
    snprintf(piece, sizeof(piece), "%s%s", name, last ? (n > 8 ? "…" : "") : "、");
    snprintf(tmp, sizeof(tmp), "%s%s", line, piece);
    if (dr_text_width(tmp, px) > maxw && strcmp(line, prefix) != 0) {
      if (lines + 1 >= max_lines) { truncated = true; break; }
      dr_text(line, x, y + lines * lh, px, c, AL_LEFT, BL_MIDDLE);
      lines++;
      snprintf(line, sizeof(line), "　%s", piece);
    } else {
      snprintf(line, sizeof(line), "%s", tmp);
    }
  }
  if (truncated) {
    snprintf(tmp, sizeof(tmp), "%s…", line);
    dr_text(tmp, x, y + lines * lh, px, c, AL_LEFT, BL_MIDDLE);
  } else {
    dr_text(line, x, y + lines * lh, px, c, AL_LEFT, BL_MIDDLE);
  }
}

static void draw_top_gameover(void) {
  draw_world();
  dr_reset();
  dr_rect(0, 0, 400, 240, RGBA(0x000014, 204));
  char buf[96];
  dr_text("ゲームしゅうりょう！", 200, 18, 22, RGB(0xFFFFFF), AL_CENTER, BL_MIDDLE);
  snprintf(buf, sizeof(buf), "スコア: %d てん", score);
  dr_text(buf, 200, 44, 16, RGB(0xFFD700), AL_CENTER, BL_MIDDLE);
  snprintf(buf, sizeof(buf), "さいこうスコア: %ld てん", (long)save.high_score);
  dr_text(buf, 200, 62, 10, RGB(0x88CCFF), AL_CENTER, BL_MIDDLE);
  if (score > 0 && score >= save.high_score)
    dr_text("しんきろく！", 200, 76, 10, RGB(0xFF6600), AL_CENTER, BL_MIDDLE);

  // 取得内訳
  float px = 12, py = 86, pw = 376, ph = 148;
  dr_round_rect(px, py, pw, ph, 8, RGBA(0xFFFFFF, 18));
  dr_rect_stroke(px, py, pw, ph, 1, RGBA(0xFFFFFF, 46));
  dr_text("こんかいのしゅうしゅう", px + 8, py + 11, 10, RGB(0xFFEE88), AL_LEFT, BL_MIDDLE);
  draw_name_list("ぼうし: ", CAT_HAT, sess_hats, n_sess_hats, px + 8, py + 28, pw - 16, 9, 13, 2, RGB(0xAAFFAA));
  draw_name_list("もちもの: ", CAT_HELD, sess_held, n_sess_held, px + 8, py + 58, pw - 16, 9, 13, 2, RGB(0xAADDFF));

  snprintf(buf, sizeof(buf), "Hat: %d/90  Rare: %d/90", count_got(save.hats), count_rare(save.hats));
  dr_text(buf, px + 8, py + 98, 9, RGB(0xDDDDDD), AL_LEFT, BL_MIDDLE);
  snprintf(buf, sizeof(buf), "Held: %d/90  Rare: %d/90", count_got(save.held), count_rare(save.held));
  dr_text(buf, px + pw - 8, py + 98, 9, RGB(0xDDDDDD), AL_RIGHT, BL_MIDDLE);
  if (save.full_complete_once)
    dr_text("★ FULL COMPLETEたっせいずみ！", px + pw / 2, py + 124, 10, RGB(0xFFD700), AL_CENTER, BL_MIDDLE);
}

static void draw_top_collection(void) {
  dr_reset();
  dr_rect_vgrad(0, 0, 400, 240, RGB(0x0D0D2E), RGB(0x1A1A3E));
  char buf[96];
  bool hats = coll_tab == CAT_HAT;
  snprintf(buf, sizeof(buf), "ずかん：%s", hats ? "ぼうし" : "もちもの");
  dr_text(buf, 8, 11, 13, RGB(0xFFFFFF), AL_LEFT, BL_MIDDLE);
  snprintf(buf, sizeof(buf), "ページ %d / %d", coll_page + 1, COLL_PAGES);
  dr_text(buf, 392, 11, 11, RGB(0xAAAAAA), AL_RIGHT, BL_MIDDLE);
  snprintf(buf, sizeof(buf), "ぼうし %d/90 (★%d)  もちもの %d/90 (★%d)",
           count_got(save.hats), count_rare(save.hats), count_got(save.held), count_rare(save.held));
  dr_text(buf, 200, 27, 9, RGB(0xAAAAAA), AL_CENTER, BL_MIDDLE);

  const CollEntry *tbl = hats ? save.hats : save.held;
  int start = coll_page * COLL_PAGE_SIZE;
  for (int k = 0; k < COLL_PAGE_SIZE && start + k < NUM_IDS; k++) {
    int idx = start + k;
    int col = k % COLL_COLS, row = k / COLL_COLS;
    float cx = COLL_START_X + col * COLL_CELL_W + COLL_CELL_W / 2;
    float top = COLL_START_Y + row * COLL_CELL_H;
    const CollEntry *e = &tbl[idx];
    bool seen = e->normal + e->rare > 0;
    int base = idx_base(idx), cid = idx_color(idx);
    u32 hex = COLOR_HEX[cid];
    bool lucky = is_lucky(coll_tab, idx);

    // セル背景
    dr_round_rect(cx - COLL_CELL_W / 2 + 2, top + 2, COLL_CELL_W - 4, COLL_CELL_H - 4, 5,
                  seen ? RGBA(0xFFFFFF, 23) : RGBA(0x000000, 102));
    // カラーリング
    if (seen) {
      dr_save(); dr_set_alpha(0.7f);
      dr_arc_stroke(cx, top + 20, 14, 14, 0, 0, TAU_F, 1.5f, hex);
      dr_restore();
    }
    // アイコン
    dr_save(); dr_translate(cx, top + 20);
    if (!seen) dr_set_alpha(0.20f);
    if (hats) { dr_scale(0.42f, 0.42f); draw_hat_icon(base, seen ? hex : RGB(0x888888)); }
    else      { dr_scale(0.40f, 0.40f); draw_held_icon(base, seen ? hex : RGB(0x888888)); }
    dr_restore();

    // テキスト
    if (seen) {
      const char *bn = hats ? HAT_BASE_NAMES[base] : HELD_BASE_NAMES[base];
      char nm[64];
      utf8_trunc(nm, sizeof(nm), bn, 5);
      dr_text(COLOR_NAME[cid], cx, top + 39, 8, hex, AL_CENTER, BL_MIDDLE);
      dr_text(nm, cx, top + 49, 8, RGB(0xDDDDDD), AL_CENTER, BL_MIDDLE);
      snprintf(buf, sizeof(buf), "N:%lu R:%lu", (unsigned long)e->normal, (unsigned long)e->rare);
      dr_text(buf, cx, top + 58, 8, RGB(0xFFCC44), AL_CENTER, BL_MIDDLE);
    } else {
      dr_text("???", cx, top + 46, 10, RGB(0x444444), AL_CENTER, BL_MIDDLE);
    }
    // Rare 済みバッジ
    if (e->rare > 0) dr_text("★", cx + COLL_CELL_W / 2 - 9, top + 9, 8, RGB(0xFFD700), AL_CENTER, BL_MIDDLE);
    // Lucky 表示
    if (lucky) dr_text("L", cx - COLL_CELL_W / 2 + 9, top + 9, 8, RGB(0xFFFF44), AL_CENTER, BL_MIDDLE);
  }
}

static void draw_top(void) {
  switch (game_state) {
  case ST_TITLE:      draw_top_title(); break;
  case ST_PLAYING:    draw_world(); break;
  case ST_GAMEOVER:   draw_top_gameover(); break;
  case ST_COLLECTION: draw_top_collection(); break;
  }
}

// ================================================================
//  下画面（320x240）のボタン配置
// ================================================================
static const Rect BTN_SOUND     = { 232, 4, 84, 24 };
// タイトル
static const Rect BTN_GIRL      = { 20, 58, 135, 38 };
static const Rect BTN_BOY       = { 165, 58, 135, 38 };
static const Rect BTN_START     = { 25, 106, 270, 46 };
static const Rect BTN_COLL      = { 25, 160, 270, 40 };
// プレイ中
static const Rect BTN_LEFT      = { 8, 116, 148, 116 };
static const Rect BTN_RIGHT     = { 164, 116, 148, 116 };
// ゲームオーバー
static const Rect BTN_RETRY     = { 25, 70, 270, 48 };
static const Rect BTN_GO_COLL   = { 25, 130, 270, 44 };
// ずかん
static const Rect BTN_TAB_HAT   = { 8, 36, 148, 32 };
static const Rect BTN_TAB_HELD  = { 164, 36, 148, 32 };
static const Rect BTN_PREV      = { 30, 100, 120, 36 };
static const Rect BTN_NEXT      = { 170, 100, 120, 36 };
static const Rect BTN_BACK      = { 8, 190, 130, 40 };
static const Rect BTN_RESET     = { 182, 190, 130, 40 };
// リセット確認
static const Rect BTN_YES       = { 40, 140, 110, 38 };
static const Rect BTN_NO        = { 170, 140, 110, 38 };

static void draw_button(Rect r, u32 bg, const char *label, u32 fg, float px) {
  dr_round_rect(r.x, r.y, r.w, r.h, 8, bg);
  dr_text(label, r.x + r.w / 2, r.y + r.h / 2, px, fg, AL_CENTER, BL_MIDDLE);
}

static void draw_sound_button(void) {
  draw_button(BTN_SOUND, sound_on ? RGB(0x1A5C1A) : RGB(0x5C1A1A),
              sound_on ? "Sound: ON" : "Sound: OFF", RGB(0xFFFFFF), 11);
}

static void draw_bottom_title(void) {
  dr_text("メニュー", 8, 16, 12, RGB(0xAAAAAA), AL_LEFT, BL_MIDDLE);
  dr_text("キャラクターをえらんでね", 160, 46, 11, RGB(0xDDDDDD), AL_CENTER, BL_MIDDLE);
  bool g = character_type == CHAR_GIRL;
  draw_button(BTN_GIRL, g ? RGB(0xCC2266) : RGB(0x553344), "♀ おんなのこ", g ? RGB(0xFFFFFF) : RGB(0xAAAAAA), 13);
  draw_button(BTN_BOY, !g ? RGB(0x2244CC) : RGB(0x223366), "♂ おとこのこ", !g ? RGB(0xFFFFFF) : RGB(0xAAAAAA), 13);
  Rect s = g ? BTN_GIRL : BTN_BOY;
  dr_rect_stroke(s.x, s.y, s.w, s.h, 2.5f, RGB(0xFFFFFF));
  draw_button(BTN_START, RGB(0xFF5500), "スタート (A)", RGB(0xFFFFFF), 18);
  draw_button(BTN_COLL, RGB(0x225588), "ずかんをみる (X)", RGB(0x88CCFF), 15);
  dr_text("←→: キャラせんたく   SELECT: おと   START: おわる", 160, 220, 9, RGB(0x888888), AL_CENTER, BL_MIDDLE);
  draw_sound_button();
}

static void draw_move_button(Rect r, bool pressed, bool left) {
  dr_round_rect(r.x, r.y, r.w, r.h, 14, RGBA(0xFFFFFF, pressed ? 90 : 46));
  dr_rect_stroke(r.x + 2, r.y + 2, r.w - 4, r.h - 4, 2, RGBA(0xFFFFFF, 89));
  float cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  if (left) dr_tri(cx - 22, cy, cx + 16, cy - 24, cx + 16, cy + 24, RGB(0xFFFFFF));
  else      dr_tri(cx + 22, cy, cx - 16, cy - 24, cx - 16, cy + 24, RGB(0xFFFFFF));
}

static void draw_bottom_playing(void) {
  char buf[96];
  snprintf(buf, sizeof(buf), "スコア: %d", score);
  dr_text(buf, 10, 16, 20, RGB(0xFFD700), AL_LEFT, BL_MIDDLE);
  draw_sound_button();
  if (time_left > LAST_SECONDS || timer_blink_visible) {
    bool last = time_left <= LAST_SECONDS;
    u32 c = last ? RGB(0xFF2222) : (time_left <= 10 ? RGB(0xFF8844) : RGB(0xFFFFFF));
    snprintf(buf, sizeof(buf), "のこり %d びょう", (int)ceilf(time_left));
    dr_text(buf, 10, 46, last ? 24 : 18, c, AL_LEFT, BL_MIDDLE);
  }
  char ln[64]; item_name(ln, sizeof(ln), lucky_cat, lucky_idx);
  snprintf(buf, sizeof(buf), "★ Lucky: %s", ln);
  dr_text(buf, 10, 74, 11, RGB(0xFFFF88), AL_LEFT, BL_MIDDLE);
  if (player.stun_timer > 0) {
    snprintf(buf, sizeof(buf), "スタン: %.1f びょう", player.stun_timer);
    dr_text(buf, 160, 98, 15, RGB(0xFF6600), AL_CENTER, BL_MIDDLE);
  }
  draw_move_button(BTN_LEFT, touch_left, true);
  draw_move_button(BTN_RIGHT, touch_right, false);
}

static void draw_bottom_gameover(void) {
  char buf[64];
  snprintf(buf, sizeof(buf), "スコア: %d てん", score);
  dr_text(buf, 160, 40, 18, RGB(0xFFD700), AL_CENTER, BL_MIDDLE);
  draw_button(BTN_RETRY, RGB(0xFF5500), "もういちどあそぶ (A)", RGB(0xFFFFFF), 16);
  draw_button(BTN_GO_COLL, RGB(0x225588), "ずかんをみる (X)", RGB(0x88CCFF), 15);
  draw_sound_button();
}

static void draw_bottom_collection(void) {
  dr_text("ずかん", 8, 16, 13, RGB(0xFFFFFF), AL_LEFT, BL_MIDDLE);
  draw_sound_button();
  bool hats = coll_tab == CAT_HAT;
  draw_button(BTN_TAB_HAT, hats ? RGB(0x446688) : RGB(0x223344), "ぼうし（90しゅ）", hats ? RGB(0xFFFFFF) : RGB(0x888888), 12);
  draw_button(BTN_TAB_HELD, !hats ? RGB(0x446688) : RGB(0x223344), "もちもの（90しゅ）", !hats ? RGB(0xFFFFFF) : RGB(0x888888), 12);
  char buf[32];
  snprintf(buf, sizeof(buf), "ページ %d / %d", coll_page + 1, COLL_PAGES);
  dr_text(buf, 160, 86, 11, RGB(0xAAAAAA), AL_CENTER, BL_MIDDLE);
  bool can_prev = coll_page > 0, can_next = coll_page < COLL_PAGES - 1;
  draw_button(BTN_PREV, can_prev ? RGB(0x336699) : RGB(0x222244), "← Prev", can_prev ? RGB(0xFFFFFF) : RGB(0x555555), 13);
  draw_button(BTN_NEXT, can_next ? RGB(0x336699) : RGB(0x222244), "Next →", can_next ? RGB(0xFFFFFF) : RGB(0x555555), 13);
  dr_text("L / R: タブきりかえ   ←→: ページ", 160, 160, 9, RGB(0x888888), AL_CENTER, BL_MIDDLE);
  draw_button(BTN_BACK, RGB(0x445566), "もどる (B)", RGB(0xFFFFFF), 14);
  draw_button(BTN_RESET, RGB(0x663322), "リセット", RGB(0xFFAAAA), 14);

  if (confirm_reset) {
    dr_rect(0, 0, 320, 240, RGBA(0x000000, 170));
    dr_round_rect(20, 50, 280, 140, 12, RGB(0x2A2A4A));
    dr_text("ずかんデータをリセットしますか？", 160, 82, 13, RGB(0xFFFFFF), AL_CENTER, BL_MIDDLE);
    dr_text("（ベストスコアはほじされます）", 160, 106, 11, RGB(0xCCCCCC), AL_CENTER, BL_MIDDLE);
    draw_button(BTN_YES, RGB(0x993322), "はい", RGB(0xFFFFFF), 14);
    draw_button(BTN_NO, RGB(0x445566), "いいえ (B)", RGB(0xFFFFFF), 14);
  }
}

static void draw_bottom(void) {
  dr_reset();
  dr_rect_vgrad(0, 0, 320, 240, RGB(0x1A1A2E), RGB(0x10101E));
  switch (game_state) {
  case ST_TITLE:      draw_bottom_title(); break;
  case ST_PLAYING:    draw_bottom_playing(); break;
  case ST_GAMEOVER:   draw_bottom_gameover(); break;
  case ST_COLLECTION: draw_bottom_collection(); break;
  }
}

// ================================================================
//  入力処理
// ================================================================
static void open_collection(void) { coll_page = 0; confirm_reset = false; game_state = ST_COLLECTION; }

static void collection_page_move(int d) {
  int np = coll_page + d;
  if (np >= 0 && np < COLL_PAGES) coll_page = np;
}

static void do_reset_collection(void) {
  save_reset_collection();
  confirm_reset = false;
}

// タップ（タッチした瞬間）
static void handle_tap(float mx, float my) {
  if (confirm_reset) {
    if (in_rect(mx, my, BTN_YES)) do_reset_collection();
    else if (in_rect(mx, my, BTN_NO)) confirm_reset = false;
    return;
  }
  if (in_rect(mx, my, BTN_SOUND)) { toggle_sound(); return; }

  if (game_state == ST_TITLE) {
    if (in_rect(mx, my, BTN_GIRL)) { character_type = CHAR_GIRL; return; }
    if (in_rect(mx, my, BTN_BOY))  { character_type = CHAR_BOY; return; }
    if (in_rect(mx, my, BTN_COLL)) { open_collection(); return; }
    try_start(); // Web版と同じく、それ以外の場所でもスタート
    return;
  }
  if (game_state == ST_GAMEOVER) {
    if (in_rect(mx, my, BTN_RETRY))   { try_start(); return; }
    if (in_rect(mx, my, BTN_GO_COLL)) { open_collection(); return; }
    return;
  }
  if (game_state == ST_COLLECTION) {
    if (in_rect(mx, my, BTN_TAB_HAT))  { coll_tab = CAT_HAT;  coll_page = 0; return; }
    if (in_rect(mx, my, BTN_TAB_HELD)) { coll_tab = CAT_HELD; coll_page = 0; return; }
    if (in_rect(mx, my, BTN_PREV))     { collection_page_move(-1); return; }
    if (in_rect(mx, my, BTN_NEXT))     { collection_page_move(1); return; }
    if (in_rect(mx, my, BTN_BACK))     { game_state = ST_TITLE; return; }
    if (in_rect(mx, my, BTN_RESET))    { confirm_reset = true; return; }
  }
}

// ボタン入力。false を返したらアプリ終了
static bool handle_keys(u32 kDown) {
  if (kDown & KEY_SELECT) toggle_sound();

  if (confirm_reset) {
    if (kDown & KEY_B) confirm_reset = false;
    return true;
  }
  switch (game_state) {
  case ST_TITLE:
    if (kDown & KEY_START) return false;
    if (kDown & KEY_LEFT)  character_type = CHAR_GIRL;
    if (kDown & KEY_RIGHT) character_type = CHAR_BOY;
    if (kDown & KEY_A) try_start();
    else if (kDown & KEY_X) open_collection();
    break;
  case ST_GAMEOVER:
    if (kDown & (KEY_A | KEY_START)) try_start();
    else if (kDown & KEY_X) open_collection();
    break;
  case ST_COLLECTION:
    if (kDown & KEY_B) { game_state = ST_TITLE; break; }
    if (kDown & KEY_L) { coll_tab = CAT_HAT;  coll_page = 0; }
    if (kDown & KEY_R) { coll_tab = CAT_HELD; coll_page = 0; }
    if (kDown & KEY_LEFT)  collection_page_move(-1);
    if (kDown & KEY_RIGHT) collection_page_move(1);
    break;
  }
  return true;
}

// ================================================================
//  メイン
// ================================================================
int main(void) {
  gfxInitDefault();
  C3D_Init(C3D_DEFAULT_CMDBUF_SIZE);
  C2D_Init(12000);
  C2D_Prepare();
  C3D_RenderTarget *top = C2D_CreateScreenTarget(GFX_TOP, GFX_LEFT);
  C3D_RenderTarget *bot = C2D_CreateScreenTarget(GFX_BOTTOM, GFX_LEFT);

  dr_init();
  audio_init();
  save_load();
  select_lucky();
  rng_state = (u32)osGetTime() | 1u;
  player.x = CANVAS_W / 2; player.y = GROUND_Y;
  player.hat_base = player.held_base = -1;
  player.blink_visible = true; player.leg_swing_dir = 1;

  u64 last = osGetTime();
  bool running = true;
  while (running && aptMainLoop()) {
    hidScanInput();
    u32 kDown = hidKeysDown(), kHeld = hidKeysHeld();

    u64 now = osGetTime();
    float dt = (now - last) / 1000.0f;
    last = now;
    if (dt > 0.05f) dt = 0.05f;

    audio_update();

    // タッチ
    touch_left = touch_right = false;
    if (kHeld & KEY_TOUCH) {
      touchPosition tp;
      hidTouchRead(&tp);
      if (game_state == ST_PLAYING) {
        touch_left  = in_rect(tp.px, tp.py, BTN_LEFT);
        touch_right = in_rect(tp.px, tp.py, BTN_RIGHT);
      }
      if (kDown & KEY_TOUCH) handle_tap(tp.px, tp.py);
    }
    if (!handle_keys(kDown)) running = false;

    update(dt, kHeld);
    schedule_bgm();

    C3D_FrameBegin(C3D_FRAME_SYNCDRAW);
    dr_frame_begin();
    C2D_TargetClear(top, C2D_Color32(0, 0, 0, 255));
    C2D_SceneBegin(top);
    draw_top();
    C2D_TargetClear(bot, C2D_Color32(0, 0, 0, 255));
    C2D_SceneBegin(bot);
    draw_bottom();
    C3D_FrameEnd(0);
  }

  save_write();
  audio_exit();
  dr_exit();
  C2D_Fini();
  C3D_Fini();
  gfxExit();
  return 0;
}
