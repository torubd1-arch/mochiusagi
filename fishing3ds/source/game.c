// ================================================================
//  わくわくフィッシング3DS - ゲームロジック本体
// ================================================================
#include "game.h"
#include <math.h>
#include <string.h>

// ----------------------------------------------------------------
//  テーブル（魚種の並びは game.h の Species と同じ）
// ----------------------------------------------------------------
const int SPECIES_POINTS[SP_COUNT] = {
  10, 15, 20, 20, 25,     // メダカ モツゴ ワカサギ フナ オイカワ
  30, 30, 30, 40, 50,     // ブルーギル ドジョウ ウグイ タナゴ ブラックバス
  60, 60, 70, 70, 80,     // カジカ アユ ヤマメ ニジマス コイ
  90, 120, 120, 130, 150, // ナマズ イワナ ライギョ ソウギョ ニシキゴイ
  200, 300, 350, 500, 0,  // オオナマズ チョウザメ イトウ 黄金の魚 長靴
};
// 「最も珍しかった魚」の比較に使う順位（大きいほど珍しい。並び順＝珍しさ。長靴は最下位）
const int SPECIES_RARITY[SP_COUNT] = {
   1,  2,  3,  4,  5,  6,  7,  8,  9, 10, 11, 12, 13,
  14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24,  0,
};

const char *SPECIES_NAME_JP[SP_COUNT] = {
  "メダカ", "モツゴ", "ワカサギ", "フナ", "オイカワ",
  "ブルーギル", "ドジョウ", "ウグイ", "タナゴ", "ブラックバス",
  "カジカ", "アユ", "ヤマメ", "ニジマス", "コイ",
  "ナマズ", "イワナ", "ライギョ", "ソウギョ", "ニシキゴイ",
  "オオナマズ", "チョウザメ", "イトウ", "黄金の魚", "長靴",
};
const char *SPECIES_NAME_EN[SP_COUNT] = {
  "Medaka", "Stone Moroko", "Wakasagi", "Crucian Carp", "Pale Chub",
  "Bluegill", "Loach", "Japanese Dace", "Bitterling", "Black Bass",
  "Sculpin", "Ayu", "Yamame Trout", "Rainbow Trout", "Carp",
  "Catfish", "Char", "Snakehead", "Grass Carp", "Nishikigoi",
  "Giant Catfish", "Sturgeon", "Taimen", "Golden Fish", "Old Boot",
};

// ずかんの説明文（2行ずつ）
const char *SPECIES_DESC[SP_COUNT][2] = {
  [SP_MEDAKA]   = { "小川や 田んぼに すむ 小さな魚。", "むれで すいすい 泳ぐ。" },
  [SP_MOTSUGO]  = { "池や 沼に すむ 小さな魚。", "口が小さく「クチボソ」とも よばれる。" },
  [SP_WAKASAGI] = { "冷たい水が すきな 銀色の魚。", "冬は 氷に穴をあけて 釣ることも。" },
  [SP_FUNA]     = { "池や 川で よく見かける 魚。", "釣りの はじめの一歩は フナから。" },
  [SP_OIKAWA]   = { "川の 浅瀬に すむ 魚。", "オスは 青と赤の きれいな色になる。" },
  [SP_BLUEGILL] = { "えらぶたの 青黒い点が めじるし。", "外国から来て 日本中に ふえた。" },
  [SP_DOJOU]    = { "どろの中に もぐる 細長い魚。", "口の ひげで えさを さがす。" },
  [SP_UGUI]     = { "川の 上流から 下流まで すむ魚。", "春には 赤い すじが 出る。" },
  [SP_TANAGO]   = { "貝の中に たまごを うむ 小さな魚。", "ひし形の からだが きらきら光る。" },
  [SP_BASS]     = { "大きな口で 小魚を ひとのみ。", "引きが強く 釣り人に 人気の魚。" },
  [SP_KAJIKA]   = { "きれいな川の 石の下に かくれる。", "なかなか 見つからない はずかしがり屋。" },
  [SP_AYU]      = { "スイカのような 香りがする 川の魚。", "石についた コケを 食べる。" },
  [SP_YAMAME]   = { "山の 冷たい川に すむ魚。", "からだの もようは「パーマーク」。" },
  [SP_NIJIMASU] = { "からだに にじ色の 帯がある。", "冷たい水で 元気に はねる。" },
  [SP_KOI]      = { "長生きで 大きく育つ 池の ぬし。", "力が強く 引きも 重い。" },
  [SP_NAMAZU_S] = { "長い ひげが じまんの 夜の魚。", "雨のあとに よく 釣れるという。" },
  [SP_IWANA]    = { "川の いちばん 上流に すむ魚。", "白い はんてんが めじるし。" },
  [SP_RAIGYO]   = { "ヘビのような もようの 大きな魚。", "水面で 空気を すうことが できる。" },
  [SP_SOUGYO]   = { "水草を たくさん 食べる 大きな魚。", "1メートルを こえることも ある。" },
  [SP_NISHIKI]  = { "赤・白・黒が うつくしい「泳ぐ宝石」。", "池で 大切に そだてられる。" },
  [SP_NAMAZU]   = { "湖の そこで くらす 巨大な ナマズ。", "めったに 姿を 見せない。" },
  [SP_CHOUZAME] = { "大むかしから 姿が かわらない 魚。", "背中の かたい うろこが めじるし。" },
  [SP_ITOU]     = { "北の川に すむ 日本一大きな 川魚。", "「まぼろしの魚」と よばれる。" },
  [SP_GOLD]     = { "金色に かがやく なぞの魚。", "釣れたら とっても ラッキー！" },
  [SP_BOOT]     = { "だれかが 落とした 長ぐつ。", "魚じゃないけど ずかんに のせておこう。" },
};

