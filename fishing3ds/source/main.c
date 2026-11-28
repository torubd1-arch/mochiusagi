// ================================================================
//  わくわくフィッシング3DS（Waku Waku Fishing）
//  初代 Nintendo 3DS / Homebrew Launcher 用（devkitARM + libctru + citro2d）
//
//  ・ゲームロジックは game.c（3DS 非依存・PC で自動テスト可能）
//  ・このファイルは入力の取得、描画、効果音、エフェクトを担当する
//
//  上画面 (400x240): 湖のゲーム画面
//  下画面 (320x240): 操作案内・状態・反応ゲージ・釣果・タッチボタン
// ================================================================
#include <3ds.h>
#include <citro2d.h>
#include <stdio.h>
#include <string.h>
#include <math.h>
#include "game.h"
#include "draw.h"
#include "art.h"
#include "audio.h"
#include "save.h"
#include <sys/stat.h>

#define PI_F  3.14159265f
#define TAU_F 6.28318531f
#define RGB(h)     ((((u32)(h)) << 8) | 0xFFu)
#define RGBA(h, a) ((((u32)(h)) << 8) | ((u32)(a) & 0xFFu))

#define STICK_DEADZONE 18
#define STICK_FULL     140.0f

static Game G;

// ---- セーブ（記録が変わったときだけ SD カードに書く） ----
static uint8_t save_last[SAVE_SIZE];   // 最後に書いた（読んだ）内容
static bool    save_failed = false;    // 書き込みに失敗した（SD カードの書き込み禁止など）

static void save_load(void) {
  mkdir(SAVE_DIR, 0777);               // 既にあれば何もしない
  save_read(SAVE_PATH, &G);            // 無い・壊れているときは空のまま始める
  save_encode(&G, save_last);
}
static void save_if_changed(void) {
  uint8_t now[SAVE_SIZE];
  save_encode(&G, now);
  if (memcmp(now, save_last, SAVE_SIZE) == 0) return;
  save_failed = !save_write(SAVE_PATH, &G);
  memcpy(save_last, now, SAVE_SIZE);   // 失敗しても毎フレーム書き直さない（次の変化で再挑戦）
}

// ================================================================
//  エフェクト（描画専用。ゲーム結果には影響しない）
// ================================================================
#define MAX_RIPPLES 20
#define MAX_DROPS   72

typedef struct { bool on; float x, y, t, life, maxr; } Ripple;
typedef struct { bool on; float x, y, vx, vy, t, life, r; u32 c; } Drop;

static Ripple ripples[MAX_RIPPLES];
static Drop   drops[MAX_DROPS];
static int    ripple_next = 0, drop_next = 0;
static float  hit_ripple_t = 0, flash_t = 0, reel_tick_t = 0;
static u32    fx_rng = 0x9E3779B9u;

static float frand(void) {
  fx_rng ^= fx_rng << 13; fx_rng ^= fx_rng >> 17; fx_rng ^= fx_rng << 5;
  return (fx_rng >> 8) * (1.0f / 16777216.0f);
}

static void add_ripple(float x, float y, float maxr, float life) {
  Ripple *r = &ripples[ripple_next];
  ripple_next = (ripple_next + 1) % MAX_RIPPLES;
  r->on = true; r->x = x; r->y = y; r->t = 0; r->life = life; r->maxr = maxr;
}

static void add_splash(float x, float y, int n, float power) {
  for (int i = 0; i < n; i++) {
    Drop *d = &drops[drop_next];
    drop_next = (drop_next + 1) % MAX_DROPS;
    d->on = true; d->x = x; d->y = y;
    d->vx = (frand() - 0.5f) * 90.0f * power;
    d->vy = -(50.0f + frand() * 100.0f) * power;
    d->t = 0; d->life = 0.35f + frand() * 0.3f;
    d->r = 1.0f + frand() * 1.3f;
    d->c = (frand() < 0.5f) ? RGB(0xFFFFFF) : RGB(0xBFE9FF);
  }
}

static void update_fx(float dt) {
  for (int i = 0; i < MAX_RIPPLES; i++) {
    Ripple *r = &ripples[i];
    if (!r->on) continue;
    r->t += dt;
    if (r->t >= r->life) r->on = false;
  }
  for (int i = 0; i < MAX_DROPS; i++) {
    Drop *d = &drops[i];
    if (!d->on) continue;
    d->t += dt;
    d->vy += 320.0f * dt;
    d->x += d->vx * dt; d->y += d->vy * dt;
    if (d->t >= d->life) d->on = false;
  }
  if (flash_t > 0) flash_t -= dt;
}

static void clear_fx(void) {
  memset(ripples, 0, sizeof(ripples));
  memset(drops, 0, sizeof(drops));
  flash_t = 0;
}

// ================================================================
//  効果音（ndsp。dspfirm.cdc が無い環境では無音で動く）
// ================================================================
static void tone(int wave, double at, double dur, float f0, float f1, float vol) {
  audio_voice(BUS_SE, wave, audio_now() + at, dur, f0, f1, vol, dur);
}
static void se_cast(void)   { tone(WAVE_TRIANGLE, 0, 0.20, 1100, 260, 0.45f); }
static void se_splash(void) { tone(WAVE_SQUARE, 0, 0.10, 220, 60, 0.22f); tone(WAVE_TRIANGLE, 0.01, 0.16, 700, 180, 0.35f); }
static void se_bite(void)   { tone(WAVE_SQUARE, 0, 0.07, 880, 880, 0.28f); tone(WAVE_SQUARE, 0.08, 0.10, 1320, 1320, 0.28f); }
static void se_miss(void)   { tone(WAVE_TRIANGLE, 0, 0.32, 420, 160, 0.40f); }
static void se_menu(void)   { tone(WAVE_SQUARE, 0, 0.04, 990, 990, 0.15f); }
static void se_reel(void)   { tone(WAVE_TRIANGLE, 0, 0.12, 400, 900, 0.30f); }
static void se_start(void)  { tone(WAVE_SQUARE, 0, 0.08, 784, 784, 0.22f); tone(WAVE_SQUARE, 0.09, 0.14, 1047, 1047, 0.22f); }
static void se_catch(void) {
  const float n[4] = { 523.3f, 659.3f, 784.0f, 1046.5f };
  for (int i = 0; i < 4; i++) tone(WAVE_SQUARE, i * 0.07, i == 3 ? 0.25 : 0.08, n[i], n[i], 0.22f);
}
static void se_gold(void) {
  const float n[8] = { 523.3f, 659.3f, 784.0f, 1046.5f, 784.0f, 1046.5f, 1318.5f, 1568.0f };
  for (int i = 0; i < 8; i++) tone(WAVE_SQUARE, i * 0.075, i == 7 ? 0.5 : 0.09, n[i], n[i], 0.22f);
  for (int i = 0; i < 6; i++) tone(WAVE_TRIANGLE, 0.62 + i * 0.06, 0.10, 2093.0f + i * 200, 2093.0f + i * 200, 0.18f);
}
static void se_hook(void)   { tone(WAVE_SQUARE, 0, 0.06, 660, 990, 0.26f); tone(WAVE_TRIANGLE, 0.05, 0.12, 1320, 1320, 0.3f); }
static void se_warn(void)   { tone(WAVE_SQUARE, 0, 0.05, 1568, 1568, 0.22f); tone(WAVE_SQUARE, 0.08, 0.05, 1568, 1568, 0.22f); }
static void se_thrash(void) { tone(WAVE_SQUARE, 0, 0.18, 160, 90, 0.30f); tone(WAVE_TRIANGLE, 0, 0.2, 500, 150, 0.3f); }
static void se_break(void)  { tone(WAVE_SQUARE, 0, 0.08, 1800, 200, 0.30f); tone(WAVE_TRIANGLE, 0.06, 0.3, 300, 120, 0.35f); }
static void se_tick(float pitch) { tone(WAVE_SQUARE, 0, 0.025, pitch, pitch, 0.10f); }
static void se_timeup(void) {
  const float n[4] = { 784.0f, 659.3f, 523.3f, 392.0f };
  for (int i = 0; i < 4; i++) tone(WAVE_SQUARE, i * 0.13, i == 3 ? 0.4 : 0.12, n[i], n[i], 0.22f);
}

