// ================================================================
//  魚のイラスト（簡易ドット絵風。色・体形・模様で魚種を見分けられるようにする）
// ================================================================
#include "art.h"
#include "draw.h"
#include <math.h>

#define PI_F  3.14159265f
#define TAU_F 6.28318531f
#define RGB(h) ((((u32)(h)) << 8) | 0xFFu)
#define RGBA(h, a) ((((u32)(h)) << 8) | ((u32)(a) & 0xFFu))

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

// ナマズ型（丸い尾・平たい大きな頭・長いひげ）
static void draw_catfish(u32 body, u32 belly, u32 fin, u32 spot, float t) {
  Body b = { 30, 9, body, belly, fin, RGB(0x1E1D16), 1.8f };
  dr_ellipse(-31, 0, 8, 8, 0, 0, TAU_F, b.outline);
  dr_ellipse(-31, 0, 7, 7, 0, 0, TAU_F, b.fin);
  // 輪郭を先に両方描いてから塗る（頭と胴の境目に線が出ないように）
  dr_ellipse(0, 0, b.rx + 1.3f, b.ry + 1.3f, 0, 0, TAU_F, b.outline);
  dr_ellipse(8, 0, 22, 11, 0, 0, TAU_F, b.outline);
  dr_ellipse(0, 0, b.rx, b.ry, 0, 0, TAU_F, b.body);
  dr_ellipse(8, 0, 21, 10, 0, 0, TAU_F, b.body);
  dr_ellipse(4, 4.5f, 20, 4.5f, 0, 0, TAU_F, b.belly);
  for (int i = 0; i < 5; i++) dr_circle(-18 + i * 7, -3 + (i & 1) * 2, 1.5f, spot);
  dr_line(20, 3, 29, 3, 1.5f, b.outline);
  float w = sinf(t * 4.0f) * 2.0f;
  dr_quad_stroke(26, 1, 34, -4 + w, 38, 4 + w, 1.1f, RGB(0x2A281E));
  dr_quad_stroke(25, 4, 32, 10 - w, 36, 14 - w, 1.1f, RGB(0x2A281E));
  fish_eye(&b, 20, -4);
}