// 魚影サイズの出現確率（%）
const int SIZE_SPAWN_PCT[SZ_COUNT] = { 50, 35, 15 };

// 魚影サイズ別の魚種抽選（‰。各行の合計は1000）
const int SPECIES_PERMILLE[SZ_COUNT][SP_COUNT] = {
  // 小：メダカ250 モツゴ170 ワカサギ140 フナ120 オイカワ80 ブルーギル90 ドジョウ60 タナゴ30 カジカ10 長靴50
  { 250, 170, 140, 120,  80,   90,  60,   0,  30,   0,   10,   0,   0,   0,   0,
      0,   0,   0,   0,   0,    0,   0,   0,   0,  50 },
  // 中：フナ120 ブルーギル150 ウグイ130 バス190 アユ90 ヤマメ70 ニジマス70 コイ50 ナマズ60 イワナ20 長靴50
  {   0,   0,   0, 120,   0,  150,   0, 130,   0, 190,    0,  90,  70,  70,  50,
     60,  20,   0,   0,   0,    0,   0,   0,   0,  50 },
  // 大：バス120 コイ245 ライギョ160 ソウギョ120 ニシキ130 オオナマズ100 チョウザメ40 イトウ25 黄金10 長靴50
  {   0,   0,   0,   0,   0,    0,   0,   0,   0, 120,    0,   0,   0,   0, 245,
      0,   0, 160, 120, 130,  100,  40,  25,  10,  50 },
};

const float SIZE_SPEED[SZ_COUNT]          = { 42.0f, 28.0f, 17.0f };  // 遊泳速度 px/秒
const float SIZE_LEN[SZ_COUNT]            = { 18.0f, 28.0f, 44.0f };  // 魚影の長さ
const float SIZE_GRACE[SZ_COUNT]          = { 0.85f, 0.70f, 0.55f };  // 合わせの猶予（秒）。仕様書の 1.2/1.0/0.8 から短縮
const float SIZE_APPROACH_SPEED[SZ_COUNT] = { 52.0f, 42.0f, 34.0f };  // ウキへ寄る速度

// ランク C, B, A, S の最低点（これ未満は D）
const int RANK_MIN_SCORE[4] = { 100, 250, 500, 800 };

// フェイントの回数（最小〜最大）。レアな魚ほど多い（並びは Species と同じ）
const int FEINT_MIN_COUNT[SP_COUNT] = { 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 0 };
const int FEINT_MAX_COUNT[SP_COUNT] = { 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4, 1 };

