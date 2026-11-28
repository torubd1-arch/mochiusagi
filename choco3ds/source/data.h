// チョコキャッチ！ 3DS版 共通データ定義
// Web版（choco/index.html）の仕様をそのまま移植している
#pragma once
#include <3ds.h>
#include <stdbool.h>

// ---------------------------------------------------------------
//  色ユーティリティ（色はすべて 0xRRGGBBAA で扱う）
// ---------------------------------------------------------------
#define RGB(h)     ((((u32)(h)) << 8) | 0xFFu)
#define RGBA(h, a) ((((u32)(h)) << 8) | ((u32)(a) & 0xFFu))

// ---------------------------------------------------------------
//  カテゴリ・アイテム
// ---------------------------------------------------------------
enum { CAT_BROWN, CAT_PURPLE, CAT_DUMBBELL, CAT_HAT, CAT_HELD };

#define NUM_COLORS 5
#define NUM_BASES  18
#define NUM_IDS    90   // 18ベース × 5色

enum { COL_RED, COL_BLUE, COL_GREEN, COL_BLACK, COL_GOLD };

enum {
  HAT_CAP, HAT_BEANIE, HAT_TOP_HAT, HAT_WIZARD, HAT_HELMET, HAT_CROWN,
  HAT_CROWN_PRINCE, HAT_CROWN_QUEEN, HAT_BERET, HAT_COWBOY, HAT_NINJA, HAT_PIRATE,
  HAT_CHEF, HAT_SANTA, HAT_BUNNY, HAT_FLOWER, HAT_CAT_EARS, HAT_HEADBAND,
};
enum {
  HELD_CONTROLLER, HELD_TOTE, HELD_BACKPACK, HELD_SUITCASE, HELD_BOX,
  HELD_BICYCLE, HELD_BOBBLEHEAD, HELD_ICECREAM,
  HELD_CAMERA, HELD_UMBRELLA, HELD_BOOK, HELD_FLOWER, HELD_SMARTPHONE,
  HELD_FLASHLIGHT, HELD_MICROPHONE, HELD_PLUSH, HELD_DONUT, HELD_STAR_WAND,
};

extern const u32   COLOR_HEX[NUM_COLORS];
extern const char *COLOR_NAME[NUM_COLORS];
extern const char *HAT_BASE_NAMES[NUM_BASES];
extern const char *HELD_BASE_NAMES[NUM_BASES];

// アイテムID（カテゴリ内）= base*5 + color
static inline int item_idx(int base, int color) { return base * NUM_COLORS + color; }
static inline int idx_base(int idx)  { return idx / NUM_COLORS; }
static inline int idx_color(int idx) { return idx % NUM_COLORS; }
