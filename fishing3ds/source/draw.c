// Canvas 2D 風の簡易描画レイヤー
#include "draw.h"
#include <citro2d.h>
#include <math.h>
#include <string.h>

#define PI_F   3.14159265f
#define TAU_F  6.28318531f

// 3DS 内蔵フォントの基準サイズ（scale=1 のときのおおよその em サイズ）
#define FONT_EM        26.0f
// 画面上で読めるようにするための最小文字サイズ（画面ピクセル）
#define MIN_TEXT_PX    8.0f

typedef struct { float a, b, c, d, e, f; float alpha; } DrState;

static DrState cur;
static DrState stack[32];
static int sp = 0;
static C2D_TextBuf tbuf;

void dr_init(void) { tbuf = C2D_TextBufNew(4096); dr_reset(); }
void dr_exit(void) { C2D_TextBufDelete(tbuf); }
void dr_frame_begin(void) { C2D_TextBufClear(tbuf); sp = 0; dr_reset(); }

void dr_reset(void) {
  cur.a = 1; cur.b = 0; cur.c = 0; cur.d = 1; cur.e = 0; cur.f = 0; cur.alpha = 1;
}
void dr_save(void)    { if (sp < 32) stack[sp++] = cur; }
void dr_restore(void) { if (sp > 0) cur = stack[--sp]; }

void dr_translate(float x, float y) {
  cur.e += cur.a * x + cur.c * y;
  cur.f += cur.b * x + cur.d * y;
}
void dr_scale(float sx, float sy) {
  cur.a *= sx; cur.b *= sx; cur.c *= sy; cur.d *= sy;
}
void dr_rotate(float r) {
  float cs = cosf(r), sn = sinf(r);
  float na = cur.a * cs + cur.c * sn, nb = cur.b * cs + cur.d * sn;
  float nc = cur.c * cs - cur.a * sn, nd = cur.d * cs - cur.b * sn;
  cur.a = na; cur.b = nb; cur.c = nc; cur.d = nd;
}
void  dr_set_alpha(float a) { cur.alpha = a < 0 ? 0 : (a > 1 ? 1 : a); }
float dr_get_alpha(void)    { return cur.alpha; }

u32 shade(u32 rgba, int amt) {
  int r = (rgba >> 24) & 0xFF, g = (rgba >> 16) & 0xFF, b = (rgba >> 8) & 0xFF;
  r += amt; g += amt; b += amt;
  r = r < 0 ? 0 : (r > 255 ? 255 : r);
  g = g < 0 ? 0 : (g > 255 ? 255 : g);
  b = b < 0 ? 0 : (b > 255 ? 255 : b);
  return ((u32)r << 24) | ((u32)g << 16) | ((u32)b << 8) | (rgba & 0xFF);
}

// ---------------------------------------------------------------
//  内部ユーティリティ
// ---------------------------------------------------------------
static inline void tf(float x, float y, float *ox, float *oy) {
  *ox = cur.a * x + cur.c * y + cur.e;
  *oy = cur.b * x + cur.d * y + cur.f;
}
static inline float cur_scale(void) {
  float det = cur.a * cur.d - cur.b * cur.c;
  return sqrtf(fabsf(det));
}
static inline u32 to_c2d(u32 rgba) {
  u32 r = (rgba >> 24) & 0xFF, g = (rgba >> 16) & 0xFF, b = (rgba >> 8) & 0xFF;
  u32 a = (u32)((rgba & 0xFF) * cur.alpha + 0.5f);
  return C2D_Color32(r, g, b, a);
}
static inline void raw_tri(float x0, float y0, float x1, float y1, float x2, float y2, u32 col) {
  float ax, ay, bx, by, cx, cy;
  tf(x0, y0, &ax, &ay); tf(x1, y1, &bx, &by); tf(x2, y2, &cx, &cy);
  C2D_DrawTriangle(ax, ay, col, bx, by, col, cx, cy, col, 0);
}
// 半径（ローカル）と角度幅から分割数を決める
static int seg_count(float r, float sweep) {
  float rs = r * cur_scale();
  int full = (int)(rs * 0.8f) + 8;
  if (full < 10) full = 10;
  if (full > 40) full = 40;
  int n = (int)ceilf(full * sweep / TAU_F);
  return n < 3 ? 3 : n;
}
// canvas と同じ規則で掃引角を求める（anticlockwise=false）
static float sweep_of(float a0, float a1) {
  float s = a1 - a0;
  if (s >= TAU_F) return TAU_F;
  s = fmodf(s, TAU_F);
  if (s <= 0) s += TAU_F;
  return s;
}
static inline void ell_pt(float cx, float cy, float rx, float ry, float cr, float sr, float t, float *x, float *y) {
  float px = rx * cosf(t), py = ry * sinf(t);
  *x = cx + px * cr - py * sr;
  *y = cy + px * sr + py * cr;
}
static float local_lw(float lw) {
  float s = cur_scale();
  if (s > 0 && lw * s < 1.0f) lw = 1.0f / s;
  return lw;
}