// やりとりの強さ。下の魚ほど巻き上げが遅く・引きが強く・よく暴れ・予兆が短い
// （珍しさの順に、旧版のフナ〜黄金の魚の値を補間して決めた）
const FightParam FIGHT_PARAMS[SP_COUNT] = {
  //  reel   pull  rush  rush_min rush_max rush_len warn
  { 1.20f, 0.00f, 0.00f, 9.90f, 9.90f, 0.00f, 0.00f },  // メダカ（暴れない）
  { 0.90f, 0.05f, 0.60f, 2.00f, 3.00f, 0.35f, 0.50f },  // モツゴ
  { 0.87f, 0.06f, 0.65f, 1.95f, 2.95f, 0.36f, 0.49f },  // ワカサギ
  { 0.85f, 0.07f, 0.71f, 1.89f, 2.89f, 0.38f, 0.47f },  // フナ
  { 0.82f, 0.07f, 0.76f, 1.84f, 2.84f, 0.39f, 0.46f },  // オイカワ
  { 0.79f, 0.08f, 0.83f, 1.78f, 2.78f, 0.40f, 0.45f },  // ブルーギル
  { 0.76f, 0.09f, 0.93f, 1.73f, 2.73f, 0.42f, 0.43f },  // ドジョウ
  { 0.74f, 0.11f, 1.02f, 1.67f, 2.67f, 0.43f, 0.42f },  // ウグイ
  { 0.71f, 0.12f, 1.12f, 1.62f, 2.62f, 0.45f, 0.40f },  // タナゴ
  { 0.69f, 0.13f, 1.18f, 1.58f, 2.56f, 0.46f, 0.39f },  // ブラックバス
  { 0.66f, 0.13f, 1.22f, 1.55f, 2.51f, 0.47f, 0.38f },  // カジカ
  { 0.64f, 0.14f, 1.26f, 1.53f, 2.45f, 0.49f, 0.37f },  // アユ
  { 0.62f, 0.15f, 1.30f, 1.50f, 2.40f, 0.50f, 0.36f },  // ヤマメ
  { 0.60f, 0.16f, 1.33f, 1.47f, 2.35f, 0.51f, 0.35f },  // ニジマス
  { 0.58f, 0.17f, 1.37f, 1.45f, 2.29f, 0.53f, 0.34f },  // コイ
  { 0.56f, 0.17f, 1.40f, 1.42f, 2.24f, 0.54f, 0.34f },  // ナマズ
  { 0.55f, 0.18f, 1.43f, 1.39f, 2.18f, 0.55f, 0.33f },  // イワナ
  { 0.53f, 0.19f, 1.47f, 1.36f, 2.13f, 0.57f, 0.32f },  // ライギョ
  { 0.52f, 0.21f, 1.50f, 1.34f, 2.07f, 0.58f, 0.31f },  // ソウギョ
  { 0.50f, 0.22f, 1.54f, 1.31f, 2.02f, 0.60f, 0.30f },  // ニシキゴイ
  { 0.49f, 0.23f, 1.59f, 1.28f, 1.96f, 0.61f, 0.29f },  // オオナマズ
  { 0.48f, 0.24f, 1.64f, 1.25f, 1.91f, 0.62f, 0.29f },  // チョウザメ
  { 0.46f, 0.25f, 1.70f, 1.23f, 1.85f, 0.64f, 0.28f },  // イトウ
  { 0.45f, 0.26f, 1.75f, 1.20f, 1.80f, 0.65f, 0.27f },  // 黄金の魚
  { 0.75f, 0.10f, 0.00f, 9.90f, 9.90f, 0.00f, 0.00f },  // 長靴（重いだけ）
};

// ----------------------------------------------------------------
//  乱数（xorshift32。シードを固定すればテストで再現できる）
// ----------------------------------------------------------------
uint32_t game_rand(Game *g) {
  uint32_t x = g->rng;
  x ^= x << 13; x ^= x >> 17; x ^= x << 5;
  g->rng = x;
  return x;
}
float game_randf(Game *g) { return (game_rand(g) >> 8) * (1.0f / 16777216.0f); }
static float rand_range(Game *g, float a, float b) { return a + (b - a) * game_randf(g); }

static float clampf(float v, float lo, float hi) { return v < lo ? lo : (v > hi ? hi : v); }

// ----------------------------------------------------------------
//  抽選
// ----------------------------------------------------------------
static int roll_table(Game *g, const int *w, int n, uint32_t total) {
  int r = (int)(game_rand(g) % total);
  for (int i = 0; i < n; i++) {
    if (r < w[i]) return i;
    r -= w[i];
  }
  return n - 1;
}
FishSize game_roll_size(Game *g) { return (FishSize)roll_table(g, SIZE_SPAWN_PCT, SZ_COUNT, 100u); }
Species game_roll_species(Game *g, FishSize size) {
  return (Species)roll_table(g, SPECIES_PERMILLE[size], SP_COUNT, 1000u);
}

// ----------------------------------------------------------------
//  魚影
// ----------------------------------------------------------------
float game_lane_y(int lane) { return LANE_Y0 + LANE_STEP * lane; }

static float fish_min_x(const Fish *f) { return LAKE_X_MIN + f->len * 0.5f; }
static float fish_max_x(const Fish *f) { return LAKE_X_MAX - f->len * 0.5f; }