// 描いたときのおおよその横幅と中心のずれ（scale=1）。釣果表のマスに収めるために使う
static const float ART_WIDTH[SP_COUNT] = {
  54, 48, 54, 60, 54,   56, 52, 58, 46, 68,
  50, 60, 60, 64, 68,   66, 64, 76, 74, 68,
  78, 88, 78, 66, 40,
};
float art_width(Species sp) { return ART_WIDTH[sp]; }

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

    case SP_NAMAZU:
      draw_catfish(RGB(0x4E4C3C), RGB(0x8E8C76), RGB(0x3A382C), RGB(0x34322A), t);
      break;
    case SP_NAMAZU_S:
      dr_scale(0.85f, 0.85f);
      draw_catfish(RGB(0x7A6A44), RGB(0xC8BC96), RGB(0x5E5034), RGB(0x4A3E26), t);
      break;

    // ---------------- 追加の魚たち ----------------
    case SP_MOTSUGO:
      b = (Body){ 16, 6, RGB(0xA4A884), RGB(0xE4E6D4), RGB(0x8A8E6A), RGB(0x3E4230), 2.4f };
      fish_base(&b, wag);
      dr_rect(-14, -1, 25, 2.2f, RGB(0x45483A));           // 体側の黒い縦帯
      fish_eye(&b, 10, -1.5f);
      break;

    case SP_WAKASAGI:
      b = (Body){ 19, 5, RGB(0xC7D3DB), RGB(0xF4F7FA), RGB(0xAFC0CC), RGB(0x5E7080), 2.6f };
      fish_base(&b, wag);
      dr_line(-15, 0, 12, -0.5f, 1.2f, RGB(0x7FA3C0));      // 銀青色の体側線
      for (int i = 0; i < 5; i++) dr_circle(-12 + i * 5, -3, 0.6f, RGB(0x7A8A96));
      fish_eye(&b, 12, -1);
      break;

    case SP_OIKAWA:
      b = (Body){ 19, 7, RGB(0x6FAAB2), RGB(0xF4E2D8), RGB(0xF08A5A), RGB(0x2F4E58), 2.6f };
      fish_base(&b, wag);
      for (int i = 0; i < 5; i++) dr_rect(-13 + i * 5, -5, 2.2f, 9, RGB(0xF07C6A));   // 婚姻色の横じま
      fish_eye(&b, 12, -2);
      break;

    case SP_DOJOU: {
      u32 ol = RGB(0x4A3A1E);
      dr_ellipse(-21, 0, 5, 4, 0, 0, TAU_F, ol);
      dr_ellipse(-21, 0, 4, 3, 0, 0, TAU_F, RGB(0x9A7E48));     // 丸い尾びれ
      dr_ellipse(0, 0, 21.3f, 5.8f, 0, 0, TAU_F, ol);
      dr_ellipse(0, 0, 20, 4.5f, 0, 0, TAU_F, RGB(0xB89A60));
      dr_ellipse(1, 2, 17, 2, 0, 0, TAU_F, RGB(0xE6D6A8));
      for (int i = 0; i < 9; i++) dr_circle(-16 + i * 4, -1.5f + (i % 2) * 0.8f, 0.8f, RGB(0x5E4A26));
      for (int i = 0; i < 3; i++) dr_line(19, 1, 25, -1 + i * 2.5f, 0.8f, ol);   // ひげ
      dr_circle(15, -1.5f, 1.4f, RGB(0x111111));
      break;
    }

    case SP_UGUI:
      b = (Body){ 21, 8, RGB(0xA9B5B9), RGB(0xEEF1F2), RGB(0xD07060), RGB(0x3E484E), 2.6f };
      fish_base(&b, wag);
      dr_rect(-15, -1, 27, 2.2f, RGB(0xE0503A));            // 赤い婚姻色の帯
      dr_rect(-11, 3, 20, 1.8f, RGB(0xE0503A));
      fish_eye(&b, 14, -3);
      break;

    case SP_TANAGO:
      b = (Body){ 15, 9.5f, RGB(0xB8C2DE), RGB(0xF6C6D8), RGB(0xE07AA0), RGB(0x45507A), 2.4f };
      fish_base(&b, wag);
      dr_ellipse(1, -3, 9, 3, 0, 0, TAU_F, RGB(0xD7A8D6));  // 紫のつや
      dr_rect(-14, -0.5f, 14, 2, RGB(0x3FA9A0));             // 青緑の縦帯
      fish_eye(&b, 9, -3);
      break;

    case SP_KAJIKA:
      b = (Body){ 17, 6, RGB(0x8A7452), RGB(0xD6C8A6), RGB(0x6E5A3E), RGB(0x3A2E1E), 2.3f };
      fish_base(&b, wag);
      dr_ellipse(6, 0, 11.3f, 8.3f, 0, 0, TAU_F, b.outline);   // 大きな頭
      dr_ellipse(6, 0, 10, 7, 0, 0, TAU_F, b.body);
      dr_ellipse(3, 5, 8, 4, 0.5f, 0, TAU_F, b.fin);          // 大きな胸びれ
      for (int i = 0; i < 4; i++) dr_ellipse(-12 + i * 7, -1 + (i & 1) * 2, 2.8f, 2.2f, 0, 0, TAU_F, RGB(0x5A4A30));
      fish_eye(&b, 11, -5);
      break;

    case SP_AYU:
      b = (Body){ 22, 7, RGB(0x9CA66E), RGB(0xF0EAD0), RGB(0xD8C060), RGB(0x3E4428), 2.5f };
      fish_base(&b, wag);
      dr_ellipse(-2, -4, 16, 2.5f, 0, 0, TAU_F, RGB(0x7C8650));  // 背中の濃い色
      dr_ellipse(8, -1, 3, 2, 0, 0, TAU_F, RGB(0xFFD84A));        // 胸の黄色い斑点
      fish_eye(&b, 15, -2);
      break;

    case SP_YAMAME:
      b = (Body){ 22, 8, RGB(0xC8BC96), RGB(0xF6ECE6), RGB(0xA49E74), RGB(0x4A4632), 2.6f };
      fish_base(&b, wag);
      for (int i = 0; i < 6; i++) dr_ellipse(-15 + i * 5.5f, 0, 1.9f, 3.6f, 0, 0, TAU_F, RGB(0x5E5E86));  // パーマーク
      for (int i = 0; i < 5; i++) dr_circle(-12 + i * 6, -5, 0.8f, RGB(0x3E3A2A));
      fish_eye(&b, 15, -3);
      break;

    case SP_NIJIMASU:
      b = (Body){ 24, 9, RGB(0x8CA888), RGB(0xF2F0EA), RGB(0x7A9478), RGB(0x34442E), 2.7f };
      fish_base(&b, wag);
      dr_ellipse(-1, 1, 20, 2.6f, 0, 0, TAU_F, RGB(0xE88AA0));   // 虹色（ピンク）の帯
      for (int i = 0; i < 10; i++) dr_circle(-18 + i * 4, -5 + (i % 3) * 1.3f, 0.8f, RGB(0x202020));
      fish_eye(&b, 17, -3);
      break;

    case SP_IWANA:
      b = (Body){ 24, 8, RGB(0x5E6A50), RGB(0xF0C890), RGB(0xE0904A), RGB(0x2A3022), 2.6f };
      fish_base(&b, wag);
      for (int i = 0; i < 12; i++) dr_circle(-18 + i * 3.4f, -4 + (i % 3) * 2.5f, 1.1f, RGB(0xEFE8CC));  // 白い斑点
      fish_eye(&b, 17, -3);
      break;

    case SP_RAIGYO: {
      b = (Body){ 30, 7.5f, RGB(0x7A6440), RGB(0xD8C8A0), RGB(0x5E4C30), RGB(0x2E2416), 2.4f };
      // 長い背びれと尻びれ（胴より少し大きい楕円を先に描き、胴からはみ出た部分をひれに見せる）
      dr_ellipse(-5, -1.5f, 26.5f, b.ry + 4.3f, 0, 0, TAU_F, b.outline);
      dr_ellipse(-5, -1.5f, 25.5f, b.ry + 3.3f, 0, 0, TAU_F, b.fin);
      dr_ellipse(-9, 1.5f, 18, b.ry + 3, 0, 0, TAU_F, b.fin);
      dr_ellipse(-31, 0, 7, 6, 0, 0, TAU_F, b.outline);         // 丸い尾びれ
      dr_ellipse(-31, 0, 6, 5, 0, 0, TAU_F, b.fin);
      dr_ellipse(0, 0, b.rx + 1.3f, b.ry + 1.3f, 0, 0, TAU_F, b.outline);
      dr_ellipse(0, 0, b.rx, b.ry, 0, 0, TAU_F, b.body);
      dr_ellipse(2, 3, 24, 3, 0, 0, TAU_F, b.belly);
      for (int i = 0; i < 6; i++) dr_ellipse(-20 + i * 7, -1 + (i & 1) * 2, 3.2f, 2.6f, 0, 0, TAU_F, RGB(0x3E3020));  // 黒い斑紋
      dr_line(24, 2, 30, 2, 1.4f, b.outline);
      fish_eye(&b, 22, -3);
      break;
    }

    case SP_SOUGYO:
      b = (Body){ 29, 10, RGB(0x8E9478), RGB(0xDCDCC8), RGB(0x6E745A), RGB(0x34382A), 2.6f };
      fish_base(&b, wag);
      for (int r = 0; r < 3; r++)
        for (int c = 0; c < 6; c++)
          dr_arc_stroke(-20 + c * 7 + (r & 1) * 3.5f, -5 + r * 4.5f, 3.6f, 3, 0, -1.3f, 1.3f, 0.9f, RGB(0x5E644A));
      gill(&b, 16);
      fish_eye(&b, 21, -2);
      break;

    case SP_CHOUZAME: {
      u32 ol = RGB(0x2E3640), body = RGB(0x6E7E8E), belly = RGB(0xD8DEE4);
      // 上が長い尾びれ（異尾）
      dr_tri(-28, -1, -46, -14, -40, 4, ol);
      dr_tri(-28, 0, -44, -12, -39, 3, RGB(0x5A6878));
      dr_tri(26, -3.5f, 26, 4.5f, 41, 2, ol);                  // とがった鼻先
      dr_tri(26, -2.5f, 26, 3.5f, 39, 2, body);
      dr_ellipse(0, 0, 33.3f, 8.3f, 0, 0, TAU_F, ol);
      dr_ellipse(0, 0, 32, 7, 0, 0, TAU_F, body);
      dr_ellipse(2, 3.5f, 26, 2.5f, 0, 0, TAU_F, belly);
      for (int i = 0; i < 8; i++) {                               // 背中と体側の硬いうろこ（骨板）
        float x = -24 + i * 6.5f;
        dr_star(x, -5, 1.8f, 0.8f, 4, RGB(0xF0F4F8));
        dr_star(x + 3, 0.5f, 1.4f, 0.6f, 4, RGB(0xE0E6EC));
      }
      for (int i = 0; i < 2; i++) dr_line(31 + i * 3, 4, 31 + i * 3, 8, 0.8f, ol);   // ひげ
      Body e = { 32, 7, body, belly, body, ol, 1.8f };
      fish_eye(&e, 22, -2);
      break;
    }

    case SP_ITOU:
      b = (Body){ 31, 9.5f, RGB(0x9A7464), RGB(0xE8D8CC), RGB(0xB85A40), RGB(0x3E2A22), 2.6f };
      fish_base(&b, wag);
      dr_ellipse(-20, 0, 10, 6, 0, 0, TAU_F, RGB(0xC0685A));    // 尾に近いほど赤い
      for (int i = 0; i < 12; i++) dr_circle(-22 + i * 4, -5 + (i % 3) * 2, 0.9f, RGB(0x2A1A14));
      gill(&b, 18);
      fish_eye(&b, 22, -3);
      break;

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