// ゲームで起きたイベントから効果音とエフェクトを出す
static void handle_events(u32 ev) {
  if (ev & EV_START) { se_start(); clear_fx(); }
  if (ev & EV_CAST) se_cast();
  if (ev & EV_SPLASH) {
    // ウキの位置（やりとり中・釣り上げ時は魚の位置）にしぶきを出す
    float power = (ev & EV_CATCH) ? 1.4f : (ev & (EV_BITE | EV_THRASH)) ? 1.1f : 0.8f;
    add_splash(G.bob_x, G.bob_y, (ev & (EV_CATCH | EV_THRASH)) ? 22 : 12, power);
    add_ripple(G.bob_x, G.bob_y, 26, 0.9f);
    if (!(ev & (EV_CATCH | EV_BITE | EV_THRASH))) se_splash();
  }
  if (ev & EV_BITE) se_bite();
  if (ev & EV_FEINT) {
    add_splash(G.bob_x, G.bob_y, 8, 0.8f);
    add_ripple(G.bob_x, G.bob_y, 20, 0.7f);
    se_splash();
  }
  if (ev & EV_HOOK) se_hook();
  if (ev & EV_RUSH) se_warn();
  if (ev & EV_THRASH) se_thrash();
  if (ev & EV_BREAK) se_break();
  if (ev & EV_GOLD) { se_gold(); flash_t = 0.35f; }
  else if (ev & EV_CATCH) se_catch();
  if ((ev & EV_MISS) && !(ev & EV_BREAK)) se_miss();
  if (ev & EV_REEL) se_reel();
  if (ev & EV_TIMEUP) se_timeup();
  if ((ev & EV_MENU) && !(ev & EV_START)) se_menu();
}

// ================================================================
//  共通描画ヘルパー
// ================================================================
typedef struct { float x, y, w, h; } Rect;

static const Rect BTN_START   = { 80, 154, 160, 40 };
static const Rect BTN_PLAYER[PLAYER_COUNT] = { { 28, 50, 124, 96 }, { 168, 50, 124, 96 } };
static const Rect BTN_PAUSE   = { 246, 208, 70, 28 };
static const Rect BTN_RETRY   = { 14, 196, 140, 38 };
static const Rect BTN_TITLE   = { 166, 196, 140, 38 };
static const Rect BTN_MENU[3] = { { 50, 48, 220, 44 }, { 50, 102, 220, 44 }, { 50, 156, 220, 44 } };

static bool in_rect(int x, int y, Rect r) { return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h; }

static u32 lerp_col(u32 a, u32 b, float t) {
  if (t < 0) t = 0;
  if (t > 1) t = 1;
  int r = (int)(((a >> 24) & 0xFF) + ((int)((b >> 24) & 0xFF) - (int)((a >> 24) & 0xFF)) * t);
  int g = (int)(((a >> 16) & 0xFF) + ((int)((b >> 16) & 0xFF) - (int)((a >> 16) & 0xFF)) * t);
  int bl = (int)(((a >> 8) & 0xFF) + ((int)((b >> 8) & 0xFF) - (int)((a >> 8) & 0xFF)) * t);
  return ((u32)r << 24) | ((u32)g << 16) | ((u32)bl << 8) | 0xFF;
}

// 縁取り付きの文字（大きく読みやすくするため）
static void text_outline(const char *s, float x, float y, float px, u32 c, u32 oc, int align, int base) {
  float o = px > 24 ? 2.0f : 1.0f;
  const float dx[8] = { -1, 0, 1, -1, 1, -1, 0, 1 }, dy[8] = { -1, -1, -1, 0, 0, 1, 1, 1 };
  for (int i = 0; i < 8; i++) dr_text(s, x + dx[i] * o, y + dy[i] * o, px, oc, align, base);
  dr_text(s, x, y, px, c, align, base);
}

static void draw_button(Rect r, const char *label, u32 col, bool hl, float px) {
  dr_round_rect(r.x, r.y + 3, r.w, r.h, 8, shade(col, -70));
  dr_round_rect(r.x, r.y, r.w, r.h, 8, hl ? shade(col, 30) : col);
  if (hl) dr_rect_stroke(r.x + 2, r.y + 2, r.w - 4, r.h - 4, 2, RGB(0xFFF3A0));
  dr_round_rect(r.x + 4, r.y + 3, r.w - 8, r.h * 0.35f, 6, RGBA(0xFFFFFF, 0x40));
  text_outline(label, r.x + r.w / 2, r.y + r.h / 2, px, RGB(0xFFFFFF), shade(col, -90), AL_CENTER, BL_MIDDLE);
}

// 一時停止中は止める前の状態で絵を描く
static GameState vis_state(void) { return G.state == ST_PAUSE ? G.paused_from : G.state; }

// ================================================================
//  上画面：背景
// ================================================================
#define WATER_TOP_COL RGB(0x52B6DC)
#define WATER_BOT_COL RGB(0x1C6AA4)

static u32 water_at(float y) { return lerp_col(WATER_TOP_COL, WATER_BOT_COL, (y - LAKE_TOP) / (240.0f - LAKE_TOP)); }

static void draw_cloud(float x, float y, float s) {
  u32 c = RGBA(0xFFFFFF, 0xE6);
  dr_circle(x, y, 7 * s, c);
  dr_circle(x + 8 * s, y - 3 * s, 9 * s, c);
  dr_circle(x + 18 * s, y, 7 * s, c);
  dr_rect(x, y, 18 * s, 6 * s, c);
}

static void draw_background(void) {
  float t = G.anim_t;
  // 空
  dr_rect_vgrad(0, 0, 400, LAKE_TOP, RGB(0x6EC3F2), RGB(0xD2EEFB));
  dr_circle(250, 22, 16, RGBA(0xFFF6B0, 0x70));
  dr_circle(250, 22, 11, RGB(0xFFE45C));
  for (int i = 0; i < 3; i++) {
    float x = fmodf(t * (4.0f + i * 2) + i * 150.0f, 460.0f) - 40.0f;
    draw_cloud(x, 14 + i * 9, 0.8f + 0.15f * i);
  }
  // 山
  dr_tri(-20, 62, 70, 22, 160, 62, RGB(0x7E9CC0));
  dr_tri(240, 62, 330, 26, 420, 62, RGB(0x7E9CC0));
  dr_tri(100, 62, 200, 12, 300, 62, RGB(0x6584AC));
  dr_tri(184, 21, 200, 12, 216, 21, RGB(0xF4F8FF));
  dr_tri(60, 28, 70, 22, 80, 28, RGB(0xF4F8FF));
  // 向こう岸と木
  dr_rect(0, 54, 400, 12, RGB(0x5DA548));
  for (int i = 0; i < 22; i++) {
    float x = i * 19.0f + ((i * 7) % 5) * 2.0f;
    float h = 12 + (i * 5 % 4) * 2.0f;
    u32 c = (i & 1) ? RGB(0x2F6B33) : RGB(0x3B7F3A);
    dr_rect(x - 1, 60, 2, 4, RGB(0x6B4A2A));
    dr_tri(x, 60 - h, x - 7, 61, x + 7, 61, c);
    dr_tri(x, 60 - h - 4, x - 5, 56 - h * 0.4f, x + 5, 56 - h * 0.4f, c);
  }
  // 湖
  dr_rect_vgrad(0, LAKE_TOP, 400, 240 - LAKE_TOP, WATER_TOP_COL, WATER_BOT_COL);
  dr_rect(0, LAKE_TOP, 400, 2, RGBA(0xE6F7FF, 0xA0));
  // 木の映り込み
  dr_rect(0, LAKE_TOP + 2, 400, 6, RGBA(0x2F6B33, 0x30));
  // 水面のきらめき
  for (int j = 0; j < 16; j++) {
    float y = 72 + j * 10.5f;
    float sp = 6.0f + (j % 3) * 4.0f;
    float x = fmodf(j * 53.0f + t * sp, 440.0f) - 20.0f;
    float w = 10 + (j % 4) * 6.0f;
    dr_rect(x, y, w, 1, RGBA(0xFFFFFF, 0x50));
    dr_rect(fmodf(x + 190.0f, 440.0f) - 20.0f, y + 4, w * 0.6f, 1, RGBA(0xFFFFFF, 0x38));
  }
}