void game_spawn_fish(Game *g, int slot) {
  Fish *f = &g->fish[slot];
  memset(f, 0, sizeof(*f));
  f->id      = ++g->next_id;
  f->size    = game_roll_size(g);
  f->species = game_roll_species(g, f->size);   // 生成時に魚種を確定（表示はしない）
  f->points  = SPECIES_POINTS[f->species];
  f->len     = SIZE_LEN[f->size];
  f->speed   = SIZE_SPEED[f->size] * rand_range(g, 1.0f - SPEED_VARIANCE, 1.0f + SPEED_VARIANCE);
  f->dir     = (game_rand(g) & 1) ? 1 : -1;
  f->x       = rand_range(g, fish_min_x(f), fish_max_x(f));
  // スロット番号＝レーン番号なので、魚影どうしのY座標は必ず異なる
  f->y       = game_lane_y(slot) + rand_range(g, -LANE_JITTER, LANE_JITTER);
  f->turn_t  = rand_range(g, TURN_MIN, TURN_MAX);
  f->tail    = game_randf(g) * 6.2832f;
  f->alpha   = 0.0f;
  f->state   = FS_SWIM;
}

static void fish_remove(Game *g, Fish *f) {
  f->state = FS_NONE;
  f->alpha = 0.0f;
  f->respawn_t = rand_range(g, RESPAWN_MIN, RESPAWN_MAX);
}

static void fish_set_state(Fish *f, FishState s) { f->state = s; f->state_t = 0; }

static void fish_flee(Game *g, Fish *f) {
  (void)g;
  // ウキから離れる向きへ逃げる
  if (g->bobber_out) f->dir = (f->x >= g->bob_x) ? 1 : -1;
  fish_set_state(f, FS_FLEE);
}

// ウキに関わっていない魚の動き
static void update_fish(Game *g, float dt) {
  for (int i = 0; i < FISH_COUNT; i++) {
    Fish *f = &g->fish[i];
    if (f->state == FS_NONE) {
      f->respawn_t -= dt;
      if (f->respawn_t <= 0) game_spawn_fish(g, i);
      continue;
    }
    f->state_t += dt;
    // 尾びれ：速く泳ぐほど速く振る
    float tail_rate = (f->state == FS_FLEE) ? 22.0f
                    : (f->state == FS_BITE || f->state == FS_FIGHT) ? 26.0f : 6.0f + f->speed * 0.12f;
    f->tail += tail_rate * dt;
    if (f->tail > 62.832f) f->tail -= 62.832f;

    if (f->state == FS_SWIM) {
      if (f->alpha < 1.0f) f->alpha = clampf(f->alpha + dt / SPAWN_FADE_TIME, 0, 1);
      f->x += f->dir * f->speed * dt;
      f->turn_t -= dt;
      if (f->x <= fish_min_x(f)) { f->x = fish_min_x(f); f->dir = 1;  f->turn_t = rand_range(g, TURN_MIN, TURN_MAX); }
      else if (f->x >= fish_max_x(f)) { f->x = fish_max_x(f); f->dir = -1; f->turn_t = rand_range(g, TURN_MIN, TURN_MAX); }
      else if (f->turn_t <= 0) { f->dir = -f->dir; f->turn_t = rand_range(g, TURN_MIN, TURN_MAX); }
    } else if (f->state == FS_FLEE) {
      f->x = clampf(f->x + f->dir * f->speed * FLEE_SPEED_MUL * dt, fish_min_x(f), fish_max_x(f));
      f->alpha = clampf(1.0f - f->state_t / FLEE_TIME, 0, 1);
      if (f->state_t >= FLEE_TIME) fish_remove(g, f);
    }
  }
}

// ----------------------------------------------------------------
//  状態遷移
// ----------------------------------------------------------------
static void set_state(Game *g, GameState s) { g->state = s; g->state_t = 0; }

static void reel_in(Game *g) { g->bobber_out = false; g->target = -1; }

static void miss(Game *g, MissReason r) {
  if (g->target >= 0) {
    Fish *f = &g->fish[g->target];
    if (f->state == FS_APPROACH || f->state == FS_WAIT || f->state == FS_BITE || f->state == FS_FIGHT)
      fish_flee(g, f);
  }
  g->miss_reason = r;
  g->events |= EV_MISS;
  set_state(g, ST_MISSED);
}

