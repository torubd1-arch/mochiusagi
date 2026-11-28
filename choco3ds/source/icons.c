// 帽子・手持ちアイコン（Web版 drawHatIcon / drawHeldIcon の移植）
#include "icons.h"
#include "draw.h"
#include "data.h"
#include <math.h>

#define PI_F  3.14159265f
#define TAU_F 6.28318531f

// ────────────────────────────────────────────────────────────────
//  帽子アイコン 18種
// ────────────────────────────────────────────────────────────────
void draw_hat_icon(int base, u32 col) {
  dr_save();
  u32 c = col;
  u32 d = shade(c, -30);
  u32 l = shade(c, 35);
  switch (base) {
  case HAT_CAP:
    dr_ellipse(0, -2, 18, 11, 0, PI_F, 0, c);
    dr_ellipse(11, 6, 12, 4, 0, 0, TAU_F, d);
    dr_rect(-18, 4, 18, 4, l);
    break;
  case HAT_BEANIE:
    dr_ellipse(0, 0, 19, 13, 0, PI_F, 0, c);
    dr_rect(-19, -1, 38, 7, d);
    for (int i = -12; i <= 12; i += 6) dr_line(i, 0, i, -10, 2.5f, RGBA(0xFFFFFF, 0x66));
    dr_circle(0, -16, 5, RGB(0xFFAAAA));
    break;
  case HAT_TOP_HAT:
    dr_rect(-13, -22, 26, 22, c);
    dr_rect(-13, -22, 26, 4, d);
    dr_rect(-20, 0, 40, 6, l);
    dr_rect(-11, -20, 4, 18, d);
    break;
  case HAT_WIZARD:
    dr_tri(0, -26, -18, 6, 18, 6, c);
    dr_ellipse(0, 6, 22, 6, 0, 0, TAU_F, d);
    dr_star(0, -8, 6, 2.5f, 5, RGB(0xFFFF00));
    break;
  case HAT_HELMET:
    dr_ellipse(0, -2, 21, 15, 0, PI_F, 0, c);
    dr_rect(-21, 8, 42, 6, l);
    dr_rect(-3, -15, 6, 20, d);
    break;
  case HAT_CROWN: {
    const float hw = 20, bandH = 11, spikeH = 15, bTop = -5;
    dr_tri(-hw, bTop, -hw + 13, bTop, -hw + 7, bTop - spikeH, c);
    dr_tri(-7, bTop, 7, bTop, 0, bTop - spikeH * 1.3f, c);
    dr_tri(hw - 13, bTop, hw, bTop, hw - 7, bTop - spikeH, c);
    dr_rect(-hw, bTop, hw * 2, bandH, d);
    dr_rect(-hw + 1, bTop + 1, hw * 2 - 2, bandH - 2, c);
    dr_rect_stroke(-hw, bTop, hw * 2, bandH, 1, RGBA(0x000000, 0x33));
    dr_circle(0, bTop + bandH / 2, 3.5f, RGB(0xCC0000));
    break;
  }
  case HAT_CROWN_PRINCE: {
    const float p[] = { -16, 0, -16, -8, -6, -18, 0, -24, 6, -18, 16, -8, 16, 0 };
    dr_poly(p, 7, c);
    dr_rect(-17, 0, 34, 7, d);
    dr_circle(-8, -4, 3, RGB(0x6644FF));
    dr_circle(8, -4, 3, RGB(0x6644FF));
    dr_circle(0, -6, 3, RGB(0xFF4488));
    break;
  }
  case HAT_CROWN_QUEEN: {
    // ギザギザの多角形を「帯＋三角形3つ」に分解
    dr_rect(-22, -6, 44, 8, c);
    dr_tri(-22, -6, -14, -14, -7, -6, c);
    dr_tri(-7, -6, 0, -14, 7, -6, c);
    dr_tri(7, -6, 14, -14, 22, -6, c);
    dr_rect(-22, 2, 44, 6, d);
    const float g[5][2] = { { -14, -10 }, { -7, -4 }, { 0, -10 }, { 7, -4 }, { 14, -10 } };
    const u32 gc[5] = { RGB(0xFF4466), RGB(0x4466FF), RGB(0xFF44FF), RGB(0xFF4466), RGB(0x4466FF) };
    for (int i = 0; i < 5; i++) dr_circle(g[i][0], g[i][1], 2.5f, gc[i]);
    break;
  }
  case HAT_BERET:
    dr_ellipse(2, -5, 20, 8, 0.3f, 0, TAU_F, c);
    dr_ellipse(0, 0, 12, 4, 0, 0, TAU_F, d);
    dr_circle(14, -10, 3, l);
    break;
  case HAT_COWBOY:
    dr_rect(-12, -20, 24, 20, c);
    dr_rect(-12, -20, 24, 4, d);
    dr_rect(-24, 0, 48, 5, l);
    dr_line(-12, -12, 12, -12, 1.5f, RGB(0xFFDD88));
    break;
  case HAT_NINJA:
    dr_ellipse(0, -8, 18, 12, 0, PI_F, 0, c);
    dr_rect(-18, -8, 36, 8, d);
    dr_rect(-14, -7, 12, 4, RGBA(0x000000, 0x80));
    dr_rect(-12, -6, 8, 2, RGB(0xFFCCAA));
    break;
  case HAT_PIRATE: {
    const float p[] = { -22, 4, -12, -18, 12, -18, 22, 4 };
    dr_poly(p, 4, c);
    dr_rect(-22, 2, 44, 5, d);
    dr_circle(0, -8, 7, RGB(0xFFFFFF));
    dr_circle(-2, -8, 1.5f, c);
    dr_circle(3, -8, 1.5f, c);
    dr_line(-4, -3, 4, -3, 1.2f, c);
    dr_line(-2, -3, -2, -1, 1.2f, c);
    dr_line(2, -3, 2, -1, 1.2f, c);
    break;
  }
  case HAT_CHEF:
    dr_circle(0, -12, 14, c);
    dr_circle(-8, -10, 9, c);
    dr_circle(8, -10, 9, c);
    dr_rect(-13, 0, 26, 6, d);
    for (int i = -10; i <= 10; i += 5) dr_line(i, -22, i, -2, 1, RGBA(0x000000, 0x26));
    break;
  case HAT_SANTA:
    dr_tri(-16, 4, 0, -24, 16, 4, c);
    dr_rect(-18, 2, 36, 6, RGB(0xFFFFFF));
    dr_circle(0, -24, 4, RGB(0xFFFFFF));
    break;
  case HAT_BUNNY:
    dr_ellipse(-7, -16, 5, 12, -0.1f, 0, TAU_F, c);
    dr_ellipse(7, -16, 5, 12, 0.1f, 0, TAU_F, c);
    dr_ellipse(-7, -16, 2.5f, 8, -0.1f, 0, TAU_F, RGB(0xFFAACC));
    dr_ellipse(7, -16, 2.5f, 8, 0.1f, 0, TAU_F, RGB(0xFFAACC));
    dr_rect(-14, -1, 28, 5, d);
    break;
  case HAT_FLOWER:
    for (int k = 0; k < 8; k++) {
      float a = k * PI_F / 4;
      float fx = cosf(a) * 11, fy = sinf(a) * 5 - 8;
      dr_circle(fx, fy, 5, c);
      dr_circle(fx, fy, 2, RGB(0xFFFF88));
    }
    dr_arc_stroke(0, -8, 11, 5, 0, 0, TAU_F, 2, d);
    break;
  case HAT_CAT_EARS:
    dr_rect(-18, 0, 36, 5, d);
    dr_tri(-14, 0, -8, -16, -2, 0, c);
    dr_tri(2, 0, 8, -16, 14, 0, c);
    dr_tri(-12, 0, -8, -10, -4, 0, RGB(0xFFAACC));
    dr_tri(4, 0, 8, -10, 12, 0, RGB(0xFFAACC));
    break;
  case HAT_HEADBAND:
    dr_ellipse(0, -3, 22, 8, 0, PI_F, 0, c);
    dr_rect(-22, -3, 44, 7, c);
    dr_arc_stroke(0, -3, 22, 8, 0, PI_F, 0, 2, l);
    dr_tri(-8, 4, -14, 10, -8, 10, l);
    dr_tri(8, 4, 14, 10, 8, 10, l);
    dr_circle(0, 4, 3, l);
    break;
  }
  dr_restore();
}