// ================================================================
//  上画面：魚影
// ================================================================
static void draw_shadow(const Fish *f) {
  if (f->state == FS_NONE || f->alpha <= 0.01f) return;
  // 奥（上）ほど少し小さく見せる
  float persp = 0.92f + (f->y - LANE_Y0) / (LANE_STEP * 4) * 0.16f;
  bool jerk = f->state == FS_BITE || (f->state == FS_WAIT && game_feint_active(&G));
  float shake = jerk ? sinf(G.anim_t * 55.0f) * 1.3f : 0;
  float shake_y = 0, tilt = 0;
  if (f->state == FS_FIGHT) {
    // やりとり中：ふだんは左右に身をよじり、予兆で小刻みに震え、暴れると大きく跳ねる
    if (G.rush_phase == RUSH_ON) {
      shake = sinf(G.anim_t * 38.0f) * 4.0f; shake_y = sinf(G.anim_t * 23.0f) * 3.0f;
      tilt = sinf(G.anim_t * 17.0f) * 0.5f;
    } else if (G.rush_phase == RUSH_WARN) {
      shake = sinf(G.anim_t * 70.0f) * 1.5f; tilt = sinf(G.anim_t * 40.0f) * 0.15f;
    } else {
      shake = sinf(G.anim_t * 9.0f) * 2.0f; tilt = sinf(G.anim_t * 6.0f) * 0.2f;
    }
  }
  float L = f->len, rx = L * 0.5f, ry = L * (f->size == SZ_LARGE ? 0.25f : 0.22f);
  // 水の色と混ぜた不透明色で描く（重なりで濃くならないように）
  float dark = (f->state == FS_FIGHT) ? 0.75f : 0.62f;   // やりとり中は水面近くで濃く見える
  u32 c = lerp_col(water_at(f->y), RGB(0x0A2140), dark * f->alpha);
  dr_save();
  dr_translate(f->x + shake, f->y + shake_y);
  dr_rotate(tilt);
  dr_scale(f->dir * persp, persp);
  dr_save();
  dr_translate(-rx * 0.8f, 0);
  dr_rotate(sinf(f->tail) * 0.45f);
  dr_tri(3, 0, -L * 0.3f, -L * 0.18f, -L * 0.3f, L * 0.18f, c);
  dr_restore();
  float fw = sinf(f->tail * 1.3f) * 0.3f;
  dr_ellipse(rx * 0.12f, ry * 0.85f, L * 0.13f, L * 0.05f, 0.5f + fw, 0, TAU_F, c);
  dr_ellipse(rx * 0.12f, -ry * 0.85f, L * 0.13f, L * 0.05f, -0.5f - fw, 0, TAU_F, c);
  dr_ellipse(0, 0, rx, ry, 0, 0, TAU_F, c);
  dr_ellipse(rx * 0.55f, 0, rx * 0.5f, ry * 0.92f, 0, 0, TAU_F, c);   // 頭を少し丸く
  dr_restore();
}

// ================================================================
//  上画面：桟橋・釣り人・釣りざお・ウキ
// ================================================================
#define HAND_X  44.0f
#define HAND_Y  204.0f
#define ROD_LEN 50.0f

static float rod_angle(void) {
  const float IDLE = -0.87f;
  switch (vis_state()) {
    case ST_CASTING: {
      float t = G.state_t / CAST_TIME;
      if (t > 1) t = 1;
      if (t < 0.35f) return IDLE + (-1.95f - IDLE) * (t / 0.35f);       // 振りかぶる
      float k = (t - 0.35f) / 0.65f;
      k = 1 - (1 - k) * (1 - k);
      return -1.95f + (-0.5f + 1.95f) * k;                                 // 振り下ろす
    }
    case ST_FISH_APPROACH: case ST_WAIT_BITE:
      return -0.55f;
    case ST_MISSED:
      // 糸が切れたときは反動で竿がはね上がる
      if (G.miss_reason == MISS_LINE_BREAK) return -1.25f + fminf(G.state_t / 0.4f, 1.0f) * 0.35f;
      return -0.55f;
    case ST_FIGHT: {
      // テンションが高いほど竿が大きくしなる
      float a = -1.0f + G.tension * 0.65f;
      if (G.rush_phase == RUSH_ON) a += sinf(G.anim_t * 35.0f) * 0.08f;
      return a;
    }
    case ST_HIT_WINDOW:
      return -0.42f + sinf(G.anim_t * 40.0f) * 0.05f;   // 引かれてしなる
    case ST_CAUGHT:
      return -1.3f;
    default:
      return IDLE;
  }
}

static void rod_tip(float *x, float *y) {
  float a = rod_angle();
  *x = HAND_X + cosf(a) * ROD_LEN;
  *y = HAND_Y + sinf(a) * ROD_LEN;
}

static void draw_pier(void) {
  // 杭
  dr_rect(6, 214, 5, 26, RGB(0x4A2E14));
  dr_rect(70, 212, 5, 28, RGB(0x4A2E14));
  dr_rect(70, 230, 5, 4, RGBA(0xFFFFFF, 0x50));
  // 板
  const float deck[8] = { 0, 212, 74, 212, 86, 240, 0, 240 };
  dr_poly(deck, 4, RGB(0x9C6A3A));
  for (int i = 0; i < 4; i++) {
    float y = 218 + i * 6.5f;
    dr_line(0, y, 74 + (y - 212) * 0.43f, y, 1, RGB(0x6E4622));
  }
  dr_line(74, 212, 86, 240, 1.5f, RGB(0x5A3818));
  dr_line(0, 212, 74, 212, 1.5f, RGB(0xC08A52));
}

static void draw_angler(void) {
  float bob = sinf(G.anim_t * 2.0f) * 0.4f;
  // 足
  dr_rect(26, 216, 5, 14, RGB(0x2E4A8A));
  dr_rect(33, 216, 5, 14, RGB(0x2E4A8A));
  dr_rect(25, 228, 7, 3, RGB(0x3A2A1A));
  dr_rect(32, 228, 7, 3, RGB(0x3A2A1A));
  // 体
  dr_round_rect(23, 196 + bob, 18, 22, 4, RGB(0xE5533D));
  dr_rect(23, 206 + bob, 18, 3, RGB(0xF2F2F2));
  // 腕
  dr_line(38, 200 + bob, HAND_X, HAND_Y, 4, RGB(0xE5533D));
  dr_circle(HAND_X, HAND_Y, 2.5f, RGB(0xF5C99B));
  // 頭と麦わら帽子
  dr_circle(32, 189 + bob, 6.5f, RGB(0xF5C99B));
  dr_circle(35, 189 + bob, 1.0f, RGB(0x222222));
  dr_ellipse(32, 184 + bob, 12, 3.2f, 0, 0, TAU_F, RGB(0xE8C060));
  dr_ellipse(32, 182 + bob, 6.5f, 4.5f, 0, PI_F, TAU_F, RGB(0xF2D27A));
  dr_rect(25.5f, 182 + bob, 13, 1.6f, RGB(0xC0392B));
}

static void draw_rod(float tx, float ty) {
  float mx = (HAND_X + tx) / 2, my = (HAND_Y + ty) / 2;
  dr_line(HAND_X, HAND_Y, mx, my, 2.4f, RGB(0x3A2A1A));
  dr_line(mx, my, tx, ty, 1.4f, RGB(0x5A4632));
  dr_circle(HAND_X - 2, HAND_Y + 2, 2.2f, RGB(0x222222));   // リール
}

static void draw_bobber(float x, float y, int mode) {
  // mode 0=空中, 1=浮いている, 2=沈んでいる
  if (mode == 2) {
    dr_ellipse(x, y + 1, 5, 1.8f, 0, 0, TAU_F, RGBA(0x0A2140, 0x60));
    dr_circle(x, y + 1, 2.2f, RGBA(0xE53935, 0xA0));
    return;
  }
  if (mode == 1) dr_ellipse(x, y + 2.5f, 6.5f, 2.0f, 0, 0, TAU_F, RGBA(0xFFFFFF, 0x50));
  dr_ellipse(x, y, 4, 4, 0, 0, PI_F, RGB(0xFFFFFF));
  dr_ellipse(x, y, 4, 4, 0, PI_F, TAU_F, RGB(0xE53935));
  dr_line(x, y - 4, x, y - 9, 1.2f, RGB(0x333333));
  dr_circle(x, y - 9.5f, 1.4f, RGB(0xFFD54F));
}