static void reset_round(Game *g) {
  g->time_left   = GAME_TIME_SEC;
  g->cursor_x    = CURSOR_START_X;
  g->bobber_out  = false;
  g->target      = -1;
  g->miss_reason = MISS_NONE;
  g->tension = g->progress = g->slack_t = 0;
  g->rush_phase = RUSH_NONE; g->rush_t = 0;
  g->feint_count = g->feint_next = 0;
  g->score = 0; g->new_record = false; g->top_pos = -1;
  g->casts = g->hooks = g->fish_caught = 0;
  memset(g->counts, 0, sizeof(g->counts));
  g->rarest = -1;
  g->last_species = SP_MEDAKA; g->last_points = 0; g->last_new = false;
  g->pause_sel = 0;
  for (int i = 0; i < FISH_COUNT; i++) game_spawn_fish(g, i);
}

void game_init(Game *g, uint32_t seed) {
  memset(g, 0, sizeof(*g));
  g->rng = seed ? seed : 0x1234567u;
  g->high_score = 0;
  g->top_count = 0;
  g->top_pos = -1;
  g->player = PL_BOY;
  reset_round(g);
  set_state(g, ST_TITLE);
}

void game_start(Game *g) {
  reset_round(g);
  g->events |= EV_START;
  set_state(g, ST_AIMING);
}

static void go_title(Game *g) {
  reset_round(g);
  set_state(g, ST_TITLE);
}

void game_record_score(Game *g, int score, Player p) {
  g->top_pos = -1;
  if (score <= 0) return;                       // 0点は記録しない
  int pos = g->top_count;
  while (pos > 0 && g->top[pos - 1].score < score) pos--;   // 同点なら先に出した方が上
  if (pos >= TOP_COUNT) return;                 // 圏外
  int last = g->top_count < TOP_COUNT ? g->top_count : TOP_COUNT - 1;
  for (int i = last; i > pos; i--) g->top[i] = g->top[i - 1];
  g->top[pos].score = score;
  g->top[pos].player = p;
  if (g->top_count < TOP_COUNT) g->top_count++;
  g->top_pos = pos;
  g->high_score = g->top[0].score;
}

static void finish_game(Game *g) {
  g->time_left = 0;
  reel_in(g);
  g->new_record = g->score > g->high_score;
  game_record_score(g, g->score, g->player);
  g->events |= EV_TIMEUP;
  set_state(g, ST_RESULT);
}

bool game_is_playing(const Game *g) {
  switch (g->state) {
    case ST_AIMING: case ST_CASTING: case ST_FISH_APPROACH: case ST_WAIT_BITE:
    case ST_HIT_WINDOW: case ST_FIGHT: case ST_CAUGHT: case ST_MISSED:
      return true;
    default:
      return false;
  }
}

char game_rank(int score) {
  if (score >= RANK_MIN_SCORE[3]) return 'S';
  if (score >= RANK_MIN_SCORE[2]) return 'A';
  if (score >= RANK_MIN_SCORE[1]) return 'B';
  if (score >= RANK_MIN_SCORE[0]) return 'C';
  return 'D';
}

int game_discovered_count_of(const Game *g, Player p) {
  int n = 0;
  for (int k = 0; k < SP_COUNT; k++) n += g->discovered[p][k] ? 1 : 0;
  return n;
}
int game_discovered_count(const Game *g) { return game_discovered_count_of(g, g->player); }
bool game_is_discovered(const Game *g, Species sp) { return g->discovered[g->player][sp]; }

int game_species_stars(Species sp) {
  int p = SPECIES_POINTS[sp];
  if (sp == SP_BOOT) return 0;
  return p < 30 ? 1 : p < 60 ? 2 : p < 100 ? 3 : p < 200 ? 4 : 5;
}

int game_success_rate(const Game *g) {
  if (g->casts <= 0) return 0;
  return (g->hooks * 100 + g->casts / 2) / g->casts;
}

// 着水時の判定。近すぎる魚は逃げ、5〜30px の魚のうち最も近い1匹が興味を持つ
static void judge_landing(Game *g) {
  int best = -1, fled = 0;
  float best_d = 1e9f;
  for (int i = 0; i < FISH_COUNT; i++) {
    Fish *f = &g->fish[i];
    if (f->state != FS_SWIM) continue;
    float d = fabsf(f->x - g->bob_x);
    if (d < NEAR_MIN) { fish_flee(g, f); fled++; continue; }
    if (d <= NEAR_MAX && d < best_d) { best_d = d; best = i; }
  }
  if (fled) g->events |= EV_FLEE;
  if (best >= 0) {
    Fish *f = &g->fish[best];
    g->target = best;
    f->dir = (g->bob_x >= f->x) ? 1 : -1;  // ウキの方を向く
    fish_set_state(f, FS_APPROACH);
    set_state(g, ST_FISH_APPROACH);
  } else {
    miss(g, fled ? MISS_TOO_CLOSE : MISS_NO_REACTION);
  }
}

