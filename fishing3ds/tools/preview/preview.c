// ================================================================
//  PC 用 画面プレビュー
//  main.c の描画処理をそのまま PC で動かし、各場面の上下画面を
//  PPM（図形）＋テキスト一覧に書き出す。compose.py で PNG に合成する。
//  ※実機の見た目を完全に再現するものではない（文字はPCのフォントで代用）
// ================================================================
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>
#include <stdarg.h>

#define main fishing_main
#include "../../source/main.c"
#undef main

// ---------------- 代替実装 ----------------
u32  hidKeysDown(void) { return 0; }
u32  hidKeysHeld(void) { return 0; }
void hidScanInput(void) {}
void hidCircleRead(circlePosition *p) { p->dx = p->dy = 0; }
void hidTouchRead(touchPosition *p) { p->px = p->py = 0; }
u64  osGetTime(void) { return 0; }
bool aptMainLoop(void) { return false; }
void gfxInitDefault(void) {}
void gfxExit(void) {}

bool   audio_init(void) { return false; }
void   audio_exit(void) {}
void   audio_update(void) {}
double audio_now(void) { return 0; }
void   audio_voice(int bus, int wave, double t0, double dur, float f0, float f1, float vol, double env_t) {
  (void)bus; (void)wave; (void)t0; (void)dur; (void)f0; (void)f1; (void)vol; (void)env_t;
}
void   audio_set_bgm_volume(float t) { (void)t; }

// ---------------- ソフトウェアラスタライザ ----------------
static float fb[240][400][3];
static int   fb_w = 400;
static FILE *text_out = NULL;
static int   tri_count = 0, glyph_count = 0;

static void col_unpack(u32 c, float *r, float *g, float *b, float *a) {
  *r = (c & 0xFF) / 255.0f; *g = ((c >> 8) & 0xFF) / 255.0f;
  *b = ((c >> 16) & 0xFF) / 255.0f; *a = ((c >> 24) & 0xFF) / 255.0f;
}

void C2D_DrawTriangle(float x0, float y0, u32 c0, float x1, float y1, u32 c1, float x2, float y2, u32 c2, float depth) {
  (void)depth;
  tri_count++;
  float area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
  if (fabsf(area) < 1e-6f) return;
  int minx = (int)floorf(fminf(x0, fminf(x1, x2))), maxx = (int)ceilf(fmaxf(x0, fmaxf(x1, x2)));
  int miny = (int)floorf(fminf(y0, fminf(y1, y2))), maxy = (int)ceilf(fmaxf(y0, fmaxf(y1, y2)));
  if (minx < 0) minx = 0;
  if (miny < 0) miny = 0;
  if (maxx > fb_w - 1) maxx = fb_w - 1;
  if (maxy > 239) maxy = 239;
  float r0, g0, b0, a0, r1, g1, b1, a1, r2, g2, b2, a2;
  col_unpack(c0, &r0, &g0, &b0, &a0); col_unpack(c1, &r1, &g1, &b1, &a1); col_unpack(c2, &r2, &g2, &b2, &a2);
  for (int y = miny; y <= maxy; y++)
    for (int x = minx; x <= maxx; x++) {
      float px = x + 0.5f, py = y + 0.5f;
      float w0 = ((x1 - px) * (y2 - py) - (x2 - px) * (y1 - py)) / area;
      float w1 = ((x2 - px) * (y0 - py) - (x0 - px) * (y2 - py)) / area;
      float w2 = 1 - w0 - w1;
      // 共有辺の二重塗りを避ける（w==0 の辺は片側の三角形だけが塗る）
      if (w0 < 0 || w1 < 0 || w2 < 0) continue;
      if ((w0 == 0 && !(area > 0 ? (y2 > y1 || (y2 == y1 && x2 < x1)) : (y1 > y2 || (y1 == y2 && x1 < x2)))) ||
          (w1 == 0 && !(area > 0 ? (y0 > y2 || (y0 == y2 && x0 < x2)) : (y2 > y0 || (y2 == y0 && x2 < x0)))) ||
          (w2 == 0 && !(area > 0 ? (y1 > y0 || (y1 == y0 && x1 < x0)) : (y0 > y1 || (y0 == y1 && x0 < x1)))))
        continue;
      float a = w0 * a0 + w1 * a1 + w2 * a2;
      float r = w0 * r0 + w1 * r1 + w2 * r2, g = w0 * g0 + w1 * g1 + w2 * g2, b = w0 * b0 + w1 * b1 + w2 * b2;
      float *d = fb[y][x];
      d[0] = d[0] * (1 - a) + r * a; d[1] = d[1] * (1 - a) + g * a; d[2] = d[2] * (1 - a) + b * a;
    }
}