static void draw_line_and_bobber(void) {
  GameState vs = vis_state();
  float tx, ty;
  rod_tip(&tx, &ty);
  if (vs == ST_FIGHT) {
    // ぴんと張った糸（テンションが高いほどまっすぐ・危険域で赤く）
    float bx = G.bob_x, by = G.bob_y;
    float sag = (1.0f - G.tension) * 14.0f;
    float qx = (tx + bx) / 2, qy = (ty + by) / 2 + sag;
    u32 lc = G.tension >= TENSION_DANGER_ZONE ? RGB(0xFF5A4E) : RGBA(0xFFFFFF, 0xD0);
    float lw = G.tension >= TENSION_DANGER_ZONE ? 1.6f : 1.0f;
    dr_quad_stroke(tx, ty, qx, qy, bx, by, lw, lc);
    return;
  }
  if (vs == ST_MISSED && G.miss_reason == MISS_LINE_BREAK) {
    // 切れた糸が竿先から垂れ下がる
    float k = fminf(G.state_t / 0.5f, 1.0f);
    dr_quad_stroke(tx, ty, tx + 10 - k * 6, ty + 8, tx + 4, ty + 6 + k * 16, 1.0f, RGBA(0xFFFFFF, 0xC0));
    return;
  }
  if (G.bobber_out) {
    float bx = G.bob_x, by = G.bob_y;
    int mode = 1;
    if (vs == ST_CASTING) mode = 0;
    else if (vs == ST_HIT_WINDOW || game_feint_active(&G)) { mode = 2; by += 4; }
    else if (vs == ST_WAIT_BITE) by += (sinf(G.state_t * 11.0f) > 0.55f) ? 1.6f : 0.0f;  // ちょんちょんとつつく
    else by += sinf(G.anim_t * 3.0f) * 0.8f;
    if (mode == 0) {
      // 飛んでいる間は水面に影を出す
      float t = G.state_t / CAST_TIME;
      if (t > 1) t = 1;
      float sx = CAST_ORIGIN_X + (G.cast_x - CAST_ORIGIN_X) * t;
      float sy = CAST_ORIGIN_Y + (CAST_Y - CAST_ORIGIN_Y) * t;
      dr_ellipse(sx, sy + 3, 3.5f, 1.2f, 0, 0, TAU_F, RGBA(0x0A2140, 0x50));
    }
    // 釣り糸（水に入ると少したるむ）
    float sag = (mode == 0) ? 0 : (vs == ST_HIT_WINDOW ? -2 : 10);
    float qx = (tx + bx) / 2, qy = (ty + by) / 2 + sag;
    dr_quad_stroke(tx, ty, qx, qy, bx, by - (mode == 2 ? 0 : 9), 1.0f, RGBA(0xFFFFFF, 0xC0));
    draw_bobber(bx, by, mode);
  } else if (vs == ST_CAUGHT) {
    // 釣り上げた直後：糸の先で魚が跳ねる
    float k = G.state_t / 0.3f;
    if (k > 1) k = 1;
    float fx = tx + 6, fy = ty + 22 - k * 6 + sinf(G.anim_t * 20) * 1.5f;
    dr_line(tx, ty, fx, fy - 6, 1.0f, RGBA(0xFFFFFF, 0xC0));
    if (G.last_species != SP_BOOT) {
      dr_save(); dr_translate(fx, fy); dr_rotate(1.4f + sinf(G.anim_t * 22) * 0.3f);
      art_draw_fish(G.last_species, 0, 0, 0.28f, G.anim_t);
      dr_restore();
    } else {
      art_draw_fish(SP_BOOT, fx, fy, 0.3f, G.anim_t);
    }
  } else {
    // 糸を巻いた状態：竿先からぶら下がるウキ
    float bx = tx + sinf(G.anim_t * 1.6f) * 1.5f, by = ty + 14;
    dr_line(tx, ty, bx, by - 9, 1.0f, RGBA(0xFFFFFF, 0xC0));
    draw_bobber(bx, by, 0);
  }
}

static void draw_ripples(void) {
  for (int i = 0; i < MAX_RIPPLES; i++) {
    Ripple *r = &ripples[i];
    if (!r->on) continue;
    float k = r->t / r->life;
    float rad = 3 + (r->maxr - 3) * k;
    dr_save();
    dr_set_alpha(0.75f * (1 - k));
    dr_arc_stroke(r->x, r->y + 2, rad, rad * 0.36f, 0, 0, TAU_F, 1.2f, RGB(0xFFFFFF));
    if (rad > 10) dr_arc_stroke(r->x, r->y + 2, rad * 0.6f, rad * 0.22f, 0, 0, TAU_F, 1.0f, RGB(0xE0F6FF));
    dr_restore();
  }
}

static void draw_drops(void) {
  for (int i = 0; i < MAX_DROPS; i++) {
    Drop *d = &drops[i];
    if (!d->on) continue;
    dr_save();
    dr_set_alpha(1 - d->t / d->life);
    dr_circle(d->x, d->y, d->r, d->c);
    dr_restore();
  }
}

static void draw_cursor(void) {
  GameState vs = vis_state();
  float x, a;
  if (vs == ST_AIMING) { x = G.cursor_x; a = 1.0f; }
  else if (vs == ST_CASTING) { x = G.cast_x; a = 0.55f; }
  else if (vs == ST_CAUGHT || (vs == ST_MISSED && G.state_t > 0.25f)) { x = G.cursor_x; a = 0.5f; }
  else return;
  float y = CAST_Y;
  float pulse = 1 + 0.08f * sinf(G.anim_t * 6.0f);
  dr_save();
  dr_set_alpha(a);
  // 興味を持たせられる範囲（±NEAR_MAX）の目安
  dr_rect(x - NEAR_MAX, y - 1, NEAR_MAX * 2, 2, RGBA(0xFFFFFF, 0x30));
  dr_rect(x - NEAR_MAX - 1, y - 5, 2, 10, RGBA(0xFFFFFF, 0x80));
  dr_rect(x + NEAR_MAX - 1, y - 5, 2, 10, RGBA(0xFFFFFF, 0x80));
  float r = 10 * pulse;
  dr_arc_stroke(x, y, r + 1, r + 1, 0, 0, TAU_F, 3.2f, RGBA(0x5A3A00, 0xA0));
  dr_arc_stroke(x, y, r, r, 0, 0, TAU_F, 2.0f, RGB(0xFFE14D));
  dr_line(x - r - 5, y, x - r + 3, y, 2, RGB(0xFFE14D));
  dr_line(x + r - 3, y, x + r + 5, y, 2, RGB(0xFFE14D));
  dr_line(x, y - r - 5, x, y - r + 3, 2, RGB(0xFFE14D));
  dr_line(x, y + r - 3, x, y + r + 5, 2, RGB(0xFFE14D));
  dr_circle(x, y, 1.6f, RGB(0xFFE14D));
  dr_restore();
}

// ================================================================
//  上画面：HUD・演出
// ================================================================
static void draw_hud(void) {
  char buf[32];
  int sec = (int)ceilf(G.time_left);
  bool warn = G.time_left <= TIME_WARN_SEC && G.state != ST_TITLE;
  dr_round_rect(4, 4, 92, 24, 6, RGBA(0x0A2140, 0x90));
  snprintf(buf, sizeof(buf), "TIME %2d", sec);
  float px = 17;
  if (warn && G.state != ST_PAUSE && G.state != ST_RESULT) px = 17 + 2 * fabsf(sinf(G.anim_t * 6.0f));
  text_outline(buf, 50, 16, px, warn ? RGB(0xFF4B3E) : RGB(0xFFFFFF), RGB(0x0A2140), AL_CENTER, BL_MIDDLE);

  dr_round_rect(274, 4, 122, 24, 6, RGBA(0x0A2140, 0x90));
  snprintf(buf, sizeof(buf), "SCORE %4d", G.score);
  text_outline(buf, 335, 16, 17, RGB(0xFFE14D), RGB(0x0A2140), AL_CENTER, BL_MIDDLE);
}

static void draw_hit(void) {
  float t = G.state_t;
  float s = t < 0.12f ? 0.5f + t / 0.12f * 0.7f : 1.2f - 0.1f * fminf((t - 0.12f) / 0.2f, 1.0f);
  float sx = sinf(G.anim_t * 60.0f) * 2.0f;
  dr_save();
  dr_translate(200 + sx, 86);
  dr_scale(s, s);
  text_outline("HIT!", 0, 0, 52, RGB(0xFFE14D), RGB(0xB3261E), AL_CENTER, BL_MIDDLE);
  dr_restore();
  text_outline("Aボタン！", 200, 120, 18, RGB(0xFFFFFF), RGB(0xB3261E), AL_CENTER, BL_MIDDLE);
}

// テンションメーター（ゆるい／ちょうどいい／切れそう の3色帯と現在位置）
static void draw_tension_meter(float x, float y, float w, float h) {
  float zs = w * TENSION_SLACK_ZONE, zd = w * TENSION_DANGER_ZONE;
  dr_round_rect(x - 3, y - 3, w + 6, h + 6, 5, RGB(0x1B3A5C));
  dr_rect(x, y, zs, h, RGB(0x6FA8DC));
  dr_rect(x + zs, y, zd - zs, h, RGB(0x5BBF5B));
  dr_rect(x + zd, y, w - zd, h, RGB(0xE5533D));
  // 危険域は点滅して目立たせる
  if (G.tension >= TENSION_DANGER_ZONE && fmodf(G.anim_t, 0.2f) < 0.1f) dr_rect(x + zd, y, w - zd, h, RGBA(0xFFFFFF, 0x70));
  if (G.tension < TENSION_SLACK_ZONE && fmodf(G.anim_t, 0.2f) < 0.1f) dr_rect(x, y, zs, h, RGBA(0xFFFFFF, 0x70));
  float mx = x + w * G.tension;
  dr_rect(mx - 1.5f, y - 4, 3, h + 8, RGB(0xFFFFFF));
  dr_tri(mx - 5, y - 7, mx + 5, y - 7, mx, y - 2, RGB(0xFFFFFF));
}