// ────────────────────────────────────────────────────────────────
//  手持ちアイコン 18種
// ────────────────────────────────────────────────────────────────
void draw_held_icon(int base, u32 col) {
  dr_save();
  u32 c = col;
  u32 d = shade(c, -30);
  u32 l = shade(c, 35);
  switch (base) {
  case HELD_CONTROLLER:
    dr_ellipse(0, 0, 15, 9, 0, 0, TAU_F, c);
    dr_rect(-9, -2, 7, 4, d);
    dr_rect(-7, -4, 3, 8, d);
    dr_circle(6, -2, 2.5f, RGB(0xFF2222));
    dr_circle(9, 2, 2.5f, RGB(0x2222FF));
    break;
  case HELD_TOTE:
    dr_rect(-12, -8, 24, 20, c);
    dr_rect_stroke(-12, -8, 24, 20, 1.5f, d);
    dr_arc_stroke(0, -8, 9, 9, 0, PI_F, 0, 1.5f, d);
    dr_line(0, -8, 0, 12, 1.5f, d);
    break;
  case HELD_BACKPACK:
    dr_rect(-11, -14, 22, 26, c);
    dr_rect(-8, -10, 16, 10, l);
    dr_rect_stroke(-7, 4, 14, 8, 1.5f, d);
    dr_line(-6, -14, -6, 12, 2, d);
    dr_line(6, -14, 6, 12, 2, d);
    break;
  case HELD_SUITCASE: {
    dr_rect(-13, -10, 26, 22, c);
    dr_rect_stroke(-13, -10, 26, 22, 1.5f, l);
    const float h[] = { -7, -10, -7, -16, 7, -16, 7, -10 };
    dr_polyline(h, 4, 2, l);
    dr_line(0, -10, 0, 12, 1, d);
    dr_line(-13, 1, 13, 1, 1, d);
    break;
  }
  case HELD_BOX:
    dr_rect(-13, -12, 26, 24, c);
    dr_rect_stroke(-13, -12, 26, 24, 1, l);
    dr_line(-13, -12, 13, 12, 2.5f, d);
    dr_line(13, -12, -13, 12, 2.5f, d);
    break;
  case HELD_BICYCLE: {
    dr_arc_stroke(-9, 7, 8, 8, 0, 0, TAU_F, 2, c);
    dr_arc_stroke(9, 7, 8, 8, 0, 0, TAU_F, 2, c);
    const float f[] = { -9, 7, 0, -2, 9, 7 };
    dr_polyline(f, 3, 2, c);
    dr_line(-2, 7, 0, -2, 2, c);
    dr_line(-4, -4, 4, -4, 3, RGB(0x442200));
    const float hb[] = { 6, -4, 12, -4, 12, -2 };
    dr_polyline(hb, 3, 2, c);
    break;
  }
  case HELD_BOBBLEHEAD: {
    dr_circle(0, -6, 11, RGB(0xFFCC88));
    dr_arc_stroke(0, -6, 11, 11, 0, 0, TAU_F, 1, RGB(0xCC9966));
    dr_circle(-4, -8, 2, RGB(0x333333));
    dr_circle(4, -8, 2, RGB(0x333333));
    dr_arc_stroke(0, -4, 3, 3, 0, 0.1f, PI_F - 0.1f, 1.5f, RGB(0x333333));
    const float s[] = { 0, 5, -2, 3, 2, 1 };
    dr_polyline(s, 3, 1.5f, RGB(0x888888));
    dr_rect(-7, 6, 14, 10, c);
    break;
  }
  case HELD_ICECREAM:
    dr_tri(-9, 3, 9, 3, 0, 16, RGB(0xDEB887));
    dr_line(-4.5f, 3, -1, 14, 1, RGB(0xCC9966));
    dr_line(4.5f, 3, 1, 14, 1, RGB(0xCC9966));
    dr_ellipse(0, -4, 9, 9, 0, PI_F, 0, c);
    dr_ellipse(-4, -10, 6, 6, 0, PI_F, 0, l);
    dr_circle(3, -9, 2, RGB(0x884422));
    break;
  case HELD_CAMERA:
    dr_rect(-14, -8, 28, 18, c);
    dr_circle(0, 1, 7, d);
    dr_circle(0, 1, 5, RGB(0xAADDFF));
    dr_circle(-2, -1, 2, RGB(0xFFFFFF));
    dr_rect(-5, -12, 10, 5, d);
    dr_rect(8, -10, 5, 5, RGB(0xFFFF88));
    break;
  case HELD_UMBRELLA:
    dr_ellipse(0, 2, 15, 15, 0, PI_F, 0, c);
    for (int i = -3; i <= 3; i++) dr_ellipse(i * 5, 2, 3.5f, 3.5f, 0, 0, PI_F, d);
    dr_line(0, 2, 0, 16, 2.5f, RGB(0x884422));
    dr_arc_stroke(-3, 16, 3, 3, 0, 0, PI_F, 2.5f, RGB(0x884422));
    break;
  case HELD_BOOK:
    dr_rect(-12, -14, 24, 28, c);
    dr_rect(-12, -14, 4, 28, d);
    for (int i = -8; i <= 8; i += 4) dr_line(-7, i, 11, i, 1, RGB(0xFFEECC));
    dr_rect(-8, -12, 18, 8, l);
    break;
  case HELD_FLOWER:
    dr_line(0, 14, 0, 4, 2, RGB(0x228800));
    dr_ellipse(-5, 8, 6, 3, -0.5f, 0, TAU_F, RGB(0x33AA00));
    for (int k = 0; k < 6; k++) {
      float a = k * PI_F / 3;
      dr_ellipse(cosf(a) * 8, sinf(a) * 8 - 2, 5, 3, a, 0, TAU_F, c);
    }
    dr_circle(0, -2, 5, RGB(0xFFDD00));
    break;
  case HELD_SMARTPHONE:
    dr_rect(-9, -16, 18, 32, c);
    dr_rect(-7, -13, 14, 24, RGB(0x88CCFF));
    dr_circle(0, 13, 2.5f, d);
    dr_circle(0, -14, 1.5f, d);
    break;
  case HELD_FLASHLIGHT: {
    const float p[] = { -9, -8, 9, -8, 7, 0, -7, 0 };
    dr_poly(p, 4, c);
    dr_rect(-6, 0, 12, 16, d);
    dr_circle(0, -5, 6, RGB(0xFFFFCC));
    dr_circle(-2, -7, 2, RGB(0xFFFFFF));
    dr_rect(-6, 15, 12, 3, d);
    break;
  }
  case HELD_MICROPHONE:
    dr_circle(0, -8, 8, c);
    for (float i = -5; i <= 5; i += 2.5f) dr_line(i, -15, i, -1, 1, l);
    dr_rect(-4, 0, 8, 18, d);
    dr_rect(-5, 14, 10, 3, l);
    break;
  case HELD_PLUSH:
    dr_circle(0, 5, 11, c);
    dr_circle(0, -7, 9, c);
    dr_circle(-7, -14, 5, c);
    dr_circle(7, -14, 5, c);
    dr_circle(-7, -14, 3, l);
    dr_circle(7, -14, 3, l);
    dr_circle(-3, -8, 1.5f, RGB(0x333333));
    dr_circle(3, -8, 1.5f, RGB(0x333333));
    dr_circle(0, -5, 2, RGB(0x884422));
    dr_arc_stroke(0, -3, 3, 3, 0, 0.1f, PI_F - 0.1f, 1.5f, RGB(0x333333));
    break;
  case HELD_DONUT: {
    dr_arc_stroke(0, 0, 9, 9, 0, 0, TAU_F, 8, c);
    dr_arc_stroke(0, 0, 13, 13, 0, 0, TAU_F, 2, RGB(0x8B4513));
    dr_arc_stroke(0, 0, 5, 5, 0, 0, TAU_F, 1, RGB(0x8B4513));
    const float sp[6][3] = { { -6, -8, 0 }, { 9, 2, 1 }, { -8, 5, 2 }, { 5, 9, 3 }, { 0, -12, 4 }, { -3, 10, 0 } };
    const u32 cc[5] = { RGB(0xFF2222), RGB(0x2222FF), RGB(0x22BB22), RGB(0xFFFF22), RGB(0xFF88FF) };
    for (int i = 0; i < 6; i++) {
      dr_save();
      dr_translate(sp[i][0], sp[i][1]);
      dr_rotate(0.5f);
      dr_rect(-1, -3.5f, 2, 7, cc[(int)sp[i][2]]);
      dr_restore();
    }
    break;
  }
  case HELD_STAR_WAND:
    dr_rect(-3, 2, 6, 18, c);
    dr_quad_stroke(3, 6, 10, 4, 12, 8, 2, l);
    dr_save();
    dr_translate(0, -6);
    dr_star(0, 0, 12, 5, 5, RGB(0xFFFF00));
    dr_circle(0, 0, 3, RGB(0xFFFFFF));
    dr_restore();
    break;
  }
  dr_restore();
}