struct PvTextBuf { int dummy; };
static struct PvTextBuf the_buf;
C2D_TextBuf C2D_TextBufNew(size_t n) { (void)n; return &the_buf; }
void C2D_TextBufDelete(C2D_TextBuf b) { (void)b; }
void C2D_TextBufClear(C2D_TextBuf b) { (void)b; }
const char *C2D_TextParse(C2D_Text *t, C2D_TextBuf b, const char *s) { (void)b; t->str = s; return s + strlen(s); }
void C2D_TextOptimize(const C2D_Text *t) { (void)t; }

// 3DS 内蔵フォントの字幅をおおまかに近似（全角≒25, 半角≒13）
static float text_w(const char *s) {
  float w = 0;
  const unsigned char *p = (const unsigned char *)s;
  while (*p) {
    if (*p < 0x80) { w += (*p == ' ') ? 7.0f : 13.0f; p++; glyph_count++; }
    else {
      int n = (*p >= 0xF0) ? 4 : (*p >= 0xE0) ? 3 : 2;
      w += 25.0f; p += n; glyph_count++;
    }
  }
  return w;
}
void C2D_TextGetDimensions(const C2D_Text *t, float sx, float sy, float *w, float *h) {
  int save = glyph_count;
  *w = text_w(t->str) * sx;
  glyph_count = save;
  *h = 30.0f * sy;
}
void C2D_DrawText(const C2D_Text *t, u32 flags, float x, float y, float z, float sx, float sy, ...) {
  (void)flags; (void)z; (void)sy;
  va_list ap; va_start(ap, sy); u32 c = va_arg(ap, u32); va_end(ap);
  float w = text_w(t->str) * sx;
  if (text_out) fprintf(text_out, "%.2f\t%.2f\t%.4f\t%.2f\t%08X\t%s\n", x, y, sx, w, c, t->str);
}
bool C3D_Init(size_t n) { (void)n; return true; }
bool C2D_Init(size_t n) { (void)n; return true; }
void C2D_Prepare(void) {}
C3D_RenderTarget *C2D_CreateScreenTarget(gfxScreen_t s, gfx3dSide_t side) { (void)s; (void)side; return NULL; }
void C2D_TargetClear(C3D_RenderTarget *t, u32 c) { (void)t; (void)c; }
void C2D_SceneBegin(C3D_RenderTarget *t) { (void)t; }
bool C3D_FrameBegin(u8 f) { (void)f; return true; }
void C3D_FrameEnd(u8 f) { (void)f; }
void C2D_Fini(void) {}
void C3D_Fini(void) {}

// ---------------- 出力 ----------------
static void begin_screen(int w) {
  fb_w = w;
  for (int y = 0; y < 240; y++) for (int x = 0; x < 400; x++) fb[y][x][0] = fb[y][x][1] = fb[y][x][2] = 0;
}
static void write_ppm(const char *path) {
  FILE *f = fopen(path, "wb");
  fprintf(f, "P6\n%d 240\n255\n", fb_w);
  for (int y = 0; y < 240; y++)
    for (int x = 0; x < fb_w; x++)
      for (int k = 0; k < 3; k++) {
        float v = fb[y][x][k];
        fputc((int)(v < 0 ? 0 : v > 1 ? 255 : v * 255 + 0.5f), f);
      }
  fclose(f);
}

static void render(const char *name) {
  char path[256];
  dr_frame_begin();
  // 上画面
  begin_screen(400);
  snprintf(path, sizeof(path), "out/%s_top.txt", name);
  text_out = fopen(path, "w");
  tri_count = glyph_count = 0;
  draw_top();
  fclose(text_out);
  int tt = tri_count, tg = glyph_count;
  snprintf(path, sizeof(path), "out/%s_top.ppm", name);
  write_ppm(path);
  // 下画面
  begin_screen(320);
  snprintf(path, sizeof(path), "out/%s_bot.txt", name);
  text_out = fopen(path, "w");
  tri_count = glyph_count = 0;
  draw_bottom();
  fclose(text_out);
  snprintf(path, sizeof(path), "out/%s_bot.ppm", name);
  write_ppm(path);
  text_out = NULL;
  printf("%-14s top: %5d tris %4d glyphs | bottom: %5d tris %4d glyphs\n", name, tt, tg, tri_count, glyph_count);
}

// ---------------- 場面づくり ----------------
static GameInput NONE_IN;
static void run(float sec) { int n = (int)(sec * 60); for (int i = 0; i < n; i++) { game_update(&G, 1.0f / 60, &NONE_IN); handle_events(G.events); update_fx(1.0f / 60); } }
static void press(void) { GameInput a = NONE_IN; a.a = true; game_update(&G, 1.0f / 60, &a); handle_events(G.events); }