static void draw_progress_bar(float x, float y, float w, float h) {
  float p = G.progress < 0 ? 0 : (G.progress > 1 ? 1 : G.progress);
  dr_rect(x - 1, y - 1, w + 2, h + 2, RGB(0x1B3A5C));
  dr_rect(x, y, w, h, RGB(0x37506A));
  dr_rect(x, y, w * p, h, RGB(0xFFD23F));
}

static void draw_fight_top(void) {
  // メーター（HUD の間に配置）
  draw_tension_meter(112, 7, 176, 12);
  draw_progress_bar(112, 24, 176, 4);
  // 開始直後の「ファイト！」
  if (G.state_t < 0.8f) {
    float s = G.state_t < 0.15f ? 0.6f + G.state_t / 0.15f * 0.5f : 1.1f;
    dr_save(); dr_translate(200, 86); dr_scale(s, s);
    text_outline("ファイト！", 0, 0, 34, RGB(0xFFE14D), RGB(0xB3261E), AL_CENTER, BL_MIDDLE);
    dr_restore();
  }
  // 暴れる予兆：魚の上に「！」
  float fx = G.bob_x, fy = G.bob_y;
  if (G.rush_phase == RUSH_WARN) {
    float bounce = fabsf(sinf(G.anim_t * 20.0f)) * 3;
    dr_circle(fx, fy - 26 - bounce, 9, RGB(0xFFFFFF));
    dr_tri(fx - 4, fy - 19 - bounce, fx + 4, fy - 19 - bounce, fx, fy - 13 - bounce, RGB(0xFFFFFF));
    text_outline("!", fx, fy - 26 - bounce, 16, RGB(0xE5533D), RGB(0xFFFFFF), AL_CENTER, BL_MIDDLE);
  }
  const char *msg = NULL; u32 mc = RGB(0xFFFFFF);
  if (G.rush_phase == RUSH_ON) { msg = "あばれてる！ Aをはなせ！"; mc = RGB(0xFF8A80); }
  else if (G.tension >= TENSION_DANGER_ZONE) { msg = "切れそう！"; mc = RGB(0xFF8A80); }
  else if (G.tension < TENSION_SLACK_ZONE && G.state_t >= 0.8f) { msg = "ゆるすぎ！ 巻いて！"; mc = RGB(0xB3E5FC); }
  if (msg) text_outline(msg, 200, 46, 16, mc, RGB(0x1B3A5C), AL_CENTER, BL_MIDDLE);
}

static void draw_miss(void) {
  const char *msg = "";
  switch (G.miss_reason) {
    case MISS_NO_REACTION: msg = "反応なし…"; break;
    case MISS_TOO_CLOSE:   msg = "近すぎた！ 魚が逃げた"; break;
    case MISS_EARLY:       msg = "早すぎた！ 魚が逃げた"; break;
    case MISS_ESCAPED:     msg = "逃げられた…"; break;
    case MISS_LINE_BREAK:  msg = "糸が切れた！"; break;
    case MISS_SLACK:       msg = "針が外れた…"; break;
    case MISS_FEINT:       msg = "フェイントだった！"; break;
    default: break;
  }
  float a = G.state_t < 0.5f ? 1.0f : 1.0f - (G.state_t - 0.5f) / 0.2f;
  dr_save();
  dr_set_alpha(a);
  text_outline(msg, 200, 100 - G.state_t * 8, 20, RGB(0xFFFFFF), RGB(0x1B3A5C), AL_CENTER, BL_MIDDLE);
  dr_restore();
}

static void draw_catch_card(void) {
  char buf[48];
  float t = G.state_t;
  Species sp = G.last_species;
  bool gold = sp == SP_GOLD, boot = sp == SP_BOOT;
  float k = t < 0.2f ? t / 0.2f : 1.0f;
  float s = 0.5f + 0.6f * k - 0.1f * (k >= 1 ? fminf((t - 0.2f) / 0.1f, 1.0f) : 0);
  dr_save();
  dr_translate(200, 126);
  if (gold) {
    // 金色の光（回転する光線）
    for (int i = 0; i < 14; i++) {
      float a = i * TAU_F / 14 + G.anim_t * 0.9f;
      dr_tri(0, 0, cosf(a - 0.11f) * 260, sinf(a - 0.11f) * 260, cosf(a + 0.11f) * 260, sinf(a + 0.11f) * 260,
             RGBA(0xFFD54F, 0x60));
    }
    dr_circle(0, 0, 90, RGBA(0xFFF3B0, 0x40));
  }
  dr_scale(s, s);
  u32 border = gold ? RGB(0xC8901A) : RGB(0x2E5E8A);
  dr_round_rect(-94, -66, 188, 136, 12, border);
  dr_round_rect(-90, -62, 180, 128, 10, gold ? RGB(0xFFF6CC) : RGB(0xFFFBEF));
  u32 head_col = gold ? RGB(0xFFD23F) : (boot ? RGB(0x9AA5B1) : RGB(0x4FA3E0));
  dr_round_rect(-90, -62, 180, 26, 10, head_col);
  dr_rect(-90, -46, 180, 10, head_col);   // 見出しの下側は角を丸めない
  const char *head = gold ? "RARE FISH!!" : (boot ? "ざんねん…" : "つれた！");
  if (G.last_new) {
    // 初めて釣った魚：ずかんに登録
    float pulse = 1 + 0.1f * sinf(G.anim_t * 10.0f);
    dr_save(); dr_translate(70, -64); dr_rotate(0.25f); dr_scale(pulse, pulse);
    dr_star(0, 0, 22, 15, 10, RGB(0xFF5A4E));
    text_outline("NEW!", 0, 0, 13, RGB(0xFFFFFF), RGB(0xB3261E), AL_CENTER, BL_MIDDLE);
    dr_restore();
  }
  text_outline(head, 0, -49, 19, RGB(0xFFFFFF), gold ? RGB(0xA0700E) : RGB(0x1B3A5C), AL_CENTER, BL_MIDDLE);
  float wob = sinf(G.anim_t * 8.0f) * 0.08f;
  dr_save(); dr_translate(0, -6); dr_rotate(wob);
  art_draw_fish(sp, 0, 0, gold ? 1.75f : 1.6f, G.anim_t);
  dr_restore();
  dr_text(SPECIES_NAME_JP[sp], 0, 34, 17, RGB(0x1B2A3A), AL_CENTER, BL_MIDDLE);
  snprintf(buf, sizeof(buf), "+%d点", G.last_points);
  text_outline(buf, 0, 54, 19, boot ? RGB(0x9AA5B1) : RGB(0xFF8A00), RGB(0xFFFFFF), AL_CENTER, BL_MIDDLE);
  if (gold) {
    // キラキラ
    for (int i = 0; i < 10; i++) {
      float a = i * TAU_F / 10 + G.anim_t * 1.4f;
      float r = 100 + 8 * sinf(G.anim_t * 5 + i);
      float tw = 0.5f + 0.5f * sinf(G.anim_t * 10 + i * 1.7f);
      dr_star(cosf(a) * r, sinf(a) * r * 0.75f, 3 + tw * 4, 1.2f, 4, RGB(0xFFFFFF));
    }
  }
  dr_restore();
}

// ハイスコア TOP5 の表。hl 番目（今回の記録）を目立たせる
static void draw_top5(float x, float y, float w, float rh, float px, int hl) {
  char buf[16];
  for (int i = 0; i < TOP_COUNT; i++) {
    float cy = y + i * rh + rh / 2;
    bool on = i == hl;
    if (on) {
      float pulse = 0.5f + 0.5f * sinf(G.anim_t * 6.0f);
      dr_round_rect(x, y + i * rh + 1, w, rh - 2, 5, lerp_col(RGB(0xFFE9A8), RGB(0xFFD23F), pulse));
    }
    // 順位のメダル（1〜3位は金・銀・銅）
    u32 mc = i == 0 ? RGB(0xF2B01E) : i == 1 ? RGB(0x9AA8B6) : i == 2 ? RGB(0xC98A4B) : RGB(0x6A8AA8);
    dr_circle(x + 11, cy, rh * 0.36f, shade(mc, -50));
    dr_circle(x + 11, cy, rh * 0.36f - 1.2f, mc);
    snprintf(buf, sizeof(buf), "%d", i + 1);
    dr_text(buf, x + 11, cy, px * 0.8f, RGB(0xFFFFFF), AL_CENTER, BL_MIDDLE);
    if (i < G.top_count) {
      art_draw_face(G.top[i].player, x + 36, cy, rh * 0.38f);
      snprintf(buf, sizeof(buf), "%d 点", G.top[i].score);
      dr_text(buf, x + w - 8, cy, px, on ? RGB(0xC0392B) : RGB(0x1B2A3A), AL_RIGHT, BL_MIDDLE);
    } else {
      dr_text("－－－", x + w - 8, cy, px, RGB(0xA0AAB4), AL_RIGHT, BL_MIDDLE);
    }
  }
}