// ================================================================
//  あそぶ人の顔アイコン（男の子＝青いぼうし、女の子＝ふたつ結び＋リボン）
// ================================================================
static void face_common(u32 skin, u32 line, u32 cheek) {
  // 顔（輪郭→肌）
  dr_ellipse(0, 2.2f, 9.2f, 8.8f, 0, 0, TAU_F, line);
  dr_ellipse(0, 2.2f, 8.4f, 8.0f, 0, 0, TAU_F, skin);
  // ほっぺ
  dr_ellipse(-5.4f, 5.4f, 1.9f, 1.1f, 0, 0, TAU_F, cheek);
  dr_ellipse(5.4f, 5.4f, 1.9f, 1.1f, 0, 0, TAU_F, cheek);
  // 目（ハイライト付き）
  dr_ellipse(-3.3f, 2.6f, 1.25f, 1.55f, 0, 0, TAU_F, RGB(0x2A1A10));
  dr_ellipse(3.3f, 2.6f, 1.25f, 1.55f, 0, 0, TAU_F, RGB(0x2A1A10));
  dr_circle(-2.9f, 2.0f, 0.5f, RGB(0xFFFFFF));
  dr_circle(3.7f, 2.0f, 0.5f, RGB(0xFFFFFF));
  // 口（にっこり）
  dr_arc_stroke(0, 5.4f, 2.3f, 1.7f, 0, 0.25f, PI_F - 0.25f, 0.9f, RGB(0xA0402A));
}