// 指定スロットの魚をカーソル近くに置く
static void place(int slot, float x, FishSize sz, Species sp) {
  Fish *f = &G.fish[slot];
  f->state = FS_SWIM; f->size = sz; f->species = sp; f->points = SPECIES_POINTS[sp];
  f->len = SIZE_LEN[sz]; f->x = x; f->alpha = 1; f->speed = 0; f->turn_t = 99;
}
// やりとりを自動で進める（until が真になるか、やりとりが終わるまで）
static void fight_until(int (*until)(void)) {
  GameInput in = NONE_IN;
  for (int i = 0; i < 60 * 30 && G.state == ST_FIGHT; i++) {
    if (until && until()) return;
    in.a_held = (G.rush_phase == RUSH_NONE && G.tension < 0.6f) || G.tension < 0.08f;
    game_update(&G, 1.0f / 60, &in); handle_events(G.events); update_fx(1.0f / 60);
  }
}
static int is_warn(void) { return G.rush_phase == RUSH_WARN && G.rush_t < 0.15f; }
static int is_rush(void) { return G.rush_phase == RUSH_ON && G.rush_t < 0.4f; }
static int half_done(void) { return G.progress > 0.45f && G.rush_phase == RUSH_NONE && G.tension > 0.5f; }

static void cast_to_hit(float cx, int slot, FishSize sz, Species sp) {
  G.cursor_x = cx;
  place(slot, cx + 16, sz, sp);
  press();
  for (int i = 0; i < 600 && G.state != ST_HIT_WINDOW; i++) run(1.0f / 60);
}

int main(void) {
  dr_init();
  memset(&NONE_IN, 0, sizeof(NONE_IN));

  game_init(&G, 4242);
  run(1.5f);
  render("01_title");

  game_start(&G); clear_fx();
  run(3.0f);
  G.cursor_x = 230;
  for (int i = 0; i < 4; i++) place(i, 60 + i * 80, (FishSize)(i % 3), SP_FUNA);
  place(4, 330, SZ_LARGE, SP_KOI);
  render("02_aiming");

  press(); run(0.2f);
  render("03_casting");

  game_start(&G); clear_fx();
  G.cursor_x = 250;
  place(2, 268, SZ_MEDIUM, SP_BASS);
  press(); for (int i = 0; i < 600 && G.state != ST_WAIT_BITE; i++) run(1.0f / 60);
  run(0.2f);
  render("04_wait_bite");
  for (int i = 0; i < 600 && G.state == ST_WAIT_BITE && !game_feint_active(&G); i++) run(1.0f / 60);
  run(0.1f);
  render("04b_feint");
  for (int i = 0; i < 600 && G.state != ST_HIT_WINDOW; i++) run(1.0f / 60);
  run(0.25f);
  render("05_hit");
  press(); run(0.3f);
  render("05a_fight_start");
  fight_until(is_warn);
  render("05b_fight_warn");
  fight_until(is_rush);
  render("05c_fight_rush");
  fight_until(half_done);
  render("05d_fight_half");
  fight_until(NULL); run(0.4f);
  render("06_caught");

  run(1.0f);
  cast_to_hit(180, 3, SZ_LARGE, SP_GOLD);
  press(); fight_until(NULL); run(0.5f);
  render("07_gold");

  // 糸が切れる
  run(2.0f);
  cast_to_hit(220, 2, SZ_LARGE, SP_NAMAZU);
  press();
  { GameInput h = NONE_IN; h.a_held = true;
    for (int i = 0; i < 600 && G.state == ST_FIGHT; i++) { game_update(&G, 1.0f / 60, &h); handle_events(G.events); update_fx(1.0f / 60); } }
  run(0.2f);
  render("07b_line_break");

  run(2.0f);
  G.cursor_x = 300; place(1, 302, SZ_SMALL, SP_MEDAKA);
  press(); run(0.5f);
  render("08_missed");

  run(1.0f);
  G.time_left = 8.4f;
  render("09_warning");

  GameInput st = NONE_IN; st.start = true;
  game_update(&G, 1.0f / 60, &st);
  render("10_pause");
  game_update(&G, 1.0f / 60, &st);

  // 結果画面（いくつか釣ってから時間切れ）
  game_start(&G); clear_fx();
  const Species sps[5] = { SP_NISHIKI, SP_KOI, SP_MEDAKA, SP_BOOT, SP_FUNA };
  for (int k = 0; k < 5; k++) { cast_to_hit(120 + k * 40, k, k == 0 ? SZ_LARGE : SZ_MEDIUM, sps[k]); press(); fight_until(NULL); run(1.2f); }
  G.casts += 2;
  G.time_left = 0.01f; run(0.1f);
  render("11_timeup");
  run(1.5f);
  render("12_result");

  // 釣果カード（全魚種）
  for (int k = 0; k < SP_COUNT; k++) {
    char name[32];
    G.state = ST_CAUGHT; G.state_t = 0.5f; G.last_species = (Species)k; G.last_points = SPECIES_POINTS[k];
    snprintf(name, sizeof(name), "card_%d", k);
    render(name);
  }
  return 0;
}