static void draw_title_top(void) {
  float t = G.anim_t;
  dr_round_rect(36, 12, 328, 88, 14, RGBA(0x0A2140, 0x80));
  float bounce = sinf(t * 2.5f) * 3;
  text_outline("わくわくフィッシング", 200, 44 + bounce, 32, RGB(0xFFE14D), RGB(0xC0392B), AL_CENTER, BL_MIDDLE);
  text_outline("Waku Waku Fishing", 200, 80, 16, RGB(0xFFFFFF), RGB(0x1B3A5C), AL_CENTER, BL_MIDDLE);
  // ハイスコア TOP5
  dr_round_rect(128, 108, 216, 124, 12, RGBA(0x1B3A5C, 0xC0));
  dr_round_rect(131, 111, 210, 118, 10, RGBA(0xFFFBEF, 0xE8));
  dr_text("ハイスコア TOP5", 236, 123, 13, RGB(0x2E5E8A), AL_CENTER, BL_MIDDLE);
  draw_top5(138, 132, 196, 19, 13, -1);
}

static void draw_result_top(void) {
  char buf[64];
  if (G.state_t < TIMEUP_LOCK_TIME) {
    float s = fminf(G.state_t / 0.2f, 1.0f);
    dr_save(); dr_translate(200, 110); dr_scale(0.6f + 0.4f * s, 0.6f + 0.4f * s);
    text_outline("TIME UP!", 0, 0, 48, RGB(0xFFFFFF), RGB(0xC0392B), AL_CENTER, BL_MIDDLE);
    dr_restore();
    return;
  }
  dr_rect(0, 0, 400, 240, RGBA(0x0A2140, 0x70));
  dr_round_rect(28, 10, 344, 220, 14, RGB(0x2E5E8A));
  dr_round_rect(32, 14, 336, 212, 12, RGB(0xFFFBEF));
  text_outline("けっか", 200, 30, 20, RGB(0xFFFFFF), RGB(0x2E5E8A), AL_CENTER, BL_MIDDLE);
  art_draw_face(G.player, 58, 32, 11);   // あそんだ人

  // 左：今回の成績
  dr_text("とくてん", 50, 58, 13, RGB(0x4A5A6A), AL_LEFT, BL_MIDDLE);
  snprintf(buf, sizeof(buf), "%d 点", G.score);
  text_outline(buf, 150, 82, 28, RGB(0xFF8A00), RGB(0x5A3000), AL_RIGHT, BL_MIDDLE);
  if (G.new_record && fmodf(G.anim_t, 0.8f) < 0.55f)
    text_outline("NEW RECORD!", 100, 104, 12, RGB(0xFFE14D), RGB(0xC0392B), AL_CENTER, BL_MIDDLE);

  char rank = game_rank(G.score);
  u32 rc = rank == 'S' ? RGB(0xF2B01E) : rank == 'A' ? RGB(0xE5533D) : rank == 'B' ? RGB(0x3E7CC8)
         : rank == 'C' ? RGB(0x4CAF50) : RGB(0x8A96A3);
  dr_circle(188, 76, 26, shade(rc, -60));
  dr_circle(188, 76, 23.5f, rc);
  dr_text("RANK", 188, 60, 10, RGB(0xFFFFFF), AL_CENTER, BL_MIDDLE);
  char rs[2] = { rank, 0 };
  text_outline(rs, 188, 81, 30, RGB(0xFFFFFF), shade(rc, -80), AL_CENTER, BL_MIDDLE);

  const float y0 = 124, dy = 20, vx = 212;
  snprintf(buf, sizeof(buf), "%d 匹", G.fish_caught);
  dr_text("釣った魚の総数", 50, y0, 12, RGB(0x1B2A3A), AL_LEFT, BL_MIDDLE);
  dr_text(buf, vx, y0, 12, RGB(0x1B2A3A), AL_RIGHT, BL_MIDDLE);
  snprintf(buf, sizeof(buf), "%d 回", G.casts);
  dr_text("キャスティング回数", 50, y0 + dy, 12, RGB(0x1B2A3A), AL_LEFT, BL_MIDDLE);
  dr_text(buf, vx, y0 + dy, 12, RGB(0x1B2A3A), AL_RIGHT, BL_MIDDLE);
  snprintf(buf, sizeof(buf), "%d %%", game_success_rate(&G));
  dr_text("釣り上げ成功率", 50, y0 + dy * 2, 12, RGB(0x1B2A3A), AL_LEFT, BL_MIDDLE);
  dr_text(buf, vx, y0 + dy * 2, 12, RGB(0x1B2A3A), AL_RIGHT, BL_MIDDLE);
  dr_text("いちばんレア", 50, y0 + dy * 3, 12, RGB(0x1B2A3A), AL_LEFT, BL_MIDDLE);
  if (G.rarest >= 0)
    dr_text(SPECIES_NAME_JP[G.rarest], vx, y0 + dy * 3, 12, RGB(0xC0392B), AL_RIGHT, BL_MIDDLE);
  else
    dr_text("なし", vx, y0 + dy * 3, 12, RGB(0x8A96A3), AL_RIGHT, BL_MIDDLE);

  // 右：ハイスコア TOP5（今回の記録が入ったら光らせる）
  dr_rect(223, 50, 1.5f, 146, RGB(0xD6DEE6));
  dr_text("ハイスコア TOP5", 296, 58, 13, RGB(0x2E5E8A), AL_CENTER, BL_MIDDLE);
  draw_top5(232, 70, 130, 24, 14, G.top_pos);
  if (G.top_pos < 0 && G.score > 0)
    dr_text("TOP5 ならず…", 296, 200, 11, RGB(0x8A96A3), AL_CENTER, BL_MIDDLE);
  dr_text("A：リトライ    B：タイトルへ", 200, 212, 13, RGB(0x4A5A6A), AL_CENTER, BL_MIDDLE);
}

static void draw_top(void) {
  GameState vs = vis_state();
  draw_background();
  // 魚影は奥から順に描く（スロット番号＝レーン番号＝奥→手前）
  for (int i = 0; i < FISH_COUNT; i++) draw_shadow(&G.fish[i]);
  // ウキへの食いつき中は波紋を出し続ける
  draw_ripples();
  draw_cursor();
  draw_pier();
  draw_angler();
  float tx, ty;
  rod_tip(&tx, &ty);
  if (vs != ST_TITLE && vs != ST_RESULT) draw_line_and_bobber();
  draw_rod(tx, ty);
  draw_drops();

  if (vs == ST_TITLE) { draw_title_top(); return; }
  if (vs == ST_RESULT) { draw_result_top(); return; }
  draw_hud();
  if (vs == ST_HIT_WINDOW) draw_hit();
  if (vs == ST_FIGHT) draw_fight_top();
  if (vs == ST_MISSED) draw_miss();
  if (vs == ST_CAUGHT) draw_catch_card();
  if (flash_t > 0) dr_rect(0, 0, 400, 240, RGBA(0xFFF8D0, (int)(flash_t / 0.35f * 200)));
  if (G.state == ST_PAUSE) {
    dr_rect(0, 0, 400, 240, RGBA(0x000000, 0x80));
    text_outline("PAUSE", 200, 110, 44, RGB(0xFFFFFF), RGB(0x1B3A5C), AL_CENTER, BL_MIDDLE);
    dr_text("下画面のメニューを選んでね", 200, 146, 14, RGB(0xFFFFFF), AL_CENTER, BL_MIDDLE);
  }
}

// ================================================================
//  下画面
// ================================================================
// 釣果表（5×5）。未発見の魚はシルエットと「？」で隠す
#define GRID_COLS 5
#define GRID_CW   61.0f
#define GRID_GAP  2.0f
static void draw_species_grid(float y0, float ch) {
  char buf[16];
  for (int k = 0; k < SP_COUNT; k++) {
    int col = k % GRID_COLS, row = k / GRID_COLS;
    float x = 4 + col * (GRID_CW + GRID_GAP), y = y0 + row * (ch + GRID_GAP);
    int n = G.counts[k];
    bool found = game_is_discovered(&G, (Species)k);
    // マスに収まる大きさで魚を描く（横幅と高さの両方で制限）
    float s = 32.0f / art_width((Species)k);
    float smax = (ch - 3) / 30.0f;
    if (s > smax) s = smax;
    float ax = x + 21, ay = y + ch / 2;
    if (!found) {
      dr_round_rect(x, y, GRID_CW, ch, 4, RGB(0x8FA3B5));
      dr_save();
      dr_set_tint(RGB(0x4A5E70));
      art_draw_fish((Species)k, ax, ay, s, 0);
      dr_clear_tint();
      dr_restore();
      text_outline("？", x + GRID_CW - 11, ay, ch > 24 ? 15 : 13, RGB(0xFFFFFF), RGB(0x4A5E70), AL_CENTER, BL_MIDDLE);
      continue;
    }
    dr_round_rect(x, y, GRID_CW, ch, 4, n ? RGB(0xFFFFFF) : RGB(0xE3ECF3));
    art_draw_fish((Species)k, ax, ay, s, n ? G.anim_t : 0);
    snprintf(buf, sizeof(buf), "×%d", n);
    dr_text(buf, x + GRID_CW - 2, y + ch - 1, ch > 24 ? 12 : 11, n ? RGB(0xE5533D) : RGB(0x9AA5B1), AL_RIGHT, BL_BOTTOM);
  }
}