// 食いつき待ちの予定を決める：フェイント（0〜数回）→ 本物の食いつき
static void schedule_bite(Game *g, Species sp) {
  int lo = FEINT_MIN_COUNT[sp], hi = FEINT_MAX_COUNT[sp];
  int n = lo + (int)(game_rand(g) % (uint32_t)(hi - lo + 1));
  if (n > FEINT_MAX) n = FEINT_MAX;
  float t = 0;
  for (int i = 0; i < n; i++) {
    t += rand_range(g, FEINT_GAP_MIN, FEINT_GAP_MAX);
    g->feint_at[i] = t;
    t += FEINT_TIME;
  }
  t += n ? rand_range(g, FEINT_AFTER_MIN, FEINT_AFTER_MAX) : rand_range(g, BITE_WAIT_MIN, BITE_WAIT_MAX);
  g->feint_count = n;
  g->feint_next  = 0;
  g->bite_wait   = t;
}

bool game_feint_active(const Game *g) {
  if (g->state != ST_WAIT_BITE && !(g->state == ST_PAUSE && g->paused_from == ST_WAIT_BITE)) return false;
  for (int i = 0; i < g->feint_count; i++)
    if (g->state_t >= g->feint_at[i] && g->state_t < g->feint_at[i] + FEINT_TIME) return true;
  return false;
}

// 対象の魚をウキへ近づける。到着したら true
static bool approach_target(Game *g, Fish *f, float dt) {
  float head = f->len * 0.45f;
  float tx = g->bob_x - f->dir * head;   // 口先がウキに届く位置
  // すでに口先がウキを越えるほど近い場合は横には動かない
  if ((g->bob_x - f->x) * f->dir < head) tx = f->x;
  float ty = g->bob_y + 3.0f;
  float dx = tx - f->x, dy = ty - f->y;
  float dist = sqrtf(dx * dx + dy * dy);
  float step = SIZE_APPROACH_SPEED[f->size] * dt;
  if (dist <= step || dist < 0.5f) { f->x = tx; f->y = ty; return true; }
  f->x += dx / dist * step;
  f->y += dy / dist * step;
  return false;
}

// ----------------------------------------------------------------
//  やりとり
// ----------------------------------------------------------------
static void land_fish(Game *g, Fish *tf) {
  Species sp = tf->species;
  g->last_species = sp;
  g->last_points  = tf->points;
  g->score += tf->points;
  g->counts[sp]++;
  g->hooks++;
  if (sp != SP_BOOT) g->fish_caught++;
  if (g->rarest < 0 || SPECIES_RARITY[sp] > SPECIES_RARITY[g->rarest]) g->rarest = sp;
  g->last_new = !g->discovered[g->player][sp];
  g->discovered[g->player][sp] = true;
  if (g->caught_total[g->player][sp] < CAUGHT_TOTAL_MAX) g->caught_total[g->player][sp]++;
  fish_remove(g, tf);
  reel_in(g);
  g->events |= EV_CATCH | EV_SPLASH;
  if (sp == SP_GOLD) g->events |= EV_GOLD;
  set_state(g, ST_CAUGHT);
}

static void start_fight(Game *g, Fish *tf) {
  const FightParam *fp = &FIGHT_PARAMS[tf->species];
  fish_set_state(tf, FS_FIGHT);
  tf->dir = (tf->x >= LAND_X) ? 1 : -1;   // 桟橋と反対へ引っぱる向き
  g->tension    = FIGHT_START_TENSION;
  g->progress   = 0;
  g->slack_t    = 0;
  g->rush_phase = RUSH_NONE;
  g->rush_t     = rand_range(g, fp->rush_min, fp->rush_max);
  g->fight_x0   = tf->x;
  g->fight_y0   = tf->y;
  g->events |= EV_HOOK;
  set_state(g, ST_FIGHT);
}