// ---------------------------------------------------------------
//  塗り
// ---------------------------------------------------------------
void dr_tri(float x0, float y0, float x1, float y1, float x2, float y2, u32 c) {
  raw_tri(x0, y0, x1, y1, x2, y2, to_c2d(c));
}
void dr_rect(float x, float y, float w, float h, u32 c) {
  u32 col = to_c2d(c);
  raw_tri(x, y, x + w, y, x + w, y + h, col);
  raw_tri(x, y, x + w, y + h, x, y + h, col);
}
void dr_rect_vgrad(float x, float y, float w, float h, u32 top, u32 bottom) {
  u32 ct = to_c2d(top), cb = to_c2d(bottom);
  float ax, ay, bx, by, cx, cy, dx, dy;
  tf(x, y, &ax, &ay); tf(x + w, y, &bx, &by);
  tf(x + w, y + h, &cx, &cy); tf(x, y + h, &dx, &dy);
  C2D_DrawTriangle(ax, ay, ct, bx, by, ct, cx, cy, cb, 0);
  C2D_DrawTriangle(ax, ay, ct, cx, cy, cb, dx, dy, cb, 0);
}
void dr_ellipse(float cx, float cy, float rx, float ry, float rot, float a0, float a1, u32 c) {
  u32 col = to_c2d(c);
  float sw = sweep_of(a0, a1);
  int n = seg_count(rx > ry ? rx : ry, sw);
  float cr = cosf(rot), sr = sinf(rot);
  float px, py; ell_pt(cx, cy, rx, ry, cr, sr, a0, &px, &py);
  for (int i = 1; i <= n; i++) {
    float t = a0 + sw * i / n, nx, ny;
    ell_pt(cx, cy, rx, ry, cr, sr, t, &nx, &ny);
    raw_tri(cx, cy, px, py, nx, ny, col);
    px = nx; py = ny;
  }
}
void dr_circle(float cx, float cy, float r, u32 c) { dr_ellipse(cx, cy, r, r, 0, 0, TAU_F, c); }

void dr_round_rect(float x, float y, float w, float h, float r, u32 c) {
  if (r * 2 > w) r = w / 2;
  if (r * 2 > h) r = h / 2;
  dr_rect(x + r, y, w - 2 * r, h, c);
  dr_rect(x, y + r, r, h - 2 * r, c);
  dr_rect(x + w - r, y + r, r, h - 2 * r, c);
  dr_ellipse(x + r,     y + r,     r, r, 0, PI_F,        PI_F * 1.5f, c);
  dr_ellipse(x + w - r, y + r,     r, r, 0, PI_F * 1.5f, TAU_F,       c);
  dr_ellipse(x + w - r, y + h - r, r, r, 0, 0,           PI_F * 0.5f, c);
  dr_ellipse(x + r,     y + h - r, r, r, 0, PI_F * 0.5f, PI_F,        c);
}
void dr_poly(const float *p, int n, u32 c) {
  u32 col = to_c2d(c);
  for (int i = 1; i + 1 < n; i++)
    raw_tri(p[0], p[1], p[i * 2], p[i * 2 + 1], p[i * 2 + 2], p[i * 2 + 3], col);
}
void dr_star(float cx, float cy, float ro, float ri, int points, u32 c) {
  u32 col = to_c2d(c);
  int n = points * 2;
  for (int i = 0; i < n; i++) {
    float a0 = i * PI_F / points - PI_F / 2, a1 = (i + 1) * PI_F / points - PI_F / 2;
    float r0 = (i % 2 == 0) ? ro : ri, r1 = ((i + 1) % 2 == 0) ? ro : ri;
    raw_tri(cx, cy, cx + cosf(a0) * r0, cy + sinf(a0) * r0, cx + cosf(a1) * r1, cy + sinf(a1) * r1, col);
  }
}

