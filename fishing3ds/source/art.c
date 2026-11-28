// ================================================================
//  魚のイラスト（簡易ドット絵風。色・体形・模様で魚種を見分けられるようにする）
// ================================================================
#include "art.h"
#include "draw.h"
#include <math.h>

#define PI_F  3.14159265f
#define TAU_F 6.28318531f
#define RGB(h) ((((u32)(h)) << 8) | 0xFFu)

typedef struct {
  float rx, ry;          // 胴体の半径
  u32   body, belly, fin, outline;
  float eye_r;
} Body;

// 尾びれ・背びれ・胴体・腹・目をまとめて描く
static void fish_base(const Body *b, float wag) {
  float rx = b->rx, ry = b->ry;
  // 尾びれ（輪郭→本体）
  dr_save();
  dr_translate(-rx + 3, 0);
  dr_rotate(wag);
  dr_tri(1.5f, 0, -15, -ry * 0.95f - 1.5f, -15, ry * 0.95f + 1.5f, b->outline);
  dr_tri(0, 0, -13.5f, -ry * 0.95f, -13.5f, ry * 0.95f, b->fin);
  dr_restore();
  // 背びれ・腹びれ
  dr_tri(-rx * 0.45f, -ry + 1.5f, rx * 0.25f, -ry + 1.5f, -rx * 0.2f, -ry - 7.5f, b->outline);
  dr_tri(-rx * 0.4f, -ry + 2, rx * 0.2f, -ry + 2, -rx * 0.2f, -ry - 6, b->fin);
  dr_tri(-rx * 0.1f, ry - 1, rx * 0.25f, ry - 1, -rx * 0.05f, ry + 5, b->fin);
  // 胴体
  dr_ellipse(0, 0, rx + 1.3f, ry + 1.3f, 0, 0, TAU_F, b->outline);
  dr_ellipse(0, 0, rx, ry, 0, 0, TAU_F, b->body);
  dr_ellipse(rx * 0.05f, ry * 0.42f, rx * 0.78f, ry * 0.5f, 0, 0, TAU_F, b->belly);
}

static void fish_eye(const Body *b, float ex, float ey) {
  dr_circle(ex, ey, b->eye_r + 0.6f, b->outline);
  dr_circle(ex, ey, b->eye_r, RGB(0xFFFFFF));
  dr_circle(ex + b->eye_r * 0.2f, ey, b->eye_r * 0.55f, RGB(0x111111));
  dr_circle(ex - b->eye_r * 0.15f, ey - b->eye_r * 0.35f, b->eye_r * 0.22f, RGB(0xFFFFFF));
}

static void gill(const Body *b, float x) {
  dr_arc_stroke(x, 0, b->ry * 0.45f, b->ry * 0.8f, 0, -1.1f, 1.1f, 1.0f, b->outline);
}

static void draw_boot(void) {
  u32 ol = RGB(0x3B2414), main = RGB(0x8B5A2B), dark = RGB(0x5E3A1A);
  dr_round_rect(-15, -19, 19, 28, 3, ol);
  dr_round_rect(-14, -18, 17, 26, 2.5f, main);
  dr_round_rect(-15, 2, 36, 13, 5, ol);
  dr_round_rect(-14, 3, 34, 11, 4.5f, main);
  dr_rect(-15, 12, 36, 4, dark);
  dr_rect(-16, -20, 21, 4, dark);            // 口のふち
  for (int i = 0; i < 3; i++) dr_line(-8, -10 + i * 5, -2, -12 + i * 5, 1.2f, RGB(0xE8D8B0)); // ひも
  dr_circle(14, 5, 1.6f, RGB(0x6FA8DC));    // しずく
  dr_circle(-17, -12, 1.3f, RGB(0x6FA8DC));
}