static const char *status_text(void) {
  switch (vis_state()) {
    case ST_AIMING:        return "魚影を ねらって キャスト！";
    case ST_CASTING:       return "それっ！";
    case ST_FISH_APPROACH: return "魚が ウキに 近づいてきた…";
    case ST_WAIT_BITE:     return "まだまだ… ガマン！";
    case ST_HIT_WINDOW:    return "いまだ！ Aボタン！";
    case ST_FIGHT:
      if (G.rush_phase == RUSH_ON)   return "あばれてる！ Aをはなせ！";
      if (G.rush_phase == RUSH_WARN) return "来るぞ…！";
      return "やりとり中！ 糸の張りを保て！";
    case ST_CAUGHT:        return G.last_species == SP_GOLD ? "すごい！ 黄金の魚だ！" :
                                  G.last_species == SP_BOOT ? "長靴だった…" : "つれた！";
    case ST_MISSED:
      switch (G.miss_reason) {
        case MISS_NO_REACTION: return "魚影から 遠すぎたみたい";
        case MISS_TOO_CLOSE:   return "魚影の 真上は 近すぎ！";
        case MISS_EARLY:       return "食いつく前に 合わせちゃった";
        case MISS_LINE_BREAK:  return "張りすぎて 糸が切れた";
        case MISS_SLACK:       return "ゆるめすぎて 針が外れた";
        case MISS_FEINT:       return "フェイントに だまされた…";
        default:               return "合わせが 間に合わなかった";
      }
    default: return "";
  }
}

static const char *hint_text(void) {
  switch (vis_state()) {
    case ST_AIMING:        return "スライドパッド/十字キー：ねらう   A：キャスト";
    case ST_FISH_APPROACH:
    case ST_WAIT_BITE:     return "HIT!が出たら A（フェイント注意）  B：回収";
    case ST_HIT_WINDOW:    return "A：合わせる！";
    case ST_FIGHT:         return "A長押し：巻く   はなす：ゆるめる";
    default:               return "START：一時停止";
  }
}

static void draw_gauge(void) {
  GameState vs = vis_state();
  const float gx = 62, gy = 66, gw = 246, gh = 18;
  if (vs == ST_FIGHT) {
    // やりとり中：テンションメーターと巻き上げの進み具合
    dr_text("張り", 10, 66, 13, RGB(0x1B2A3A), AL_LEFT, BL_MIDDLE);
    draw_tension_meter(gx, 60, gw, 12);
    dr_text("巻き", 10, 83, 11, RGB(0x1B2A3A), AL_LEFT, BL_MIDDLE);
    draw_progress_bar(gx, 80, gw, 6);
    return;
  }
  dr_text("反応", 10, gy + gh / 2, 13, RGB(0x1B2A3A), AL_LEFT, BL_MIDDLE);
  dr_round_rect(gx - 3, gy - 3, gw + 6, gh + 6, 6, RGB(0x1B3A5C));
  dr_round_rect(gx, gy, gw, gh, 4, RGB(0x37506A));
  if (vs == ST_HIT_WINDOW) {
    float k = 1.0f - G.state_t / G.grace;
    if (k < 0) k = 0;
    u32 c = k > 0.5f ? lerp_col(RGB(0xFFD23F), RGB(0x4CD964), (k - 0.5f) * 2) : lerp_col(RGB(0xFF3B30), RGB(0xFFD23F), k * 2);
    if (k > 0.01f) dr_round_rect(gx, gy, gw * k, gh, 4, c);
    text_outline("いまだ！", gx + gw / 2, gy + gh / 2, 14, RGB(0xFFFFFF), RGB(0x1B3A5C), AL_CENTER, BL_MIDDLE);
  } else if (vs == ST_WAIT_BITE || vs == ST_FISH_APPROACH) {
    float p = 0.5f + 0.5f * sinf(G.anim_t * 5.0f);
    dr_round_rect(gx, gy, gw, gh, 4, RGBA(0x6FA8DC, (int)(0x30 + p * 0x30)));
    dr_text("ウキに 集中…", gx + gw / 2, gy + gh / 2, 12, RGB(0xD6E4EE), AL_CENTER, BL_MIDDLE);
  } else {
    dr_text("---", gx + gw / 2, gy + gh / 2, 12, RGB(0x8A96A3), AL_CENTER, BL_MIDDLE);
  }
}

static void draw_bottom_play(void) {
  char buf[48];
  dr_rect(0, 0, 320, 240, RGB(0xEAF6FB));
  dr_rect(0, 0, 320, 30, RGB(0x1B4965));
  dr_text(status_text(), 160, 15, 15, vis_state() == ST_HIT_WINDOW ? RGB(0xFFE14D) : RGB(0xFFFFFF), AL_CENTER, BL_MIDDLE);
  dr_text(hint_text(), 160, 45, 11, RGB(0x2E4A62), AL_CENTER, BL_MIDDLE);
  draw_gauge();
  draw_species_grid(92, 21);
  dr_rect(0, 206, 320, 34, RGB(0xD6E4EE));
  snprintf(buf, sizeof(buf), "SCORE %d", G.score);
  art_draw_face(G.player, 17, 223, 10);   // いまあそんでいる人
  dr_text(buf, 34, 216, 14, RGB(0x1B2A3A), AL_LEFT, BL_MIDDLE);
  snprintf(buf, sizeof(buf), "HI %d", G.high_score);
  dr_text(buf, 34, 231, 11, RGB(0x4A5A6A), AL_LEFT, BL_MIDDLE);
  snprintf(buf, sizeof(buf), "キャスト %d回", G.casts);
  dr_text(buf, 236, 216, 11, RGB(0x4A5A6A), AL_RIGHT, BL_MIDDLE);
  snprintf(buf, sizeof(buf), "ずかん %d/%d", game_discovered_count(&G), SP_COUNT);
  dr_text(buf, 236, 231, 11, RGB(0x4A5A6A), AL_RIGHT, BL_MIDDLE);
  if (G.state != ST_PAUSE) draw_button(BTN_PAUSE, "PAUSE", RGB(0x5B7C99), false, 12);
}

static void draw_bottom_title(void) {
  char buf[48];
  dr_rect_vgrad(0, 0, 320, 240, RGB(0xBFE7F5), RGB(0x6EB6DE));
  text_outline("わくわくフィッシング", 160, 18, 18, RGB(0xFFE14D), RGB(0xC0392B), AL_CENTER, BL_MIDDLE);
  if (save_failed)   // SD カードに書けなかったときは、ここで知らせる
    text_outline("SDカードに記録を保存できませんでした", 160, 40, 12, RGB(0xFFFFFF), RGB(0xC0392B), AL_CENTER, BL_MIDDLE);
  else
    dr_text("だれが あそぶ？ 顔をえらんでね", 160, 40, 12, RGB(0x1B3A5C), AL_CENTER, BL_MIDDLE);
  // あそぶ人（顔）をえらぶ
  static const char *names[PLAYER_COUNT] = { "おとこのこ", "おんなのこ" };
  for (int p = 0; p < PLAYER_COUNT; p++) {
    Rect r = BTN_PLAYER[p];
    bool sel = G.player == (Player)p;
    float cx = r.x + r.w / 2.0f;
    if (sel) {
      dr_round_rect(r.x - 3, r.y - 3, r.w + 6, r.h + 6, 14, RGB(0xFFB300));
      dr_round_rect(r.x, r.y, r.w, r.h, 12, RGB(0xFFFBEF));
    } else {
      dr_round_rect(r.x, r.y, r.w, r.h, 12, RGBA(0xFFFFFF, 0x80));
    }
    dr_save();
    if (!sel) dr_set_alpha(0.6f);
    float bounce = sel ? -fabsf(sinf(G.anim_t * 4.0f)) * 3 : 0;
    art_draw_face((Player)p, cx, r.y + 38 + bounce, 22);
    dr_text(names[p], cx, r.y + 74, 14, sel ? RGB(0xC0392B) : RGB(0x1B3A5C), AL_CENTER, BL_MIDDLE);
    snprintf(buf, sizeof(buf), "ずかん %d/%d", game_discovered_count_of(&G, (Player)p), SP_COUNT);
    dr_text(buf, cx, r.y + 89, 11, RGB(0x4A5A6A), AL_CENTER, BL_MIDDLE);
    dr_restore();
  }
  draw_button(BTN_START, "スタート", RGB(0xE5533D), fmodf(G.anim_t, 1.0f) < 0.5f, 20);
  const char *lines[3] = {
    "←→ か タッチ：えらぶ    A：スタート",
    "ゲーム中  A：キャスト・合わせ   B：糸を回収",
    "スライドパッド/十字キー：ねらう   START：一時停止",
  };
  for (int i = 0; i < 3; i++) dr_text(lines[i], 160, 205 + i * 13, 11, RGB(0x10283E), AL_CENTER, BL_MIDDLE);
}