// ---------------------------------------------------------------
//  線
// ---------------------------------------------------------------
static void seg_quad(float x0, float y0, float x1, float y1, float hw, u32 col) {
  float dx = x1 - x0, dy = y1 - y0, len = sqrtf(dx * dx + dy * dy);
  if (len < 1e-4f) return;
  float nx = -dy / len * hw, ny = dx / len * hw;
  raw_tri(x0 + nx, y0 + ny, x1 + nx, y1 + ny, x1 - nx, y1 - ny, col);
  raw_tri(x0 + nx, y0 + ny, x1 - nx, y1 - ny, x0 - nx, y0 - ny, col);
}
void dr_line(float x0, float y0, float x1, float y1, float lw, u32 c) {
  seg_quad(x0, y0, x1, y1, local_lw(lw) / 2, to_c2d(c));
}
void dr_polyline(const float *p, int n, float lw, u32 c) {
  u32 col = to_c2d(c);
  float hw = local_lw(lw) / 2;
  for (int i = 0; i + 1 < n; i++) seg_quad(p[i * 2], p[i * 2 + 1], p[i * 2 + 2], p[i * 2 + 3], hw, col);
}
void dr_rect_stroke(float x, float y, float w, float h, float lw, u32 c) {
  float l = local_lw(lw), hl = l / 2;
  dr_rect(x - hl, y - hl, w + l, l, c);
  dr_rect(x - hl, y + h - hl, w + l, l, c);
  dr_rect(x - hl, y + hl, l, h - l, c);
  dr_rect(x + w - hl, y + hl, l, h - l, c);
}
void dr_arc_stroke(float cx, float cy, float rx, float ry, float rot, float a0, float a1, float lw, u32 c) {
  u32 col = to_c2d(c);
  float hw = local_lw(lw) / 2;
  float sw = sweep_of(a0, a1);
  int n = seg_count(rx > ry ? rx : ry, sw);
  float cr = cosf(rot), sr = sinf(rot);
  for (int i = 0; i < n; i++) {
    float t0 = a0 + sw * i / n, t1 = a0 + sw * (i + 1) / n;
    float ct0 = cosf(t0), st0 = sinf(t0), ct1 = cosf(t1), st1 = sinf(t1);
    // 内側・外側の4点で台形を作る
    float ox0 = (rx + hw) * ct0, oy0 = (ry + hw) * st0, ix0 = (rx - hw) * ct0, iy0 = (ry - hw) * st0;
    float ox1 = (rx + hw) * ct1, oy1 = (ry + hw) * st1, ix1 = (rx - hw) * ct1, iy1 = (ry - hw) * st1;
    #define RX(px, py) (cx + (px) * cr - (py) * sr)
    #define RY(px, py) (cy + (px) * sr + (py) * cr)
    raw_tri(RX(ox0, oy0), RY(ox0, oy0), RX(ox1, oy1), RY(ox1, oy1), RX(ix1, iy1), RY(ix1, iy1), col);
    raw_tri(RX(ox0, oy0), RY(ox0, oy0), RX(ix1, iy1), RY(ix1, iy1), RX(ix0, iy0), RY(ix0, iy0), col);
    #undef RX
    #undef RY
  }
}
void dr_arc_dash(float cx, float cy, float r, float lw, float on, float off, u32 c) {
  float circ = TAU_F * r, pos = 0;
  while (pos < circ) {
    float end = pos + on; if (end > circ) end = circ;
    dr_arc_stroke(cx, cy, r, r, 0, pos / r, end / r, lw, c);
    pos += on + off;
  }
}
void dr_quad_stroke(float x0, float y0, float qx, float qy, float x1, float y1, float lw, u32 c) {
  float pts[2 * 9];
  for (int i = 0; i <= 8; i++) {
    float t = i / 8.0f, u = 1 - t;
    pts[i * 2]     = u * u * x0 + 2 * u * t * qx + t * t * x1;
    pts[i * 2 + 1] = u * u * y0 + 2 * u * t * qy + t * t * y1;
  }
  dr_polyline(pts, 9, lw, c);
}

// ---------------------------------------------------------------
//  テキスト
// ---------------------------------------------------------------
static float text_screen_px(float px) {
  float s = px * cur_scale();
  return s < MIN_TEXT_PX ? MIN_TEXT_PX : s;
}
void dr_text(const char *s, float x, float y, float px, u32 c, int align, int base) {
  C2D_Text t;
  C2D_TextParse(&t, tbuf, s);
  C2D_TextOptimize(&t);
  float spx = text_screen_px(px);
  float sc = spx / FONT_EM;
  float w, h;
  C2D_TextGetDimensions(&t, sc, sc, &w, &h);
  float X, Y; tf(x, y, &X, &Y);
  if (align == AL_CENTER) X -= w / 2;
  else if (align == AL_RIGHT) X -= w;
  if (base == BL_MIDDLE) Y -= h / 2;
  else if (base == BL_BOTTOM) Y -= h;
  C2D_DrawText(&t, C2D_WithColor, X, Y, 0, sc, sc, to_c2d(c));
}
float dr_text_width(const char *s, float px) {
  C2D_Text t;
  C2D_TextParse(&t, tbuf, s);
  float spx = text_screen_px(px);
  float sc = spx / FONT_EM;
  float w, h;
  C2D_TextGetDimensions(&t, sc, sc, &w, &h);
  float cs = cur_scale();
  return cs > 0 ? w / cs : w;
}
