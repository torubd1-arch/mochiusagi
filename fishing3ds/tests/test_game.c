// ================================================================
//  わくわくフィッシング3DS - ゲームロジックの自動テスト（PC 上で実行）
//  ビルド: make -C tests   （gcc が必要）
// ================================================================
#include "../source/game.h"
#include "../source/save.h"
#include "../source/music.h"
#include <math.h>
#include <stdio.h>
#include <string.h>

static int g_pass = 0, g_fail = 0;
static const char *g_case = "";

#define CHECK(cond) do { \
  if (cond) g_pass++; \
  else { g_fail++; printf("  NG [%s] %s:%d: %s\n", g_case, __FILE__, __LINE__, #cond); } \
} while (0)

#define DT (1.0f / 60.0f)

static GameInput none(void) { GameInput in; memset(&in, 0, sizeof(in)); return in; }
static GameInput press_a(void) { GameInput in = none(); in.a = true; return in; }

static void step(Game *g, int frames, const GameInput *in) {
  for (int i = 0; i < frames; i++) game_update(g, DT, in);
}

// 魚を1匹だけ・指定位置に置いた状態でゲームを始める
static void setup_single(Game *g, float fish_x, FishSize sz, Species sp) {
  game_init(g, 12345);
  game_start(g);
  for (int i = 0; i < FISH_COUNT; i++) { g->fish[i].state = FS_NONE; g->fish[i].respawn_t = 999; }
  Fish *f = &g->fish[2];
  memset(f, 0, sizeof(*f));
  f->id = 99; f->state = FS_SWIM; f->size = sz; f->species = sp; f->points = SPECIES_POINTS[sp];
  f->len = SIZE_LEN[sz]; f->speed = 0; f->dir = 1; f->x = fish_x; f->y = game_lane_y(2);
  f->turn_t = 999; f->alpha = 1;
}

// カーソルを cx に置いてキャストし、着水まで進める
static void cast_at(Game *g, float cx) {
  GameInput n = none(), a = press_a();
  g->cursor_x = cx;
  game_update(g, DT, &a);
  for (int i = 0; i < 60 && g->state == ST_CASTING; i++) game_update(g, DT, &n);
}

// ----------------------------------------------------------------
static void test_init(void) {
  g_case = "init";
  Game g; game_init(&g, 1);
  CHECK(g.state == ST_TITLE);
  GameInput a = press_a();
  game_update(&g, DT, &a);
  CHECK(g.state == ST_AIMING);
  CHECK(fabsf(g.time_left - GAME_TIME_SEC) < 1e-4f);
  CHECK(g.score == 0 && g.casts == 0);
  int active = 0;
  for (int i = 0; i < FISH_COUNT; i++) if (g.fish[i].state == FS_SWIM) active++;
  CHECK(active == FISH_COUNT);
  // タッチの START コマンドでも開始できる
  game_init(&g, 1);
  GameInput t = none(); t.cmd = CMD_START;
  game_update(&g, DT, &t);
  CHECK(g.state == ST_AIMING);
}

static void test_cursor(void) {
  g_case = "cursor";
  Game g; game_init(&g, 2); game_start(&g);
  GameInput in = none();
  float x0 = g.cursor_x;
  in.move = 1.0f; step(&g, 30, &in);
  CHECK(fabsf(g.cursor_x - (x0 + CURSOR_SPEED * 0.5f)) < 0.5f);
  in.move = -0.5f; step(&g, 30, &in);
  CHECK(fabsf(g.cursor_x - (x0 + CURSOR_SPEED * 0.25f)) < 0.5f);
  in.move = 1.0f; step(&g, 600, &in);
  CHECK(g.cursor_x == CURSOR_X_MAX);
  in.move = -1.0f; step(&g, 600, &in);
  CHECK(g.cursor_x == CURSOR_X_MIN);
  in.move = -5.0f; step(&g, 10, &in);   // 範囲外の入力値でもはみ出さない
  CHECK(g.cursor_x == CURSOR_X_MIN);
}

static void test_cast_landing_matches_cursor(void) {
  g_case = "cast_landing";
  for (float cx = CURSOR_X_MIN; cx <= CURSOR_X_MAX; cx += 37.0f) {
    Game g; setup_single(&g, 10000.0f, SZ_SMALL, SP_MEDAKA);  // 魚は届かない場所
    g.fish[2].state = FS_NONE; g.fish[2].respawn_t = 999;
    GameInput a = press_a(), n = none();
    g.cursor_x = cx;
    game_update(&g, DT, &a);
    CHECK(g.state == ST_CASTING);
    CHECK(g.casts == 1);
    // キャスト中にカーソル入力があっても着水点は変わらない
    n.move = 1.0f;
    int frames = 0;
    while (g.state == ST_CASTING && frames < 100) { game_update(&g, DT, &n); frames++; }
    CHECK(fabsf(g.bob_x - cx) < 1e-4f);
    CHECK(fabsf(g.bob_y - CAST_Y) < 1e-4f);
    // 約0.4秒で着水する
    CHECK(fabsf(frames * DT - CAST_TIME) <= DT + 1e-4f);
  }
}

static void test_distance_judge(void) {
  g_case = "distance";
  const float bx = 200.0f;
  struct { float d; int expect; } cases[] = {
    { 0.0f, 0 }, { 4.9f, 0 },              // 近すぎ → 逃げる
    { 5.0f, 1 }, { 15.0f, 1 }, { 30.0f, 1 }, { -29.9f, 1 }, // 興味を持つ
    { 30.1f, 2 }, { -60.0f, 2 },           // 反応なし
  };
  for (unsigned i = 0; i < sizeof(cases) / sizeof(cases[0]); i++) {
    Game g; setup_single(&g, bx + cases[i].d, SZ_MEDIUM, SP_BASS);
    cast_at(&g, bx);
    if (cases[i].expect == 0) {
      CHECK(g.state == ST_MISSED && g.miss_reason == MISS_TOO_CLOSE);
      CHECK(g.fish[2].state == FS_FLEE);
    } else if (cases[i].expect == 1) {
      CHECK(g.state == ST_FISH_APPROACH && g.target == 2);
      CHECK(g.fish[2].state == FS_APPROACH);
    } else {
      CHECK(g.state == ST_MISSED && g.miss_reason == MISS_NO_REACTION);
      CHECK(g.fish[2].state == FS_SWIM);
    }
  }
}

static void test_nearest_target(void) {
  g_case = "nearest";
  Game g; setup_single(&g, 220.0f, SZ_SMALL, SP_MEDAKA);   // 距離20
  Fish *b = &g.fish[0];
  *b = g.fish[2]; b->id = 100; b->x = 190.0f; b->y = game_lane_y(0);  // 距離10
  Fish *c = &g.fish[4];
  *c = g.fish[2]; c->id = 101; c->x = 228.0f; c->y = game_lane_y(4);  // 距離28
  cast_at(&g, 200.0f);
  CHECK(g.state == ST_FISH_APPROACH);
  CHECK(g.target == 0);
  CHECK(g.fish[2].state == FS_SWIM && g.fish[4].state == FS_SWIM);

  // 近すぎる魚は逃げるが、5〜30px に別の魚がいればそちらが反応する
  setup_single(&g, 202.0f, SZ_SMALL, SP_MEDAKA);           // 距離2（近すぎ）
  b = &g.fish[0]; *b = g.fish[2]; b->id = 100; b->x = 225.0f; b->y = game_lane_y(0);
  cast_at(&g, 200.0f);
  CHECK(g.fish[2].state == FS_FLEE);
  CHECK(g.state == ST_FISH_APPROACH && g.target == 0);
}

static void test_approach_and_bite(void) {
  g_case = "approach";
  Game g; setup_single(&g, 220.0f, SZ_MEDIUM, SP_BASS);
  g.fish[2].y = game_lane_y(0);   // Y方向にも離しておく
  cast_at(&g, 200.0f);
  CHECK(g.state == ST_FISH_APPROACH);
  GameInput n = none();
  float prev = 1e9f; int closer = 1, frames = 0;
  while (g.state == ST_FISH_APPROACH && frames < 600) {
    Fish *f = &g.fish[2];
    // 魚は「口先」がウキに届く位置へ向かう
    float mouth_x = f->x + f->dir * f->len * 0.45f;
    float d = hypotf(mouth_x - g.bob_x, f->y - (g.bob_y + 3.0f));
    if (d > prev + 1e-3f) closer = 0;
    prev = d;
    game_update(&g, DT, &n); frames++;
  }
  CHECK(closer);
  CHECK(g.state == ST_WAIT_BITE);
  CHECK(g.fish[2].dir == -1);   // ウキ（左）の方を向いている
  // ブラックバスはフェイント1〜2回のあと食いつく
  CHECK(g.feint_count >= 1 && g.feint_count <= 2);
  CHECK(g.bite_wait > g.feint_at[g.feint_count - 1] + FEINT_TIME);
  float wait = g.bite_wait; frames = 0;
  while (g.state == ST_WAIT_BITE && frames < 600) { game_update(&g, DT, &n); frames++; }
  CHECK(g.state == ST_HIT_WINDOW);
  CHECK(fabsf(frames * DT - wait) <= DT * 1.5f);
  CHECK(fabsf(g.grace - SIZE_GRACE[SZ_MEDIUM]) < 1e-4f);

  // フェイントが無いときの食いつき待ち時間は 0.5〜2.0 秒の範囲に分布する
  float mn = 9, mx = 0;
  for (int s = 1; s <= 600; s++) {
    setup_single(&g, 215.0f, SZ_SMALL, SP_MEDAKA);
    g.rng = (uint32_t)s * 2654435761u;
    cast_at(&g, 200.0f);
    for (int i = 0; i < 600 && g.state == ST_FISH_APPROACH; i++) game_update(&g, DT, &n);
    if (g.state == ST_WAIT_BITE && g.feint_count == 0) {
      if (g.bite_wait < mn) mn = g.bite_wait;
      if (g.bite_wait > mx) mx = g.bite_wait;
    }
  }
  CHECK(mn >= BITE_WAIT_MIN && mx <= BITE_WAIT_MAX);
  CHECK(mn < 0.6f && mx > 1.9f);
}

// HIT_WINDOW まで進める
static void to_hit(Game *g, FishSize sz, Species sp) {
  setup_single(g, 215.0f, sz, sp);
  cast_at(g, 200.0f);
  GameInput n = none();
  for (int i = 0; i < 1000 && g->state != ST_HIT_WINDOW; i++) game_update(g, DT, &n);
}

// やりとりを自動で操作する「プレイヤー役」
//  delay    : 状態を見てから反応するまでのフレーム数（人間の反応時間の代わり）
//  hold_below: 暴れていないとき、テンションがこれ未満なら巻く
typedef struct { float tension; int rush; } Obs;
static int fight_bot(Game *g, int delay, float hold_below) {
  Obs hist[64];
  int n = 0, frames = 0;
  GameInput in = none();
  while (g->state == ST_FIGHT && frames < 60 * 60) {
    hist[n % 64].tension = g->tension;
    hist[n % 64].rush = g->rush_phase;
    Obs o = (n >= delay) ? hist[(n - delay) % 64] : hist[0];
    n++;
    in.a_held = (o.rush == RUSH_NONE && o.tension < hold_below) || o.tension < 0.08f;
    game_update(g, DT, &in);
    frames++;
  }
  return frames;
}

// HIT 中に A で合わせ、やりとりを上手にこなして釣り上げる
static void land(Game *g) {
  GameInput a = press_a(); a.a_held = true;
  game_update(g, DT, &a);
  fight_bot(g, 0, 0.6f);
}

static void test_hook_timing(void) {
  g_case = "hook";
  const float grace[3] = { 0.85f, 0.70f, 0.55f };
  for (int sz = 0; sz < 3; sz++) {
    Game g; GameInput n = none(), a = press_a();
    // 猶予ぎりぎり手前で押す → 成功
    to_hit(&g, (FishSize)sz, SP_FUNA);
    CHECK(g.state == ST_HIT_WINDOW);
    CHECK(fabsf(g.grace - grace[sz]) < 1e-4f);
    int frames = (int)(grace[sz] / DT) - 2;
    step(&g, frames, &n);
    CHECK(g.state == ST_HIT_WINDOW);
    game_update(&g, DT, &a);
    CHECK(g.state == ST_FIGHT);          // 合わせ成功 → やりとりへ
    CHECK(g.score == 0 && g.hooks == 0); // まだ釣れていない
    fight_bot(&g, 0, 0.6f);
    CHECK(g.state == ST_CAUGHT);
    CHECK(g.score == 20 && g.hooks == 1 && g.fish_caught == 1 && g.counts[SP_FUNA] == 1);

    // 猶予を過ぎる → 失敗（逃げられる）
    to_hit(&g, (FishSize)sz, SP_FUNA);
    step(&g, (int)(grace[sz] / DT) + 2, &n);
    CHECK(g.state == ST_MISSED && g.miss_reason == MISS_ESCAPED);
    CHECK(g.score == 0);
    game_update(&g, DT, &a);   // 失敗後の押下で得点は入らない
    CHECK(g.score == 0);
  }
}

static void test_early_press(void) {
  g_case = "early";
  Game g; GameInput a = press_a(), n = none();
  setup_single(&g, 220.0f, SZ_SMALL, SP_MEDAKA);
  g.fish[2].y = game_lane_y(0);
  cast_at(&g, 200.0f);
  CHECK(g.state == ST_FISH_APPROACH);
  game_update(&g, DT, &a);
  CHECK(g.state == ST_MISSED && g.miss_reason == MISS_EARLY);
  CHECK(g.fish[2].state == FS_FLEE);

  // 食いつき待ち中に押しても失敗
  setup_single(&g, 215.0f, SZ_SMALL, SP_MEDAKA);
  cast_at(&g, 200.0f);
  for (int i = 0; i < 600 && g.state == ST_FISH_APPROACH; i++) game_update(&g, DT, &n);
  CHECK(g.state == ST_WAIT_BITE);
  game_update(&g, DT, &a);
  CHECK(g.state == ST_MISSED && g.miss_reason == MISS_EARLY);

  // 失敗後は約0.7秒で再びキャスト可能になる
  int frames = 0;
  while (g.state == ST_MISSED && frames < 200) { game_update(&g, DT, &n); frames++; }
  CHECK(g.state == ST_AIMING);
  CHECK(fabsf(frames * DT - MISS_SHOW_TIME) <= DT * 1.5f);
  CHECK(g.score == 0);   // 減点なし
}

static void test_cancel(void) {
  g_case = "cancel";
  Game g; GameInput b = none(), n = none(); b.b = true;
  setup_single(&g, 215.0f, SZ_SMALL, SP_MEDAKA);
  cast_at(&g, 200.0f);
  CHECK(g.state == ST_FISH_APPROACH);
  game_update(&g, DT, &b);
  CHECK(g.state == ST_AIMING && !g.bobber_out && g.fish[2].state == FS_SWIM);
  (void)n;
}

static void test_mashing(void) {
  g_case = "mashing";
  // 毎フレームA（連打・長押し相当）でも1フレームで複数の遷移は起きない
  Game g; GameInput a = press_a();
  setup_single(&g, 10000.0f, SZ_SMALL, SP_MEDAKA);
  g.fish[2].state = FS_NONE; g.fish[2].respawn_t = 999;
  game_update(&g, DT, &a);
  CHECK(g.state == ST_CASTING && g.casts == 1);
  step(&g, 5, &a);                  // キャスト中の押下は無視
  CHECK(g.state == ST_CASTING && g.casts == 1);
  // 10秒間押し続けても状態が壊れない・得点が増えない
  for (int i = 0; i < 600; i++) {
    game_update(&g, DT, &a);
    CHECK(g.state != ST_PAUSE && g.state != ST_RESULT);
    if (g.state < ST_AIMING || g.state > ST_MISSED) break;
  }
  CHECK(g.score == 0);
  CHECK(g.casts >= 2 && g.casts <= 20);   // 約1.1秒ごとに1回
  // 釣果数は成功回数を超えない
  CHECK(g.hooks <= g.casts);
}

static void test_species_distribution(void) {
  g_case = "distribution";
  Game g; game_init(&g, 777);
  const int N = 1000000;
  int size_cnt[SZ_COUNT] = { 0 };
  for (int i = 0; i < N; i++) size_cnt[game_roll_size(&g)]++;
  for (int s = 0; s < SZ_COUNT; s++) {
    double p = 100.0 * size_cnt[s] / N;
    CHECK(fabs(p - SIZE_SPAWN_PCT[s]) < 0.3);
  }
  int appears[SP_COUNT] = { 0 };
  for (int s = 0; s < SZ_COUNT; s++) {
    int sum = 0;
    for (int k = 0; k < SP_COUNT; k++) { sum += SPECIES_PERMILLE[s][k]; if (SPECIES_PERMILLE[s][k]) appears[k] = 1; }
    CHECK(sum == 1000);
    int cnt[SP_COUNT] = { 0 };
    for (int i = 0; i < N; i++) cnt[game_roll_species(&g, (FishSize)s)]++;
    for (int k = 0; k < SP_COUNT; k++) {
      double p = 1000.0 * cnt[k] / N;   // ‰
      if (SPECIES_PERMILLE[s][k] == 0) CHECK(cnt[k] == 0);
      else CHECK(fabs(p - SPECIES_PERMILLE[s][k]) < 2.0 + SPECIES_PERMILLE[s][k] * 0.02);
    }
  }
  // 25種類すべてがどこかのサイズで出現する
  for (int k = 0; k < SP_COUNT; k++) CHECK(appears[k]);
  // 主要な確率（黄金の魚は大の1%、長靴は各サイズ5%）
  CHECK(SPECIES_PERMILLE[SZ_LARGE][SP_GOLD] == 10);
  CHECK(SPECIES_PERMILLE[SZ_SMALL][SP_GOLD] == 0 && SPECIES_PERMILLE[SZ_MEDIUM][SP_GOLD] == 0);
  for (int s = 0; s < SZ_COUNT; s++) CHECK(SPECIES_PERMILLE[s][SP_BOOT] == 50);
}

static void test_points(void) {
  g_case = "points";
  CHECK(SP_COUNT == 25);
  // 得点：長靴は0点、それ以外は並び順に増える（同点はあり）
  CHECK(SPECIES_POINTS[SP_BOOT] == 0);
  CHECK(SPECIES_POINTS[SP_MEDAKA] == 10 && SPECIES_POINTS[SP_GOLD] == 500);
  for (int k = 0; k + 1 < SP_GOLD + 1; k++) CHECK(SPECIES_POINTS[k] > 0 && SPECIES_POINTS[k + 1] >= SPECIES_POINTS[k]);
  // 旧版から引き継いだ魚の得点は同じ
  CHECK(SPECIES_POINTS[SP_FUNA] == 20 && SPECIES_POINTS[SP_BLUEGILL] == 30 && SPECIES_POINTS[SP_BASS] == 50);
  CHECK(SPECIES_POINTS[SP_KOI] == 80 && SPECIES_POINTS[SP_NISHIKI] == 150 && SPECIES_POINTS[SP_NAMAZU] == 200);
  // 名前がすべて設定されている
  for (int k = 0; k < SP_COUNT; k++) CHECK(SPECIES_NAME_JP[k] && SPECIES_NAME_JP[k][0] && SPECIES_NAME_EN[k] && SPECIES_NAME_EN[k][0]);

  // 連続で釣って得点が正しく加算される
  Game g; GameInput a = press_a(), n = none();
  int total = 0;
  setup_single(&g, 215.0f, SZ_LARGE, SP_GOLD);
  Species seq[4] = { SP_GOLD, SP_BOOT, SP_KOI, SP_MEDAKA };
  for (int k = 0; k < 4; k++) {
    Fish *f = &g.fish[2];
    memset(f, 0, sizeof(*f));
    f->state = FS_SWIM; f->size = SZ_LARGE; f->species = seq[k]; f->points = SPECIES_POINTS[seq[k]];
    f->len = SIZE_LEN[SZ_LARGE]; f->x = 215; f->y = game_lane_y(2); f->dir = 1; f->turn_t = 999; f->alpha = 1;
    for (int i = 0; i < 300 && g.state != ST_AIMING; i++) game_update(&g, DT, &n);
    cast_at(&g, 200.0f);
    for (int i = 0; i < 1000 && g.state != ST_HIT_WINDOW; i++) game_update(&g, DT, &n);
    g.time_left = GAME_TIME_SEC;
    (void)a;
    land(&g);
    CHECK(g.state == ST_CAUGHT);
    if (k == 0) CHECK((g.events & EV_GOLD) != 0);
    total += SPECIES_POINTS[seq[k]];
    CHECK(g.score == total);
    CHECK(g.last_species == seq[k]);
  }
  CHECK(g.score == 590);
  CHECK(g.hooks == 4 && g.fish_caught == 3);   // 長靴は魚の数に含めない
  CHECK(g.rarest == SP_GOLD);
  CHECK(g.casts == 4 && game_success_rate(&g) == 100);
}

static void test_fish_movement(void) {
  g_case = "fish_move";
  for (uint32_t seed = 1; seed <= 20; seed++) {
    Game g; game_init(&g, seed * 97u); game_start(&g);
    GameInput n = none();
    float start_x[FISH_COUNT]; int turned[FISH_COUNT] = { 0 }; int dir0[FISH_COUNT];
    for (int i = 0; i < FISH_COUNT; i++) { start_x[i] = g.fish[i].x; dir0[i] = g.fish[i].dir; }
    int ok_bounds = 1, ok_lane = 1, moved = 1;
    for (int t = 0; t < 60 * 20 && g.state == ST_AIMING; t++) {
      // 制限時間で終わらないように延長
      g.time_left = GAME_TIME_SEC;
      game_update(&g, DT, &n);
      for (int i = 0; i < FISH_COUNT; i++) {
        Fish *f = &g.fish[i];
        if (f->state == FS_NONE) continue;
        if (f->x - f->len / 2 < LAKE_X_MIN - 0.01f || f->x + f->len / 2 > LAKE_X_MAX + 0.01f) ok_bounds = 0;
        if (fabsf(f->y - game_lane_y(i)) > LANE_JITTER + 0.01f) ok_lane = 0;
        if (f->dir != dir0[i]) turned[i] = 1;
      }
    }
    for (int i = 0; i < FISH_COUNT; i++) if (fabsf(g.fish[i].x - start_x[i]) < 1e-3f && !turned[i]) moved = 0;
    CHECK(ok_bounds);
    CHECK(ok_lane);
    CHECK(moved);
    for (int i = 0; i < FISH_COUNT; i++) CHECK(turned[i]);   // 20秒あれば向きを変える
    // 魚影のY座標はすべて異なる
    for (int i = 0; i < FISH_COUNT; i++)
      for (int j = i + 1; j < FISH_COUNT; j++)
        CHECK(fabsf(g.fish[i].y - g.fish[j].y) > LANE_STEP - 2 * LANE_JITTER - 0.01f);
  }
  // 速度：小 > 中 > 大
  CHECK(SIZE_SPEED[SZ_SMALL] > SIZE_SPEED[SZ_MEDIUM] && SIZE_SPEED[SZ_MEDIUM] > SIZE_SPEED[SZ_LARGE]);
}

static void test_respawn(void) {
  g_case = "respawn";
  Game g; GameInput a = press_a(), n = none();
  to_hit(&g, SZ_SMALL, SP_MEDAKA);
  for (int i = 0; i < FISH_COUNT; i++) if (i != 2) g.fish[i].respawn_t = 999;
  (void)a;
  land(&g);
  CHECK(g.state == ST_CAUGHT && g.fish[2].state == FS_NONE);
  float r = g.fish[2].respawn_t;
  CHECK(r >= RESPAWN_MIN && r <= RESPAWN_MAX);
  int frames = 0;
  while (g.fish[2].state == FS_NONE && frames < 400) { game_update(&g, DT, &n); frames++; }
  CHECK(g.fish[2].state == FS_SWIM);
  CHECK(fabsf(frames * DT - r) <= DT * 1.5f);
  CHECK(g.fish[2].id != 99);   // 新しい個体
}

static void test_time_up(void) {
  g_case = "time_up";
  Game g; GameInput a = press_a(), n = none();
  to_hit(&g, SZ_LARGE, SP_NISHIKI);
  g.time_left = 30.0f;
  land(&g);                         // 時間切れ前に確定 → 得点に含める
  CHECK(g.state == ST_CAUGHT && g.score == 150);
  g.time_left = 0.03f;
  game_update(&g, DT, &n);
  game_update(&g, DT, &n);
  CHECK(g.state == ST_RESULT);
  CHECK(g.time_left == 0.0f);
  CHECK(g.score == 150 && g.high_score == 150 && g.new_record);

  // やりとり中に時間切れ → 釣れていないので得点にならない
  {
    Game h; to_hit(&h, SZ_LARGE, SP_KOI);
    GameInput ah = press_a(); ah.a_held = true;
    game_update(&h, DT, &ah);
    CHECK(h.state == ST_FIGHT);
    h.time_left = 0.05f;
    fight_bot(&h, 0, 0.6f);
    CHECK(h.state == ST_RESULT && h.score == 0 && h.hooks == 0);
  }

  // 合わせ待ち中に時間切れ → 新しい操作は受け付けない
  to_hit(&g, SZ_SMALL, SP_MEDAKA);
  int hs = g.high_score;
  g.time_left = 0.001f;
  game_update(&g, DT, &a);
  CHECK(g.state == ST_RESULT && g.score == 0);
  CHECK(g.high_score == hs && !g.new_record);
  // 結果画面になった直後の A ではリトライしない（誤操作防止）
  game_update(&g, DT, &a);
  CHECK(g.state == ST_RESULT);
  step(&g, (int)(TIMEUP_LOCK_TIME / DT) + 2, &n);
  game_update(&g, DT, &a);
  CHECK(g.state == ST_AIMING);

  // 60秒で終わる
  game_init(&g, 5); game_start(&g);
  int frames = 0;
  while (g.state != ST_RESULT && frames < 60 * 70) { game_update(&g, DT, &n); frames++; }
  CHECK(g.state == ST_RESULT);
  CHECK(fabsf(frames * DT - GAME_TIME_SEC) <= DT * 1.5f);
}

static void test_pause(void) {
  g_case = "pause";
  Game g; GameInput st = none(), n = none(), a = press_a(); st.start = true;
  to_hit(&g, SZ_MEDIUM, SP_BASS);
  float t = g.time_left, s_t = g.state_t, fx = g.fish[0].x;
  game_update(&g, DT, &st);
  CHECK(g.state == ST_PAUSE && g.paused_from == ST_HIT_WINDOW);
  step(&g, 600, &n);   // 10秒放置
  CHECK(g.time_left == t);
  CHECK(g.state_t == s_t);   // 合わせの猶予も減らない
  CHECK(g.fish[0].x == fx);
  game_update(&g, DT, &st);  // STARTで再開
  CHECK(g.state == ST_HIT_WINDOW);
  game_update(&g, DT, &a);
  CHECK(g.state == ST_FIGHT);
  // やりとり中の一時停止：テンション・巻き上げ・暴れの周期が止まる
  {
    GameInput h = none(); h.a_held = true;
    step(&g, 20, &h);
    float ten = g.tension, prog = g.progress, rt = g.rush_t; int rp = g.rush_phase;
    game_update(&g, DT, &st);
    CHECK(g.state == ST_PAUSE && g.paused_from == ST_FIGHT);
    step(&g, 600, &h);       // 押しっぱなしで10秒放置
    CHECK(g.tension == ten && g.progress == prog && g.rush_t == rt && g.rush_phase == rp);
    game_update(&g, DT, &st);
    CHECK(g.state == ST_FIGHT);
  }
  fight_bot(&g, 0, 0.6f);
  CHECK(g.state == ST_CAUGHT);

  // メニュー：上下で選択、Aで決定
  game_update(&g, DT, &st);
  GameInput dn = none(); dn.down = true;
  game_update(&g, DT, &dn);
  CHECK(g.pause_sel == 1);
  game_update(&g, DT, &a);
  CHECK(g.state == ST_TITLE && g.score == 0);
  CHECK(!g.quit);

  // ゲームを終了する
  game_start(&g);
  game_update(&g, DT, &st);
  GameInput q = none(); q.cmd = CMD_QUIT;
  game_update(&g, DT, &q);
  CHECK(g.quit);
  // 上キーで末尾へ回り込む
  game_init(&g, 3); game_start(&g);
  game_update(&g, DT, &st);
  GameInput up = none(); up.up = true;
  game_update(&g, DT, &up);
  CHECK(g.pause_sel == 2);
}

static void test_retry_resets(void) {
  g_case = "retry";
  Game g; GameInput a = press_a(), n = none();
  to_hit(&g, SZ_LARGE, SP_NAMAZU);
  (void)a;
  land(&g);
  CHECK(g.score == 200);
  g.time_left = 0.001f;
  game_update(&g, DT, &n);
  CHECK(g.state == ST_RESULT && g.high_score == 200);
  step(&g, (int)(TIMEUP_LOCK_TIME / DT) + 2, &n);
  GameInput r = none(); r.cmd = CMD_RETRY;
  game_update(&g, DT, &r);
  CHECK(g.state == ST_AIMING);
  CHECK(g.score == 0 && g.casts == 0 && g.hooks == 0 && g.fish_caught == 0 && g.rarest == -1);
  CHECK(fabsf(g.time_left - GAME_TIME_SEC) < 1e-4f);
  CHECK(!g.bobber_out && g.target == -1);
  int sum = 0; for (int k = 0; k < SP_COUNT; k++) sum += g.counts[k];
  CHECK(sum == 0);
  CHECK(g.high_score == 200);   // ハイスコアは保持
  for (int i = 0; i < FISH_COUNT; i++) CHECK(g.fish[i].state == FS_SWIM);
}

static void test_rank(void) {
  g_case = "rank";
  CHECK(game_rank(0) == 'D');   CHECK(game_rank(99) == 'D');
  CHECK(game_rank(100) == 'C'); CHECK(game_rank(249) == 'C');
  CHECK(game_rank(250) == 'B'); CHECK(game_rank(499) == 'B');
  CHECK(game_rank(500) == 'A'); CHECK(game_rank(799) == 'A');
  CHECK(game_rank(800) == 'S'); CHECK(game_rank(5000) == 'S');
  Game g; game_init(&g, 1);
  CHECK(game_success_rate(&g) == 0);
  g.casts = 3; g.hooks = 2;
  CHECK(game_success_rate(&g) == 67);
}

static void test_variable_dt(void) {
  g_case = "variable_dt";
  // フレームレートが変わっても制限時間は実時間どおり
  Game g; GameInput n = none();
  game_init(&g, 9); game_start(&g);
  float total = 0; int k = 0;
  while (g.state != ST_RESULT && k < 100000) {
    float dt = (k % 3 == 0) ? 1.0f / 30.0f : 1.0f / 60.0f;
    game_update(&g, dt, &n); total += dt; k++;
  }
  CHECK(fabsf(total - GAME_TIME_SEC) < 0.04f);
}

static void test_fight_basic(void) {
  g_case = "fight_basic";
  Game g; GameInput hold = none(), rel = none(); hold.a_held = true;
  GameInput a = press_a(); a.a_held = true;

  // メダカは押しっぱなしでも釣れる（暴れない・巻き上げが速い）
  to_hit(&g, SZ_SMALL, SP_MEDAKA);
  game_update(&g, DT, &a);
  CHECK(g.state == ST_FIGHT && fabsf(g.tension - FIGHT_START_TENSION) < 0.05f);
  int ok_range = 1, frames = 0;
  while (g.state == ST_FIGHT && frames < 600) {
    game_update(&g, DT, &hold); frames++;
    if (g.tension < 0 || g.tension > 1) ok_range = 0;
  }
  CHECK(ok_range);
  CHECK(g.state == ST_CAUGHT && g.score == 10);
  CHECK(frames * DT < 1.0f);

  // 黄金の魚を押しっぱなし → 糸が切れる
  to_hit(&g, SZ_LARGE, SP_GOLD);
  game_update(&g, DT, &a);
  frames = 0;
  while (g.state == ST_FIGHT && frames < 600) { game_update(&g, DT, &hold); frames++; }
  CHECK(g.state == ST_MISSED && g.miss_reason == MISS_LINE_BREAK);
  CHECK(g.score == 0 && g.hooks == 0);
  CHECK(g.fish[2].state == FS_FLEE);

  // コイで何もしない → テンションが0になって針が外れる
  to_hit(&g, SZ_LARGE, SP_KOI);
  game_update(&g, DT, &a);
  frames = 0;
  while (g.state == ST_FIGHT && frames < 600) { game_update(&g, DT, &rel); frames++; }
  CHECK(g.state == ST_MISSED && g.miss_reason == MISS_SLACK);
  CHECK(g.score == 0);

  // 暴れている間は巻いても巻き上げが進まない（むしろ引き出される）
  to_hit(&g, SZ_LARGE, SP_NAMAZU);
  game_update(&g, DT, &a);
  g.rush_phase = RUSH_ON; g.rush_t = 0.5f; g.tension = 0.2f; g.progress = 0.5f;
  game_update(&g, DT, &hold);
  CHECK(g.progress < 0.5f);
  // 予兆中は巻ける
  g.rush_phase = RUSH_WARN; g.rush_t = 0.2f; g.tension = 0.2f; g.progress = 0.5f;
  game_update(&g, DT, &hold);
  CHECK(g.progress > 0.5f);

  // 巻き上げに合わせて魚が桟橋へ寄る
  to_hit(&g, SZ_MEDIUM, SP_BASS);
  game_update(&g, DT, &a);
  float d0 = hypotf(g.fish[2].x - LAND_X, g.fish[2].y - LAND_Y);
  g.progress = 0.5f;
  game_update(&g, DT, &rel);
  float d1 = hypotf(g.fish[2].x - LAND_X, g.fish[2].y - LAND_Y);
  CHECK(d1 < d0 * 0.6f);

  // パラメータ表：レアな魚ほど巻き上げが遅く、暴れが強く、予兆が短い
  for (int k = SP_MOTSUGO; k < SP_GOLD; k++) {
    CHECK(FIGHT_PARAMS[k + 1].reel < FIGHT_PARAMS[k].reel);
    CHECK(FIGHT_PARAMS[k + 1].rush > FIGHT_PARAMS[k].rush);
    CHECK(FIGHT_PARAMS[k + 1].warn <= FIGHT_PARAMS[k].warn);
  }
}

static void test_feint(void) {
  g_case = "feint";
  GameInput n = none(), a = press_a();
  Game g;

  // フェイント中に A → 「フェイントにだまされた」失敗、魚は逃げる
  int tested = 0;
  for (int s = 1; s <= 50 && !tested; s++) {
    setup_single(&g, 215.0f, SZ_LARGE, SP_GOLD);
    g.rng = (uint32_t)s * 2246822519u;
    cast_at(&g, 200.0f);
    for (int i = 0; i < 600 && g.state == ST_FISH_APPROACH; i++) game_update(&g, DT, &n);
    CHECK(g.state == ST_WAIT_BITE);
    CHECK(g.feint_count >= 2 && g.feint_count <= 4);   // 黄金の魚は2〜4回
    int saw_event = 0;
    for (int i = 0; i < 600 && !game_feint_active(&g); i++) {
      game_update(&g, DT, &n);
      if (g.events & EV_FEINT) saw_event = 1;
    }
    CHECK(game_feint_active(&g) && saw_event);
    CHECK(g.state == ST_WAIT_BITE);                    // 沈んでも HIT にはならない
    game_update(&g, DT, &a);
    CHECK(g.state == ST_MISSED && g.miss_reason == MISS_FEINT);
    CHECK(g.fish[2].state == FS_FLEE && g.score == 0);
    tested = 1;
  }
  CHECK(tested);

  // フェイントを見送れば、フェイントの回数だけ EV_FEINT が起きてから本物の食いつき
  for (int s = 1; s <= 100; s++) {
    setup_single(&g, 215.0f, SZ_LARGE, SP_NAMAZU);
    g.rng = (uint32_t)s * 3266489917u;
    cast_at(&g, 200.0f);
    for (int i = 0; i < 600 && g.state == ST_FISH_APPROACH; i++) game_update(&g, DT, &n);
    int nf = g.feint_count, seen = 0, frames = 0, overlap = 0;
    for (int i = 0; i < nf; i++)   // 本物の食いつきはフェイントが終わってから
      if (g.feint_at[i] + FEINT_TIME > g.bite_wait) overlap = 1;
    for (int i = 1; i < nf; i++)   // フェイントどうしは重ならない
      if (g.feint_at[i] < g.feint_at[i - 1] + FEINT_TIME) overlap = 1;
    while (g.state == ST_WAIT_BITE && frames < 900) {
      game_update(&g, DT, &n); frames++;
      if (g.events & EV_FEINT) seen++;
    }
    CHECK(!overlap);
    CHECK(seen == nf);
    CHECK(g.state == ST_HIT_WINDOW);
    CHECK(nf >= FEINT_MIN_COUNT[SP_NAMAZU] && nf <= FEINT_MAX_COUNT[SP_NAMAZU]);
  }

  // 魚種ごとのフェイント回数：表の範囲に収まり、レアな魚ほど平均が多い
  float avg[SP_COUNT];
  printf("  フェイント回数の平均（各2000回）:");
  for (int k = 0; k < SP_COUNT; k++) {
    int sum = 0, ok = 1, hit_min = 0, hit_max = 0;
    Game h; game_init(&h, 1000u + k);
    for (int i = 0; i < 2000; i++) {
      // 実際にキャスト→接近させて、食いつき待ちの予定を作らせる
      setup_single(&h, 215.0f, SZ_LARGE, (Species)k);
      h.rng = (uint32_t)(i * 2654435761u + k) | 1u;
      cast_at(&h, 200.0f);
      for (int j = 0; j < 600 && h.state == ST_FISH_APPROACH; j++) game_update(&h, DT, &n);
      int c = h.feint_count;
      if (c < FEINT_MIN_COUNT[k] || c > FEINT_MAX_COUNT[k]) ok = 0;
      if (c == FEINT_MIN_COUNT[k]) hit_min = 1;
      if (c == FEINT_MAX_COUNT[k]) hit_max = 1;
      sum += c;
    }
    avg[k] = sum / 2000.0f;
    printf(" %s=%.2f", SPECIES_NAME_EN[k], avg[k]);
    CHECK(ok && hit_min && hit_max);
  }
  printf("\n");
  for (int k = SP_MEDAKA; k < SP_GOLD; k++) CHECK(avg[k + 1] >= avg[k] - 0.05f);
  CHECK(avg[SP_GOLD] > avg[SP_MEDAKA] + 2.0f);
}

// 自動プレイヤーで成功率と所要時間を測り、
// 「レアな魚ほど難しい」「それでも人間の反応速度で釣れる」ことを確かめる
static void test_fight_difficulty(void) {
  g_case = "fight_difficulty";
  const int N = 200;
  float rate_slow[SP_COUNT], rate_greedy[SP_COUNT], rate_greedy2[SP_COUNT], avg_time[SP_COUNT];
  printf("  やりとり難易度（%d回ずつの成功率と、上手な場合の平均時間）\n", N);
  printf("  %-14s %8s %10s %10s %10s %8s\n", "species", "perfect", "slow", "greedy0.7", "greedy0.8", "time");
  for (int k = 0; k < SP_COUNT; k++) {
    int ok_perfect = 0, ok_slow = 0, ok_greedy = 0, ok_greedy2 = 0; float tsum = 0;
    for (int s = 0; s < N; s++) {
      for (int mode = 0; mode < 4; mode++) {
        Game g; to_hit(&g, SZ_LARGE, (Species)k);
        g.rng = (uint32_t)(s * 7919 + k * 104729 + mode * 31) | 1u;
        g.time_left = GAME_TIME_SEC;
        GameInput a = press_a(); a.a_held = true;
        game_update(&g, DT, &a);
        int fr;
        if (mode == 0) fr = fight_bot(&g, 0, 0.6f);        // 反応が完璧
        else if (mode == 1) fr = fight_bot(&g, 15, 0.5f);  // 反応0.25秒・控えめに巻く
        else if (mode == 2) fr = fight_bot(&g, 15, 0.7f);  // 反応0.25秒・欲張って巻く
        else fr = fight_bot(&g, 15, 0.8f);                  // 反応0.25秒・かなり欲張る
        bool ok = g.state == ST_CAUGHT;
        if (mode == 0) { ok_perfect += ok; if (ok) tsum += fr * DT; }
        else if (mode == 1) ok_slow += ok;
        else if (mode == 2) ok_greedy += ok;
        else ok_greedy2 += ok;
      }
    }
    rate_slow[k] = 100.0f * ok_slow / N;
    rate_greedy[k] = 100.0f * ok_greedy / N;
    rate_greedy2[k] = 100.0f * ok_greedy2 / N;
    avg_time[k] = ok_perfect ? tsum / ok_perfect : 0;
    printf("  %-14s %7.0f%% %9.0f%% %9.0f%% %9.0f%% %7.1fs\n", SPECIES_NAME_EN[k],
           100.0f * ok_perfect / N, rate_slow[k], rate_greedy[k], rate_greedy2[k], avg_time[k]);
    CHECK(ok_perfect == N);          // 上手に操作すればどの魚も必ず釣れる
    CHECK(rate_slow[k] >= 80.0f);    // 人間程度の反応速度でも十分釣れる
  }
  // レアな魚ほど時間がかかり、欲張ると失敗しやすい
  for (int k = SP_MEDAKA; k < SP_GOLD; k++) {
    CHECK(avg_time[k + 1] > avg_time[k] - 0.3f);   // 隣どうしは差が小さいので多少の揺れは許す
    CHECK(rate_greedy[k + 1] <= rate_greedy[k] + 6.0f);
    CHECK(rate_greedy2[k + 1] <= rate_greedy2[k] + 6.0f);
  }
  CHECK(rate_greedy[SP_MEDAKA] == 100.0f);
  CHECK(rate_greedy[SP_GOLD] < 30.0f);
  CHECK(rate_greedy2[SP_NAMAZU] < 30.0f && rate_greedy2[SP_GOLD] < 10.0f);
  CHECK(avg_time[SP_GOLD] < 15.0f);   // 60秒のうち長くても15秒以内
}

static void test_discovery(void) {
  g_case = "discovery";
  Game g; GameInput n = none();
  game_init(&g, 11);
  CHECK(game_discovered_count(&g) == 0);
  for (int k = 0; k < SP_COUNT; k++) CHECK(!g.discovered[g.player][k]);

  // 初めて釣った魚は発見済みになり、NEW 扱い
  to_hit(&g, SZ_SMALL, SP_TANAGO);
  land(&g);
  CHECK(g.state == ST_CAUGHT && g.discovered[g.player][SP_TANAGO] && g.last_new);
  CHECK(game_discovered_count(&g) == 1);
  // to_hit は内部で新しいゲームを始めるが、ずかんはそのまま
  Game keep = g;
  // 同じゲーム内で同じ魚をもう一度 → NEW ではない
  for (int i = 0; i < 200 && g.state != ST_AIMING; i++) game_update(&g, DT, &n);
  Fish *f = &g.fish[2];
  memset(f, 0, sizeof(*f));
  f->state = FS_SWIM; f->size = SZ_SMALL; f->species = SP_TANAGO; f->points = SPECIES_POINTS[SP_TANAGO];
  f->len = SIZE_LEN[SZ_SMALL]; f->x = 215; f->y = game_lane_y(2); f->dir = 1; f->turn_t = 999; f->alpha = 1;
  for (int i = 0; i < FISH_COUNT; i++) if (i != 2) { g.fish[i].state = FS_NONE; g.fish[i].respawn_t = 999; }
  cast_at(&g, 200.0f);
  for (int i = 0; i < 1000 && g.state != ST_HIT_WINDOW; i++) game_update(&g, DT, &n);
  land(&g);
  CHECK(g.state == ST_CAUGHT && !g.last_new && g.counts[SP_TANAGO] == 2);
  CHECK(game_discovered_count(&g) == 1);

  // リトライしても、タイトルに戻っても、ずかんは消えない（今回の釣果数は0に戻る）
  g.time_left = 0.001f; game_update(&g, DT, &n);
  step(&g, (int)(TIMEUP_LOCK_TIME / DT) + 2, &n);
  GameInput r = none(); r.cmd = CMD_RETRY;
  game_update(&g, DT, &r);
  CHECK(g.state == ST_AIMING && g.counts[SP_TANAGO] == 0 && g.discovered[g.player][SP_TANAGO]);
  GameInput st = none(); st.start = true;
  game_update(&g, DT, &st);
  GameInput t = none(); t.cmd = CMD_TITLE;
  game_update(&g, DT, &t);
  CHECK(g.state == ST_TITLE && g.discovered[g.player][SP_TANAGO] && !g.last_new);
  // 起動し直す（game_init）と消える
  game_init(&g, 12);
  CHECK(game_discovered_count(&g) == 0);
  (void)keep;

  // 長靴も「発見」に数える。全25種そろえられる
  for (int k = 0; k < SP_COUNT; k++) {
    Game h; to_hit(&h, SZ_LARGE, (Species)k);
    memcpy(h.discovered, g.discovered, sizeof(g.discovered));
    land(&h);
    CHECK(h.state == ST_CAUGHT && h.last_new);
    memcpy(g.discovered, h.discovered, sizeof(g.discovered));
  }
  CHECK(game_discovered_count(&g) == SP_COUNT);
}

// プレイ中のゲームで、指定した魚を1匹釣り上げる（ずかん・TOP5 はそのまま）
static void catch_one(Game *g, Species sp) {
  GameInput n = none();
  for (int i = 0; i < 200 && g->state != ST_AIMING; i++) game_update(g, DT, &n);
  Fish *f = &g->fish[2];
  memset(f, 0, sizeof(*f));
  f->state = FS_SWIM; f->size = SZ_LARGE; f->species = sp; f->points = SPECIES_POINTS[sp];
  f->len = SIZE_LEN[SZ_LARGE]; f->x = 215; f->y = game_lane_y(2); f->dir = 1; f->turn_t = 999; f->alpha = 1;
  for (int i = 0; i < FISH_COUNT; i++) if (i != 2) { g->fish[i].state = FS_NONE; g->fish[i].respawn_t = 999; }
  float t = g->time_left;
  cast_at(g, 200.0f);
  for (int i = 0; i < 1000 && g->state != ST_HIT_WINDOW; i++) game_update(g, DT, &n);
  land(g);
  g->time_left = t;   // 制限時間で終わらないように戻す
}
// 時間切れにして結果画面を出し、入力を受け付けるまで進める
static void end_game(Game *g) {
  GameInput n = none();
  g->time_left = 0.001f;
  game_update(g, DT, &n);
  step(g, (int)(TIMEUP_LOCK_TIME / DT) + 2, &n);
}
static void to_title(Game *g) {
  GameInput t = none(); t.cmd = CMD_TITLE;
  game_update(g, DT, &t);
}

static void test_player_select(void) {
  g_case = "player_select";
  Game g; GameInput n = none();
  game_init(&g, 21);
  CHECK(g.state == ST_TITLE && g.player == PL_BOY);
  GameInput r = none(); r.right = true;
  GameInput l = none(); l.left = true;
  game_update(&g, DT, &r);
  CHECK(g.player == PL_GIRL && (g.events & EV_MENU) && g.state == ST_TITLE);
  game_update(&g, DT, &r);                       // もう右端なので変わらない・音も鳴らない
  CHECK(g.player == PL_GIRL && !(g.events & EV_MENU));
  game_update(&g, DT, &l);
  CHECK(g.player == PL_BOY && (g.events & EV_MENU));
  game_update(&g, DT, &l);
  CHECK(g.player == PL_BOY && !(g.events & EV_MENU));
  // 顔のタッチ
  GameInput tg = none(); tg.cmd = CMD_SEL_GIRL;
  game_update(&g, DT, &tg);
  CHECK(g.player == PL_GIRL);
  GameInput tb = none(); tb.cmd = CMD_SEL_BOY;
  game_update(&g, DT, &tb);
  CHECK(g.player == PL_BOY);
  game_update(&g, DT, &tg);
  // スタートすると選んだ人であそぶ。プレイ中の左右では人は変わらない
  GameInput a = press_a();
  game_update(&g, DT, &a);
  CHECK(g.state == ST_AIMING && g.player == PL_GIRL);
  game_update(&g, DT, &l);
  game_update(&g, DT, &tb);
  CHECK(g.player == PL_GIRL);
  // 一時停止からタイトルに戻っても、前回えらんだ人のまま
  GameInput st = none(); st.start = true;
  game_update(&g, DT, &st);
  to_title(&g);
  CHECK(g.state == ST_TITLE && g.player == PL_GIRL);
  // 結果画面からリトライしても同じ人のまま
  game_update(&g, DT, &a);
  end_game(&g);
  GameInput re = none(); re.cmd = CMD_RETRY;
  game_update(&g, DT, &re);
  CHECK(g.state == ST_AIMING && g.player == PL_GIRL);
  (void)n;
}

static void test_player_zukan(void) {
  g_case = "player_zukan";
  Game g;
  GameInput a = press_a(), r = none(), l = none();
  r.right = true; l.left = true;
  game_init(&g, 22);
  // 女の子でタナゴを釣る → 女の子のずかんにだけ載る
  game_update(&g, DT, &r);
  game_update(&g, DT, &a);
  catch_one(&g, SP_TANAGO);
  CHECK(g.state == ST_CAUGHT && g.last_new);
  CHECK(g.discovered[PL_GIRL][SP_TANAGO] && !g.discovered[PL_BOY][SP_TANAGO]);
  CHECK(game_discovered_count_of(&g, PL_GIRL) == 1 && game_discovered_count_of(&g, PL_BOY) == 0);
  CHECK(game_discovered_count(&g) == 1 && game_is_discovered(&g, SP_TANAGO));
  end_game(&g); to_title(&g);
  // 男の子に切り替える → 男の子のずかんは空。同じタナゴでも男の子には NEW
  game_update(&g, DT, &l);
  CHECK(g.player == PL_BOY && game_discovered_count(&g) == 0 && !game_is_discovered(&g, SP_TANAGO));
  game_update(&g, DT, &a);
  catch_one(&g, SP_TANAGO);
  CHECK(g.state == ST_CAUGHT && g.last_new);
  catch_one(&g, SP_KOI);
  CHECK(g.state == ST_CAUGHT && g.last_new);
  CHECK(game_discovered_count_of(&g, PL_BOY) == 2 && game_discovered_count_of(&g, PL_GIRL) == 1);
  CHECK(!g.discovered[PL_GIRL][SP_KOI]);
  end_game(&g); to_title(&g);
  // 女の子に戻す → 女の子のずかんはそのまま。タナゴはもう NEW ではない
  game_update(&g, DT, &r);
  game_update(&g, DT, &a);
  CHECK(game_discovered_count(&g) == 1);
  catch_one(&g, SP_TANAGO);
  CHECK(g.state == ST_CAUGHT && !g.last_new);
  // 起動し直すと両方とも消える
  game_init(&g, 23);
  CHECK(game_discovered_count_of(&g, PL_BOY) == 0 && game_discovered_count_of(&g, PL_GIRL) == 0);
}

static void test_top5(void) {
  g_case = "top5";
  Game g;
  game_init(&g, 31);
  CHECK(g.top_count == 0 && g.top_pos == -1 && g.high_score == 0);
  // 記録の並び（得点の高い順、同点は先に出した方が上、6位以下と0点は残らない）
  game_record_score(&g, 100, PL_BOY);  CHECK(g.top_pos == 0 && g.top_count == 1);
  game_record_score(&g, 0, PL_GIRL);   CHECK(g.top_pos == -1 && g.top_count == 1);
  game_record_score(&g, 50, PL_GIRL);  CHECK(g.top_pos == 1 && g.top_count == 2);
  game_record_score(&g, 100, PL_GIRL); CHECK(g.top_pos == 1 && g.top_count == 3);
  game_record_score(&g, 300, PL_BOY);  CHECK(g.top_pos == 0 && g.top_count == 4);
  game_record_score(&g, 10, PL_BOY);   CHECK(g.top_pos == 4 && g.top_count == 5);
  game_record_score(&g, 5, PL_GIRL);   CHECK(g.top_pos == -1 && g.top_count == 5);   // 圏外
  game_record_score(&g, 10, PL_GIRL);  CHECK(g.top_pos == -1);                       // 5位と同点は先の人が残る
  game_record_score(&g, 200, PL_GIRL); CHECK(g.top_pos == 1 && g.top_count == 5);
  const int    want_s[5] = { 300, 200, 100, 100, 50 };
  const Player want_p[5] = { PL_BOY, PL_GIRL, PL_BOY, PL_GIRL, PL_GIRL };
  for (int i = 0; i < TOP_COUNT; i++) CHECK(g.top[i].score == want_s[i] && g.top[i].player == want_p[i]);
  CHECK(g.high_score == 300);

  // 実際のゲームの流れ：時間切れで、そのときの人と得点が記録される
  game_init(&g, 32);
  GameInput a = press_a(), r = none(); r.right = true;
  game_update(&g, DT, &r);                       // 女の子
  game_update(&g, DT, &a);
  catch_one(&g, SP_NISHIKI);                     // 150点
  end_game(&g);
  CHECK(g.state == ST_RESULT && g.score == 150);
  CHECK(g.top_count == 1 && g.top_pos == 0 && g.top[0].score == 150 && g.top[0].player == PL_GIRL);
  CHECK(g.new_record && g.high_score == 150);
  // リトライすると「今回の順位」はリセット、記録は残る
  GameInput re = none(); re.cmd = CMD_RETRY;
  game_update(&g, DT, &re);
  CHECK(g.top_pos == -1 && g.top_count == 1 && !g.new_record);
  // 0点のゲームは記録しない
  end_game(&g);
  CHECK(g.score == 0 && g.top_pos == -1 && g.top_count == 1);
  // 男の子で 1位より低い点 → 2位に入る（NEW RECORD ではない）
  to_title(&g);
  GameInput l = none(); l.left = true;
  game_update(&g, DT, &l);
  game_update(&g, DT, &a);
  catch_one(&g, SP_KOI);                         // 80点
  end_game(&g);
  CHECK(g.top_pos == 1 && g.top[1].score == 80 && g.top[1].player == PL_BOY);
  CHECK(!g.new_record && g.high_score == 150);
  // 男の子で 1位を超える → NEW RECORD
  game_update(&g, DT, &re);
  catch_one(&g, SP_GOLD);                        // 500点
  end_game(&g);
  CHECK(g.top_pos == 0 && g.new_record && g.high_score == 500 && g.top[0].player == PL_BOY);
  CHECK(g.top_count == 3 && g.top[1].score == 150 && g.top[2].score == 80);
  // タイトルに戻っても記録は残り、起動し直すと消える
  to_title(&g);
  CHECK(g.top_count == 3 && g.high_score == 500);
  game_init(&g, 33);
  CHECK(g.top_count == 0 && g.high_score == 0);
}

// 記録部分（人・TOP5・ずかん）が同じか
static bool same_record(const Game *a, const Game *b) {
  if (a->player != b->player || a->top_count != b->top_count || a->high_score != b->high_score) return false;
  for (int i = 0; i < a->top_count; i++)
    if (a->top[i].score != b->top[i].score || a->top[i].player != b->top[i].player) return false;
  return memcmp(a->discovered, b->discovered, sizeof(a->discovered)) == 0 &&
         memcmp(a->caught_total, b->caught_total, sizeof(a->caught_total)) == 0;
}
static void make_record(Game *g) {
  game_init(g, 41);
  g->player = PL_GIRL;
  game_record_score(g, 820, PL_GIRL);
  game_record_score(g, 640, PL_BOY);
  game_record_score(g, 640, PL_GIRL);
  game_record_score(g, 15, PL_BOY);
  g->discovered[PL_BOY][SP_MEDAKA] = g->discovered[PL_BOY][SP_BOOT] = true;
  g->discovered[PL_GIRL][SP_GOLD] = g->discovered[PL_GIRL][SP_KOI] = true;
  g->caught_total[PL_BOY][SP_MEDAKA] = 12; g->caught_total[PL_BOY][SP_BOOT] = 1;
  g->caught_total[PL_GIRL][SP_GOLD] = 2; g->caught_total[PL_GIRL][SP_KOI] = 300;
}

static void test_save_encode(void) {
  g_case = "save_encode";
  Game g, h;
  make_record(&g);
  uint8_t buf[SAVE_SIZE];
  save_encode(&g, buf);
  game_init(&h, 42);
  CHECK(save_decode(&h, buf, SAVE_SIZE));
  CHECK(same_record(&g, &h));
  CHECK(h.player == PL_GIRL && h.top_count == 4 && h.high_score == 820);
  CHECK(h.top[2].score == 640 && h.top[2].player == PL_GIRL);
  CHECK(game_discovered_count_of(&h, PL_BOY) == 2 && game_discovered_count_of(&h, PL_GIRL) == 2);
  // TOP5 がいっぱい・全種発見でも戻せる
  for (int i = 0; i < 3; i++) game_record_score(&g, 1000 + i, PL_BOY);
  memset(g.discovered, 1, sizeof(g.discovered));
  save_encode(&g, buf);
  game_init(&h, 43);
  CHECK(save_decode(&h, buf, SAVE_SIZE) && same_record(&g, &h) && h.top_count == TOP_COUNT);
  // 空の記録も戻せる
  game_init(&g, 44);
  save_encode(&g, buf);
  make_record(&h);
  CHECK(save_decode(&h, buf, SAVE_SIZE) && same_record(&g, &h));

  // 壊れたデータは読まない（どの1バイトが変わっても検出し、ゲームの状態は変えない）
  make_record(&g);
  save_encode(&g, buf);
  int detected = 0;
  for (int i = 0; i < SAVE_SIZE; i++) {
    uint8_t bad[SAVE_SIZE];
    memcpy(bad, buf, SAVE_SIZE);
    bad[i] ^= 0x5A;
    game_init(&h, 45);
    Game before = h;
    bool ok = save_decode(&h, bad, SAVE_SIZE);
    detected += !ok;
    CHECK(!ok && same_record(&h, &before));
  }
  CHECK(detected == SAVE_SIZE);
  game_init(&h, 46);
  CHECK(!save_decode(&h, buf, SAVE_SIZE - 1));     // 長さ違い
  CHECK(!save_decode(&h, buf, 0));
  CHECK(h.top_count == 0);
}

static void test_save_file(void) {
  g_case = "save_file";
  const char *path = "test_tmp.sav", *tmp = "test_tmp.sav.tmp";
  remove(path); remove(tmp);
  Game g, h;
  // ファイルが無い → 読めない（記録は空のまま）
  game_init(&h, 51);
  CHECK(!save_read(path, &h) && h.top_count == 0);
  // 書いて読む
  make_record(&g);
  CHECK(save_write(path, &g));
  FILE *f = fopen(tmp, "rb"); CHECK(f == NULL); if (f) fclose(f);   // 一時ファイルは残らない
  game_init(&h, 52);
  CHECK(save_read(path, &h) && same_record(&g, &h));
  // 上書き保存（記録が増えた）
  game_record_score(&g, 999, PL_BOY);
  g.discovered[PL_BOY][SP_ITOU] = true;
  CHECK(save_write(path, &g));
  game_init(&h, 53);
  CHECK(save_read(path, &h) && same_record(&g, &h) && h.high_score == 999);
  // 置き換えの途中で電源が切れた（本体が消えて .tmp だけ残った）→ .tmp から読める
  rename(path, tmp);
  game_init(&h, 54);
  CHECK(save_read(path, &h) && same_record(&g, &h));
  remove(tmp);
  // 本体が壊れている → 読まない
  f = fopen(path, "wb"); fputs("broken", f); fclose(f);
  game_init(&h, 55);
  CHECK(!save_read(path, &h) && h.top_count == 0);
  // 書けない場所 → false（ゲームは続けられる）
  CHECK(!save_write("no_such_dir/x.sav", &g));
  remove(path); remove(tmp);
}

// ---- BGM ----
typedef struct { int wave; double t, dur; float freq, vol; double decay; } RecNote;
static RecNote rec[4096];
static int rec_n = 0;
static void rec_note(int wave, double t, double dur, float freq, float vol, double decay) {
  if (rec_n < 4096) rec[rec_n++] = (RecNote){ wave, t, dur, freq, vol, decay };
}
// now を 1/60 秒ずつ進めながら music_update を呼ぶ。予約が先読みの範囲を超えないことも確かめる
static int lookahead_ok = 1;
static double run_music(Music *m, double now, double until) {
  for (; now < until; now += 1.0 / 60.0) {
    int before = rec_n;
    music_update(m, now, rec_note);
    for (int i = before; i < rec_n; i++)
      if (rec[i].t > now + MUSIC_LOOKAHEAD + 1e-9 || rec[i].t < now - 1e-9) lookahead_ok = 0;
  }
  return now;
}
static int count_notes(const Song *s) {
  int n = 0;
  for (int p = 0; p < s->part_count; p++)
    for (int i = 0; i < s->parts[p].count; i++) n += s->parts[p].notes[i].note ? 1 : 0;
  return n;
}

static void test_music_data(void) {
  g_case = "music_data";
  for (int k = 0; k < SONG_COUNT; k++) {
    const Song *s = &SONGS[k];
    int total = song_steps(s, 0);
    CHECK(total > 0 && s->bpm >= 60 && s->bpm <= 200);
    CHECK(s->part_count >= 1 && s->part_count <= MUSIC_PARTS);
    for (int p = 0; p < s->part_count; p++) {
      const Part *pt = &s->parts[p];
      // 全パートの長さがそろっている（ずれずにループする）
      CHECK(song_steps(s, p) == total);
      CHECK(pt->wave == WAVE_SQ || pt->wave == WAVE_TRI);
      CHECK(pt->vol > 0 && pt->vol <= 0.35f && pt->gate > 0 && pt->gate <= 1.0f && pt->decay > 0);
      for (int i = 0; i < pt->count; i++) {
        CHECK(pt->notes[i].len >= 1);
        CHECK(pt->notes[i].note == 0 || (pt->notes[i].note >= 33 && pt->notes[i].note <= 96));
      }
    }
    // 1小節（3/4なら6、4/4なら8ステップ）の整数倍
    CHECK(total % 6 == 0 || total % 8 == 0);
    if (!s->loop) CHECK(s->next >= -1 && s->next < SONG_COUNT && SONGS[s->next].loop);
  }
  CHECK(fabsf(music_freq(69) - 440.0f) < 0.01f && fabsf(music_freq(81) - 880.0f) < 0.05f);
}

static void test_music_sequencer(void) {
  g_case = "music_seq";
  Music m;
  const Song *s = &SONGS[SONG_PLAY];
  int total = song_steps(s, 0);
  double step = 60.0 / s->bpm / 2.0;

  // 1周ぶんの音がすべて、決まったステップの時刻に予約される
  music_init(&m);
  rec_n = 0; lookahead_ok = 1;
  music_play(&m, SONG_PLAY, 0.0, false);
  double end1 = 0.05 + total * step;
  run_music(&m, 0.0, end1 - MUSIC_LOOKAHEAD - 0.02);
  CHECK(rec_n == count_notes(s));
  int on_grid = 1, ordered = 1;
  for (int i = 0; i < rec_n; i++) {
    double k = (rec[i].t - 0.05) / step;
    if (fabs(k - floor(k + 0.5)) > 1e-6) on_grid = 0;
    if (i > 0 && rec[i].t < rec[i - 1].t - 1e-9) ordered = 0;
  }
  CHECK(on_grid && ordered && lookahead_ok);
  CHECK(fabs(rec[0].t - 0.05) < 1e-9 && fabsf(rec[0].freq - music_freq(74)) < 0.01f);   // 最初の音は D5

  // 何周しても、テンポを変えても、各パートの頭がそろう
  music_init(&m);
  rec_n = 0;
  music_play(&m, SONG_PLAY, 0.0, false);
  double now = run_music(&m, 0.0, 30.0);
  music_set_speed(&m, 1.2f);
  run_music(&m, now, 60.0);
  CHECK(lookahead_ok);
  // 各周の頭（ステップ0）ではメロディ・ベースが同じ時刻に鳴る
  int loops = 0, aligned = 1;
  for (int i = 0; i < rec_n; i++) {
    if (rec[i].freq != music_freq(74) || rec[i].wave != WAVE_TRI || rec[i].vol != s->parts[0].vol) continue;
    // メロディの D5 のうち、同じ時刻にベースの G2 があるもの＝周の頭
    for (int j = 0; j < rec_n; j++)
      if (fabs(rec[j].t - rec[i].t) < 1e-9 && fabsf(rec[j].freq - music_freq(43)) < 0.01f) { loops++; break; }
  }
  CHECK(loops >= 5);
  // 周の頭以外でも、ベースの音はすべてメロディ・きざみと同じ時刻の格子に乗っている
  for (int i = 1; i < rec_n; i++) if (rec[i].t < rec[i - 1].t - 1e-9) aligned = 0;
  CHECK(aligned);
  // テンポを上げた後は音の間隔が短い
  double last_gap = 1e9;
  for (int i = rec_n - 1; i > 0; i--) {
    double d = rec[i].t - rec[i - 1].t;
    if (d > 1e-6) { last_gap = d; break; }
  }
  CHECK(last_gap < step * 0.9 && fabs(last_gap / (step / 1.2) - floor(last_gap / (step / 1.2) + 0.5)) < 1e-6);

  // 一時停止中は何も鳴らさない。再開すると now より後から続く
  music_init(&m);
  rec_n = 0;
  music_play(&m, SONG_PLAY, 0.0, false);
  now = run_music(&m, 0.0, 3.0);
  int n0 = rec_n;
  music_pause(&m, true, now);
  now = run_music(&m, now, 8.0);
  CHECK(rec_n == n0);
  music_pause(&m, false, now);
  run_music(&m, now, 9.0);
  CHECK(rec_n > n0 && rec[n0].t >= now);

  // 曲を切り替えて戻る（resume=true）と続きから、resume=false なら頭から
  music_init(&m);
  music_play(&m, SONG_PLAY, 0.0, false);
  now = run_music(&m, 0.0, 5.0);
  int at = m.step;
  CHECK(at > 0);
  music_play(&m, SONG_FIGHT, now, false);
  CHECK(m.song == SONG_FIGHT && m.step == 0);
  now = run_music(&m, now, 7.0);
  music_play(&m, SONG_PLAY, now, true);
  CHECK(m.song == SONG_PLAY && m.step == at);
  music_play(&m, SONG_PLAY, now, false);           // 同じ曲なら頭に戻さない
  CHECK(m.step == at);
  music_play(&m, SONG_TITLE, now, false);
  music_play(&m, SONG_PLAY, now, false);
  CHECK(m.step == 0);
  // 途中のステップから再開しても、パート同士がずれない（次の周の頭がそろう）
  music_init(&m);
  music_play(&m, SONG_PLAY, 0.0, false);
  now = run_music(&m, 0.0, 4.3);
  music_play(&m, SONG_FIGHT, now, false);
  music_play(&m, SONG_PLAY, now, true);
  rec_n = 0;
  run_music(&m, now, now + total * step + 1.0);
  int heads = 0;
  for (int i = 0; i < rec_n; i++)
    if (fabsf(rec[i].freq - music_freq(74)) < 0.01f && rec[i].vol == s->parts[0].vol)
      for (int j = 0; j < rec_n; j++)
        if (fabs(rec[j].t - rec[i].t) < 1e-9 && fabsf(rec[j].freq - music_freq(43)) < 0.01f) { heads++; break; }
  CHECK(heads >= 1);

  // ファンファーレは1回だけ鳴って、タイトルの曲に続く
  music_init(&m);
  rec_n = 0;
  music_play(&m, SONG_RESULT, 0.0, false);
  const Song *r = &SONGS[SONG_RESULT];
  double rend = 0.05 + song_steps(r, 0) * 60.0 / r->bpm / 2.0;
  run_music(&m, 0.0, rend + 1.0);
  CHECK(m.song == SONG_TITLE);
  int fan = 0; double first_title = -1;
  for (int i = 0; i < rec_n; i++) {
    if (rec[i].t < rend - 1e-9) fan++;
    else if (first_title < 0) first_title = rec[i].t;
  }
  CHECK(fan == count_notes(r));
  CHECK(first_title >= rend + 0.4 - 1e-9);

  // HOME メニューなどで時間が飛んでも、たまった音を一度に鳴らさない
  music_init(&m);
  rec_n = 0;
  music_play(&m, SONG_PLAY, 0.0, false);
  run_music(&m, 0.0, 1.0);
  int nb = rec_n;
  music_update(&m, 20.0, rec_note);
  CHECK(rec_n - nb <= 6);
  for (int i = nb; i < rec_n; i++) CHECK(rec[i].t >= 20.0 - 1e-9);

  // 止めたら何も鳴らない
  music_stop(&m);
  nb = rec_n;
  run_music(&m, 20.0, 25.0);
  CHECK(rec_n == nb && m.song == -1);
}

static void test_zukan_mode(void) {
  g_case = "zukan_mode";
  Game g;
  game_init(&g, 61);
  GameInput x = none(); x.x = true;
  GameInput l = none(); l.left = true;
  GameInput r = none(); r.right = true;
  GameInput u = none(); u.up = true;
  GameInput d = none(); d.down = true;
  GameInput b = none(); b.b = true;
  // タイトルから X（またはボタンのタッチ）でずかんへ
  game_update(&g, DT, &x);
  CHECK(g.state == ST_ZUKAN && (g.events & EV_MENU) && g.zukan_sel == 0);
  // 左上の端では左・上に動かない
  game_update(&g, DT, &l); CHECK(g.zukan_sel == 0 && !(g.events & EV_MENU));
  game_update(&g, DT, &u); CHECK(g.zukan_sel == 0);
  // 右・下に動く
  game_update(&g, DT, &r); CHECK(g.zukan_sel == 1 && (g.events & EV_MENU));
  game_update(&g, DT, &d); CHECK(g.zukan_sel == 6);
  // 右端で止まる（次の行に回り込まない）
  for (int i = 0; i < 10; i++) game_update(&g, DT, &r);
  CHECK(g.zukan_sel == 9);
  // 下端で止まる
  for (int i = 0; i < 10; i++) game_update(&g, DT, &d);
  CHECK(g.zukan_sel == SP_COUNT - 1);
  for (int i = 0; i < 10; i++) game_update(&g, DT, &l);
  CHECK(g.zukan_sel == 20);
  // マスのタッチ
  GameInput c = none(); c.cmd = CMD_ZUKAN_CELL; c.cell = 23;
  game_update(&g, DT, &c); CHECK(g.zukan_sel == 23);
  c.cell = 99;
  game_update(&g, DT, &c); CHECK(g.zukan_sel == 23);   // 範囲外は無視
  // ずかんの中では A でゲームは始まらない。人も変わらない
  GameInput a = press_a();
  Player p = g.player;
  game_update(&g, DT, &a);
  CHECK(g.state == ST_ZUKAN && g.player == p);
  // B（または「もどる」）でタイトルへ。選んでいた魚は覚えている
  game_update(&g, DT, &b);
  CHECK(g.state == ST_TITLE);
  GameInput t = none(); t.cmd = CMD_ZUKAN;
  game_update(&g, DT, &t);
  CHECK(g.state == ST_ZUKAN && g.zukan_sel == 23);
  t.cmd = CMD_TITLE;
  game_update(&g, DT, &t);
  CHECK(g.state == ST_TITLE);
  // ずかんは時間制限なし（何秒いてもそのまま）
  game_update(&g, DT, &x);
  GameInput n = none();
  step(&g, 60 * 120, &n);
  CHECK(g.state == ST_ZUKAN && !game_is_playing(&g));

  // 釣った数（累計）は人ごと・ゲームをまたいで増える
  game_init(&g, 62);
  game_update(&g, DT, &a);
  catch_one(&g, SP_KOI);
  catch_one(&g, SP_KOI);
  CHECK(g.caught_total[PL_BOY][SP_KOI] == 2 && g.counts[SP_KOI] == 2);
  end_game(&g);
  GameInput re = none(); re.cmd = CMD_RETRY;
  game_update(&g, DT, &re);
  catch_one(&g, SP_KOI);
  CHECK(g.caught_total[PL_BOY][SP_KOI] == 3 && g.counts[SP_KOI] == 1);
  CHECK(g.caught_total[PL_GIRL][SP_KOI] == 0);
  // 上限で止まる
  g.caught_total[PL_BOY][SP_KOI] = CAUGHT_TOTAL_MAX;
  catch_one(&g, SP_KOI);
  CHECK(g.caught_total[PL_BOY][SP_KOI] == CAUGHT_TOTAL_MAX);

  // レア度（★）は得点の順。長靴は0
  int prev = 0;
  for (int k = 0; k < SP_COUNT; k++) {
    if (k == SP_BOOT) { CHECK(game_species_stars((Species)k) == 0); continue; }
    int st = game_species_stars((Species)k);
    CHECK(st >= 1 && st <= 5 && st >= prev);
    prev = st;
  }
  CHECK(game_species_stars(SP_MEDAKA) == 1 && game_species_stars(SP_GOLD) == 5);
  // 説明文がすべてある
  for (int k = 0; k < SP_COUNT; k++) CHECK(SPECIES_DESC[k][0] && SPECIES_DESC[k][0][0] && SPECIES_DESC[k][1] && SPECIES_DESC[k][1][0]);
}

static void test_save_v1(void) {
  g_case = "save_v1";
  // 第1版のデータ（釣った数なし）を手で組み立てて読めるか
  uint8_t v1[SAVE_SIZE_V1];
  memset(v1, 0, sizeof(v1));
  memcpy(v1, "WKFS", 4);
  v1[4] = 1; v1[5] = PL_GIRL; v1[6] = 1;
  v1[8] = 120; v1[9] = 0; v1[10] = 0; v1[11] = 0; v1[12] = PL_GIRL;   // TOP5 1件：120点 女の子
  uint8_t *disc = v1 + 8 + TOP_COUNT * 5;
  disc[PL_GIRL * SP_COUNT + SP_FUNA] = 1;
  uint32_t h = 2166136261u;
  for (int i = 0; i < SAVE_SIZE_V1 - 4; i++) { h ^= v1[i]; h *= 16777619u; }
  v1[SAVE_SIZE_V1 - 4] = (uint8_t)h; v1[SAVE_SIZE_V1 - 3] = (uint8_t)(h >> 8);
  v1[SAVE_SIZE_V1 - 2] = (uint8_t)(h >> 16); v1[SAVE_SIZE_V1 - 1] = (uint8_t)(h >> 24);
  Game g;
  game_init(&g, 71);
  CHECK(save_decode(&g, v1, SAVE_SIZE_V1));
  CHECK(g.player == PL_GIRL && g.top_count == 1 && g.top[0].score == 120 && g.high_score == 120);
  CHECK(g.discovered[PL_GIRL][SP_FUNA] && g.caught_total[PL_GIRL][SP_FUNA] == 1);
  CHECK(game_discovered_count_of(&g, PL_GIRL) == 1 && g.caught_total[PL_GIRL][SP_KOI] == 0);
  // 第1版の長さで版数だけ2 → 読まない
  v1[4] = 2;
  game_init(&g, 72);
  CHECK(!save_decode(&g, v1, SAVE_SIZE_V1) && g.top_count == 0);
  // 未発見なのに釣った数がある第2版 → 読まない
  game_init(&g, 73);
  g.caught_total[PL_BOY][SP_KOI] = 3;
  uint8_t buf[SAVE_SIZE];
  save_encode(&g, buf);
  Game h2; game_init(&h2, 74);
  CHECK(!save_decode(&h2, buf, SAVE_SIZE));
  // 釣った数も保存される
  g.discovered[PL_BOY][SP_KOI] = true;
  g.caught_total[PL_GIRL][SP_GOLD] = 1234; g.discovered[PL_GIRL][SP_GOLD] = true;
  save_encode(&g, buf);
  CHECK(save_decode(&h2, buf, SAVE_SIZE));
  CHECK(h2.caught_total[PL_BOY][SP_KOI] == 3 && h2.caught_total[PL_GIRL][SP_GOLD] == 1234);
}

int main(void) {
  test_init();
  test_discovery();
  test_player_select();
  test_player_zukan();
  test_top5();
  test_save_encode();
  test_save_file();
  test_music_data();
  test_music_sequencer();
  test_zukan_mode();
  test_save_v1();
  test_cursor();
  test_cast_landing_matches_cursor();
  test_distance_judge();
  test_nearest_target();
  test_approach_and_bite();
  test_hook_timing();
  test_early_press();
  test_cancel();
  test_mashing();
  test_species_distribution();
  test_points();
  test_fish_movement();
  test_respawn();
  test_time_up();
  test_pause();
  test_retry_resets();
  test_rank();
  test_variable_dt();
  test_feint();
  test_fight_basic();
  test_fight_difficulty();
  printf("PASS: %d  FAIL: %d\n", g_pass, g_fail);
  return g_fail ? 1 : 0;
}