static void update_fight(Game *g, Fish *tf, float dt, const GameInput *in) {
  const FightParam *fp = &FIGHT_PARAMS[tf->species];

  // 暴れの周期：静か → 予兆 → 暴れる → 静か …
  if (fp->rush > 0) {
    g->rush_t -= dt;
    if (g->rush_t <= 0) {
      if (g->rush_phase == RUSH_NONE) {
        g->rush_phase = RUSH_WARN; g->rush_t = fp->warn; g->events |= EV_RUSH;
      } else if (g->rush_phase == RUSH_WARN) {
        g->rush_phase = RUSH_ON; g->rush_t = fp->rush_len; g->events |= EV_THRASH | EV_SPLASH;
      } else {
        g->rush_phase = RUSH_NONE; g->rush_t = rand_range(g, fp->rush_min, fp->rush_max);
      }
    }
  }

  bool rushing = g->rush_phase == RUSH_ON;
  float pull = fp->pull + (rushing ? fp->rush : 0.0f);
  if (in->a_held) {
    g->tension += (REEL_TENSION_UP + pull) * dt;
    if (!rushing) g->progress += fp->reel * dt;   // 暴れている間は巻けない
  } else {
    g->tension += (pull * RUSH_PULL_RELEASED - RELEASE_TENSION_DOWN) * dt;
  }
  if (rushing) g->progress -= RUSH_LINE_DRAIN * dt; // 糸を引き出される
  if (g->progress < 0) g->progress = 0;

  if (g->tension >= 1.0f) {
    g->tension = 1.0f;
    g->events |= EV_BREAK;
    miss(g, MISS_LINE_BREAK);
    return;
  }
  if (g->tension <= 0.0f) {
    g->tension = 0.0f;
    g->slack_t += dt;
    if (g->slack_t >= SLACK_LIMIT) { miss(g, MISS_SLACK); return; }
  } else {
    g->slack_t = 0;
  }

  // 巻き上げに合わせて魚を手前へ寄せる
  float p = clampf(g->progress, 0, 1);
  tf->x = g->fight_x0 + (LAND_X - g->fight_x0) * p;
  tf->y = g->fight_y0 + (LAND_Y - g->fight_y0) * p;
  g->bob_x = tf->x; g->bob_y = tf->y;
  if (g->progress >= 1.0f) land_fish(g, tf);
}

static void move_cursor(Game *g, float dt, const GameInput *in) {
  float m = clampf(in->move, -1.0f, 1.0f);
  g->cursor_x = clampf(g->cursor_x + m * CURSOR_SPEED * dt, CURSOR_X_MIN, CURSOR_X_MAX);
}

static void update_play(Game *g, float dt, const GameInput *in) {
  Fish *tf = (g->target >= 0) ? &g->fish[g->target] : 0;
  switch (g->state) {
    case ST_AIMING:
      move_cursor(g, dt, in);
      if (in->a) {
        g->casts++;
        g->cast_x = g->cursor_x;
        g->bob_x = CAST_ORIGIN_X; g->bob_y = CAST_ORIGIN_Y;
        g->bobber_out = true;
        g->target = -1;
        g->events |= EV_CAST;
        set_state(g, ST_CASTING);
      }
      break;

    case ST_CASTING: {
      // キャスト中のAボタン・Bボタンは無視（連打で即失敗にならないように）
      float t = clampf(g->state_t / CAST_TIME, 0, 1);
      g->bob_x = CAST_ORIGIN_X + (g->cast_x - CAST_ORIGIN_X) * t;
      g->bob_y = CAST_ORIGIN_Y + (CAST_Y - CAST_ORIGIN_Y) * t - sinf(t * 3.14159265f) * CAST_ARC_H;
      if (g->state_t >= CAST_TIME) {
        g->bob_x = g->cast_x; g->bob_y = CAST_Y;
        g->events |= EV_SPLASH;
        judge_landing(g);
      }
      break;
    }

    case ST_FISH_APPROACH:
      if (in->a) { miss(g, MISS_EARLY); break; }
      if (in->b) { fish_set_state(tf, FS_SWIM); reel_in(g); g->events |= EV_REEL; set_state(g, ST_AIMING); break; }
      if (approach_target(g, tf, dt)) {
        fish_set_state(tf, FS_WAIT);
        schedule_bite(g, tf->species);
        set_state(g, ST_WAIT_BITE);
      }
      break;

    case ST_WAIT_BITE:
      if (in->a) { miss(g, game_feint_active(g) ? MISS_FEINT : MISS_EARLY); break; }
      if (in->b) { fish_set_state(tf, FS_SWIM); reel_in(g); g->events |= EV_REEL; set_state(g, ST_AIMING); break; }
      if (g->feint_next < g->feint_count && g->state_t >= g->feint_at[g->feint_next]) {
        g->feint_next++;
        g->events |= EV_FEINT;
      }
      if (g->state_t >= g->bite_wait) {
        fish_set_state(tf, FS_BITE);
        g->grace = SIZE_GRACE[tf->size];
        g->events |= EV_BITE | EV_SPLASH;
        set_state(g, ST_HIT_WINDOW);
      }
      break;

    case ST_HIT_WINDOW:
      if (in->a) { start_fight(g, tf); break; }
      if (in->b || g->state_t >= g->grace) miss(g, MISS_ESCAPED);
      break;

    case ST_FIGHT:
      update_fight(g, tf, dt, in);
      break;

    case ST_CAUGHT:
      move_cursor(g, dt, in);
      if (g->state_t >= (g->last_species == SP_GOLD ? GOLD_SHOW_TIME : CATCH_SHOW_TIME)) set_state(g, ST_AIMING);
      break;

    case ST_MISSED:
      move_cursor(g, dt, in);
      if (g->state_t >= MISS_SHOW_TIME) { reel_in(g); set_state(g, ST_AIMING); }
      break;

    default:
      break;
  }
}