static void draw_bottom_result(void) {
  char buf[48];
  dr_rect(0, 0, 320, 240, RGB(0xEAF6FB));
  dr_rect(0, 0, 320, 26, RGB(0x1B4965));
  snprintf(buf, sizeof(buf), "種類別の釣果    ずかん %d/%d", game_discovered_count(&G), SP_COUNT);
  dr_text(buf, 160, 13, 14, RGB(0xFFFFFF), AL_CENTER, BL_MIDDLE);
  draw_species_grid(31, 26);
  snprintf(buf, sizeof(buf), "合計 %d点   ハイスコア %d点", G.score, G.high_score);
  dr_text(buf, 160, 178, 13, RGB(0x1B2A3A), AL_CENTER, BL_MIDDLE);
  bool ready = G.state_t >= TIMEUP_LOCK_TIME;
  dr_save();
  if (!ready) dr_set_alpha(0.4f);
  draw_button(BTN_RETRY, "リトライ", RGB(0xE5533D), false, 17);
  draw_button(BTN_TITLE, "タイトルへ", RGB(0x3E7CC8), false, 17);
  dr_restore();
}

static void draw_bottom_pause(void) {
  dr_rect(0, 0, 320, 240, RGB(0x1B3A5C));
  dr_text("一時停止中", 160, 22, 18, RGB(0xFFFFFF), AL_CENTER, BL_MIDDLE);
  const char *labels[3] = { "ゲームに戻る", "タイトルに戻る", "ゲームを終了する" };
  const u32 cols[3] = { RGB(0x4CAF50), RGB(0x3E7CC8), RGB(0xC0392B) };
  for (int i = 0; i < 3; i++) draw_button(BTN_MENU[i], labels[i], cols[i], G.pause_sel == i, 17);
  dr_text("十字キー上下：選択   A：決定   START/B：戻る", 160, 222, 11, RGB(0xD6E4EE), AL_CENTER, BL_MIDDLE);
}

static void draw_bottom(void) {
  switch (G.state) {
    case ST_TITLE:  draw_bottom_title(); break;
    case ST_RESULT: draw_bottom_result(); break;
    case ST_PAUSE:  draw_bottom_pause(); break;
    default:        draw_bottom_play(); break;
  }
}

// ================================================================
//  入力
// ================================================================
static void read_input(GameInput *in) {
  memset(in, 0, sizeof(*in));
  u32 kDown = hidKeysDown(), kHeld = hidKeysHeld();
  // 「押した瞬間」だけを渡すので、長押しで操作が連続発生しない
  in->a     = (kDown & KEY_A) != 0;
  in->a_held = (kHeld & KEY_A) != 0;   // やりとりの巻き取り用
  in->b     = (kDown & KEY_B) != 0;
  in->start = (kDown & KEY_START) != 0;
  in->up    = (kDown & KEY_UP) != 0;     // 十字キー上 + スライドパッド上
  in->down  = (kDown & KEY_DOWN) != 0;
  in->left  = (kDown & KEY_LEFT) != 0;     // タイトル画面での人の選択
  in->right = (kDown & KEY_RIGHT) != 0;

  // 左右：十字キーを優先し、なければスライドパッドのアナログ値
  if (kHeld & KEY_DLEFT) in->move = -1.0f;
  else if (kHeld & KEY_DRIGHT) in->move = 1.0f;
  else {
    circlePosition cp;
    hidCircleRead(&cp);
    int dx = cp.dx;
    if (dx > STICK_DEADZONE || dx < -STICK_DEADZONE) {
      float m = (dx > 0 ? dx - STICK_DEADZONE : dx + STICK_DEADZONE) / (STICK_FULL - STICK_DEADZONE);
      in->move = m > 1 ? 1 : (m < -1 ? -1 : m);
    }
  }

  if (kDown & KEY_TOUCH) {
    touchPosition tp;
    hidTouchRead(&tp);
    int x = tp.px, y = tp.py;
    switch (G.state) {
      case ST_TITLE:
        if (in_rect(x, y, BTN_START)) in->cmd = CMD_START;
        else if (in_rect(x, y, BTN_PLAYER[PL_BOY])) in->cmd = CMD_SEL_BOY;
        else if (in_rect(x, y, BTN_PLAYER[PL_GIRL])) in->cmd = CMD_SEL_GIRL;
        break;
      case ST_RESULT:
        if (in_rect(x, y, BTN_RETRY)) in->cmd = CMD_RETRY;
        else if (in_rect(x, y, BTN_TITLE)) in->cmd = CMD_TITLE;
        break;
      case ST_PAUSE:
        if (in_rect(x, y, BTN_MENU[0])) in->cmd = CMD_RESUME;
        else if (in_rect(x, y, BTN_MENU[1])) in->cmd = CMD_TITLE;
        else if (in_rect(x, y, BTN_MENU[2])) in->cmd = CMD_QUIT;
        break;
      default:
        if (in_rect(x, y, BTN_PAUSE)) in->cmd = CMD_PAUSE;
        break;
    }
  }
}

// ================================================================
//  メイン
// ================================================================
int main(void) {
  gfxInitDefault();
  C3D_Init(C3D_DEFAULT_CMDBUF_SIZE);
  C2D_Init(16000);
  C2D_Prepare();
  C3D_RenderTarget *top = C2D_CreateScreenTarget(GFX_TOP, GFX_LEFT);
  C3D_RenderTarget *bot = C2D_CreateScreenTarget(GFX_BOTTOM, GFX_LEFT);

  dr_init();
  audio_init();
  game_init(&G, (u32)osGetTime() | 1u);
  save_load();
  fx_rng ^= (u32)osGetTime();

  u64 last = osGetTime();
  while (aptMainLoop()) {
    hidScanInput();

    // 実経過時間で進める（HOMEメニュー復帰などの大きな飛びだけは抑える）
    u64 now = osGetTime();
    float dt = (now - last) / 1000.0f;
    last = now;
    if (dt > 0.05f) dt = 0.05f;

    GameInput in;
    read_input(&in);
    game_update(&G, dt, &in);
    save_if_changed();
    if (G.quit) break;
    handle_events(G.events);

    if (G.state != ST_PAUSE) {
      update_fx(dt);
      if (G.state == ST_HIT_WINDOW) {
        hit_ripple_t -= dt;
        if (hit_ripple_t <= 0) { add_ripple(G.bob_x, CAST_Y, 18, 0.6f); hit_ripple_t = 0.22f; }
      } else if (G.state == ST_WAIT_BITE) {
        hit_ripple_t -= dt;
        if (hit_ripple_t <= 0) { add_ripple(G.bob_x, CAST_Y, 9, 0.5f); hit_ripple_t = 0.45f; }
      } else if (G.state == ST_FIGHT) {
        // やりとり中：魚のまわりに波紋、暴れているときはしぶき。巻いている間はリールの音
        hit_ripple_t -= dt;
        if (hit_ripple_t <= 0) {
          bool rush = G.rush_phase == RUSH_ON;
          add_ripple(G.bob_x, G.bob_y, rush ? 24 : 14, 0.6f);
          if (rush) add_splash(G.bob_x, G.bob_y, 5, 0.9f);
          hit_ripple_t = rush ? 0.12f : 0.3f;
        }
        if (in.a_held) {
          reel_tick_t -= dt;
          if (reel_tick_t <= 0) { se_tick(900.0f + G.tension * 900.0f); reel_tick_t = 0.07f; }
        }
      } else {
        hit_ripple_t = 0;
      }
    }
    audio_update();

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

  audio_exit();
  dr_exit();
  C2D_Fini();
  C3D_Fini();
  gfxExit();
  return 0;   // Homebrew Launcher に戻る
}