void art_draw_face(Player p, float cx, float cy, float r) {
  const u32 skin = RGB(0xFFDDBE), line = RGB(0x7A4A2A);
  dr_save();
  dr_translate(cx, cy);
  dr_scale(r / 10.0f, r / 10.0f);
  if (p == PL_GIRL) {
    const u32 hair = RGB(0x7A3E1C), hair_d = RGB(0x4E2410), ribbon = RGB(0xFF5A8A);
    // ふたつ結び
    dr_circle(-10.6f, 3.5f, 4.4f, hair_d);
    dr_circle(10.6f, 3.5f, 4.4f, hair_d);
    dr_circle(-10.6f, 3.5f, 3.6f, hair);
    dr_circle(10.6f, 3.5f, 3.6f, hair);
    // 後ろ髪
    dr_ellipse(0, 0.5f, 11.0f, 10.6f, 0, 0, TAU_F, hair_d);
    dr_ellipse(0, 0.5f, 10.2f, 9.8f, 0, 0, TAU_F, hair);
    face_common(skin, line, RGBA(0xFF7A96, 0xC0));
    // 前髪（ぱっつん）
    dr_ellipse(0, -2.4f, 9.4f, 6.6f, 0, PI_F, TAU_F, hair);
    dr_rect(-9.4f, -2.4f, 18.8f, 1.6f, hair);
    // まつげ
    dr_line(-4.4f, 1.2f, -5.4f, 0.4f, 0.7f, RGB(0x2A1A10));
    dr_line(4.4f, 1.2f, 5.4f, 0.4f, 0.7f, RGB(0x2A1A10));
    // リボン
    dr_save(); dr_translate(6.2f, -7.4f); dr_rotate(0.35f);
    dr_tri(0, 0, -5.2f, -3.4f, -5.2f, 3.4f, ribbon);
    dr_tri(0, 0, 5.2f, -3.4f, 5.2f, 3.4f, ribbon);
    dr_circle(0, 0, 1.8f, RGB(0xFFB3C9));
    dr_restore();
  } else {
    const u32 hair = RGB(0x3A2416), cap = RGB(0x2F6FD0), cap_d = RGB(0x1D4A94);
    // 横の髪
    dr_ellipse(0, 0.5f, 10.0f, 9.6f, 0, 0, TAU_F, hair);
    face_common(skin, line, RGBA(0xFF8A80, 0xB0));
    // もみあげ・前髪
    dr_tri(-9.0f, -2.0f, -5.0f, -2.0f, -8.4f, 2.6f, hair);
    dr_tri(9.0f, -2.0f, 5.0f, -2.0f, 8.4f, 2.6f, hair);
    dr_tri(-5.5f, -2.2f, 0.5f, -2.2f, -3.0f, 0.8f, hair);
    dr_tri(-0.5f, -2.2f, 5.5f, -2.2f, 2.6f, 0.4f, hair);
    // ぼうし（ドーム＋つば）
    dr_ellipse(0, -2.6f, 10.6f, 9.0f, 0, PI_F, TAU_F, cap_d);
    dr_ellipse(0, -2.6f, 9.8f, 8.2f, 0, PI_F, TAU_F, cap);
    dr_round_rect(-11.5f, -3.6f, 23.0f, 3.2f, 1.5f, cap_d);
    dr_circle(0, -10.8f, 1.4f, cap_d);
    // ぼうしのマーク
    dr_star(0, -6.4f, 2.6f, 1.1f, 5, RGB(0xFFE14D));
  }
  dr_restore();
}