static void pause_apply(Game *g, int sel) {
  if (sel == 0) { g->state = g->paused_from; g->events |= EV_MENU; }
  else if (sel == 1) { go_title(g); g->events |= EV_MENU; }
  else g->quit = true;
}

void game_update(Game *g, float dt, const GameInput *in) {
  g->events = 0;
  if (dt < 0) dt = 0;

  switch (g->state) {
    case ST_TITLE:
      g->anim_t += dt;
      update_fish(g, dt);          // タイトル画面でも背景で魚影が泳ぐ
      g->state_t += dt;
      // あそぶ人をえらぶ（左右キー・顔のタッチ）
      if ((in->left && g->player != PL_BOY) || in->cmd == CMD_SEL_BOY) {
        g->player = PL_BOY; g->events |= EV_MENU;
      } else if ((in->right && g->player != PL_GIRL) || in->cmd == CMD_SEL_GIRL) {
        g->player = PL_GIRL; g->events |= EV_MENU;
      }
      if (in->a || in->cmd == CMD_START) { game_start(g); return; }
      if (in->x || in->cmd == CMD_ZUKAN) { set_state(g, ST_ZUKAN); g->events |= EV_MENU; }
      return;

    case ST_ZUKAN: {
      g->anim_t += dt;
      g->state_t += dt;
      update_fish(g, dt);
      if (in->b || in->cmd == CMD_TITLE) { set_state(g, ST_TITLE); g->events |= EV_MENU; return; }
      // カーソル移動（表の端では止まる）
      int sel = g->zukan_sel, col = sel % ZUKAN_COLS;
      if (in->left && col > 0) sel--;
      if (in->right && col < ZUKAN_COLS - 1 && sel + 1 < SP_COUNT) sel++;
      if (in->up && sel - ZUKAN_COLS >= 0) sel -= ZUKAN_COLS;
      if (in->down && sel + ZUKAN_COLS < SP_COUNT) sel += ZUKAN_COLS;
      if (in->cmd == CMD_ZUKAN_CELL && in->cell >= 0 && in->cell < SP_COUNT) sel = in->cell;
      if (sel != g->zukan_sel) { g->zukan_sel = sel; g->events |= EV_MENU; g->state_t = 0; }
      return;
    }

    case ST_PAUSE:
      // 時間・魚・アニメーションはすべて止める
      if (in->cmd == CMD_RESUME) { pause_apply(g, 0); return; }
      if (in->cmd == CMD_TITLE)  { pause_apply(g, 1); return; }
      if (in->cmd == CMD_QUIT)   { pause_apply(g, 2); return; }
      if (in->start || in->b)    { pause_apply(g, 0); return; }
      if (in->up)   { g->pause_sel = (g->pause_sel + 2) % 3; g->events |= EV_MENU; }
      if (in->down) { g->pause_sel = (g->pause_sel + 1) % 3; g->events |= EV_MENU; }
      if (in->a) pause_apply(g, g->pause_sel);
      return;

    case ST_RESULT:
      g->anim_t += dt;
      g->state_t += dt;
      update_fish(g, dt);
      if (g->state_t < TIMEUP_LOCK_TIME) return;   // 時間切れ直後の入力は受け付けない
      if (in->a || in->cmd == CMD_RETRY) { game_start(g); return; }
      if (in->b || in->cmd == CMD_TITLE) { go_title(g); return; }
      return;

    default:
      break;
  }

  // ---- ここからプレイ中 ----
  if (in->start || in->cmd == CMD_PAUSE) {
    g->paused_from = g->state;
    g->state = ST_PAUSE;           // state_t は保持（再開時にそのまま続く）
    g->pause_sel = 0;
    g->events |= EV_MENU;
    return;
  }
  g->time_left -= dt;
  if (g->time_left <= 0) { finish_game(g); return; }  // 時間切れ以降の操作は受け付けない

  g->anim_t  += dt;
  g->state_t += dt;
  update_fish(g, dt);
  update_play(g, dt, in);
}