void art_draw_fish(Species sp, float cx, float cy, float s, float t) {
  float wag = sinf(t * 7.0f) * 0.18f;
  dr_save();
  dr_translate(cx, cy);
  dr_scale(s, s);

  Body b;
  switch (sp) {
    case SP_MEDAKA:
      b = (Body){ 19, 7, RGB(0xF2C46D), RGB(0xFBE6B5), RGB(0xE8A848), RGB(0x8A5A1E), 3.6f };
      fish_base(&b, wag);
      dr_line(-14, -1, 10, -1, 1.0f, RGB(0xD49A3E));
      fish_eye(&b, 11, -1.5f);
      break;

    case SP_FUNA:
      b = (Body){ 22, 12, RGB(0x8E9C6C), RGB(0xD8DCC4), RGB(0x6F7C50), RGB(0x3E4630), 2.6f };
      fish_base(&b, wag);
      for (int r = 0; r < 2; r++)
        for (int c = 0; c < 4; c++)
          dr_arc_stroke(-10 + c * 6 + r * 3, -4 + r * 5, 3, 3, 0, -1.2f, 1.2f, 0.8f, RGB(0x6F7C50));
      gill(&b, 10);
      fish_eye(&b, 14, -3);
      break;

    case SP_BLUEGILL:
      b = (Body){ 20, 14, RGB(0x4E7EA0), RGB(0xF0A040), RGB(0x3B6380), RGB(0x1F3346), 2.6f };
      fish_base(&b, wag);
      for (int i = 0; i < 5; i++) dr_rect(-14 + i * 6, -11 + (i == 0 || i == 4 ? 3 : 0), 2.5f, 15 - (i == 0 || i == 4 ? 4 : 0), RGB(0x34607E));
      dr_ellipse(8, -1, 3.4f, 3, 0, 0, TAU_F, RGB(0x10202E));   // エラぶたの黒い斑点
      fish_eye(&b, 13, -4);
      break;

    case SP_BASS:
      b = (Body){ 26, 11, RGB(0x5E8C3A), RGB(0xE8E6C8), RGB(0x4A7030), RGB(0x24381A), 2.8f };
      fish_base(&b, wag);
      for (int i = 0; i < 6; i++) dr_ellipse(-18 + i * 6.5f, -0.5f + ((i & 1) ? 1 : -1), 3.4f, 2.2f, 0, 0, TAU_F, RGB(0x2F4A1E));
      dr_line(17, 3, 27, 1.5f, 1.6f, RGB(0x24381A));    // 大きな口
      gill(&b, 12);
      fish_eye(&b, 18, -4);
      break;

    case SP_KOI:
      b = (Body){ 26, 12, RGB(0xA97A2E), RGB(0xE8C87A), RGB(0x8A6022), RGB(0x4A3210), 2.6f };
      fish_base(&b, wag);
      for (int r = 0; r < 3; r++)
        for (int c = 0; c < 5; c++)
          dr_arc_stroke(-16 + c * 6 + (r & 1) * 3, -6 + r * 4.5f, 3, 2.6f, 0, -1.3f, 1.3f, 0.8f, RGB(0x7A5418));
      dr_line(25, 2, 29, 6, 1.0f, RGB(0x4A3210));       // ひげ
      gill(&b, 14);
      fish_eye(&b, 18, -3.5f);
      break;

    case SP_NISHIKI:
      b = (Body){ 26, 12, RGB(0xFBFAF4), RGB(0xFFFFFF), RGB(0xF6D8C8), RGB(0x8A6A5A), 2.6f };
      fish_base(&b, wag);
      dr_ellipse(-8, -4, 9, 6, 0.2f, 0, TAU_F, RGB(0xE0402A));
      dr_ellipse(10, -6, 6, 4.5f, -0.2f, 0, TAU_F, RGB(0xE0402A));
      dr_ellipse(-18, 1, 4, 3.5f, 0, 0, TAU_F, RGB(0xE0402A));
      dr_ellipse(2, 3, 4, 2.6f, 0, 0, TAU_F, RGB(0x202020));
      dr_line(25, 2, 29, 6, 1.0f, RGB(0x8A6A5A));
      fish_eye(&b, 18, -3.5f);
      break;

    case SP_NAMAZU: {
      b = (Body){ 30, 9, RGB(0x4E4C3C), RGB(0x8E8C76), RGB(0x3A382C), RGB(0x1E1D16), 1.8f };
      // 丸い尾びれ
      dr_ellipse(-31, 0, 8, 8, 0, 0, TAU_F, b.outline);
      dr_ellipse(-31, 0, 7, 7, 0, 0, TAU_F, b.fin);
      // 輪郭を先に両方描いてから塗る（頭と胴の境目に線が出ないように）
      dr_ellipse(0, 0, b.rx + 1.3f, b.ry + 1.3f, 0, 0, TAU_F, b.outline);
      dr_ellipse(8, 0, 22, 11, 0, 0, TAU_F, b.outline);          // 平たい大きな頭
      dr_ellipse(0, 0, b.rx, b.ry, 0, 0, TAU_F, b.body);
      dr_ellipse(8, 0, 21, 10, 0, 0, TAU_F, b.body);
      dr_ellipse(4, 4.5f, 20, 4.5f, 0, 0, TAU_F, b.belly);
      for (int i = 0; i < 5; i++) dr_circle(-18 + i * 7, -3 + (i & 1) * 2, 1.5f, RGB(0x34322A));
      dr_line(20, 3, 29, 3, 1.5f, b.outline);                     // 口
      float w = sinf(t * 4.0f) * 2.0f;
      dr_quad_stroke(26, 1, 34, -4 + w, 38, 4 + w, 1.1f, RGB(0x2A281E));    // 長いひげ
      dr_quad_stroke(25, 4, 32, 10 - w, 36, 14 - w, 1.1f, RGB(0x2A281E));
      fish_eye(&b, 20, -4);
      break;
    }

    case SP_GOLD: {
      b = (Body){ 25, 13, RGB(0xFFD23F), RGB(0xFFF0A0), RGB(0xF2B01E), RGB(0xA0700E), 2.8f };
      fish_base(&b, wag);
      for (int r = 0; r < 3; r++)
        for (int c = 0; c < 5; c++)
          dr_arc_stroke(-16 + c * 6 + (r & 1) * 3, -6 + r * 4.5f, 3, 2.6f, 0, -1.3f, 1.3f, 0.8f, RGB(0xE09A10));
      dr_ellipse(-4, -6, 12, 2.4f, -0.1f, 0, TAU_F, RGB(0xFFFBE0));   // つや
      gill(&b, 13);
      fish_eye(&b, 17, -3.5f);
      float tw = 0.5f + 0.5f * sinf(t * 9.0f);
      dr_star(-12, -13, 3 + tw * 2, 1.2f, 4, RGB(0xFFFFFF));
      dr_star(20, 10, 2 + (1 - tw) * 2, 0.9f, 4, RGB(0xFFFFFF));
      break;
    }

    case SP_BOOT:
    default:
      draw_boot();
      break;
  }
  dr_restore();
}
