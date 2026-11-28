// ================================================================
//  わくわくフィッシング3DS - ゲームロジックの自動テスト（PC 上で実行）
//  ビルド: make -C tests   （gcc が必要）
// ================================================================
#include "../source/game.h"
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
  for (int s = 0; s < SZ_COUNT; s++) {
    int sum = 0;
    for (int k = 0; k < SP_COUNT; k++) sum += SPECIES_PCT[s][k];
    CHECK(sum == 100);
    int cnt[SP_COUNT] = { 0 };
    for (int i = 0; i < N; i++) cnt[game_roll_species(&g, (FishSize)s)]++;
    for (int k = 0; k < SP_COUNT; k++) {
      double p = 100.0 * cnt[k] / N;
      if (SPECIES_PCT[s][k] == 0) CHECK(cnt[k] == 0);
      else CHECK(fabs(p - SPECIES_PCT[s][k]) < 0.3);
    }
  }
  // 仕様書の表と一致しているか（抜粋）
  CHECK(SPECIES_PCT[SZ_LARGE][SP_GOLD] == 1);
  CHECK(SPECIES_PCT[SZ_SMALL][SP_MEDAKA] == 45);
  CHECK(SPECIES_PCT[SZ_MEDIUM][SP_BASS] == 35);
  CHECK(SPECIES_PCT[SZ_LARGE][SP_NAMAZU] == 19);
  for (int s = 0; s < SZ_COUNT; s++) CHECK(SPECIES_PCT[s][SP_BOOT] == 5);
}

static void test_points(void) {
  g_case = "points";
  const int expect[SP_COUNT] = { 10, 20, 30, 50, 80, 150, 200, 500, 0 };
  for (int k = 0; k < SP_COUNT; k++) CHECK(SPECIES_POINTS[k] == expect[k]);

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
  for (int k = SP_FUNA; k < SP_GOLD; k++) {
    CHECK(FIGHT_PARAMS[k + 1].reel < FIGHT_PARAMS[k].reel);
    CHECK(FIGHT_PARAMS[k + 1].rush > FIGHT_PARAMS[k].rush);
    CHECK(FIGHT_PARAMS[k + 1].warn < FIGHT_PARAMS[k].warn);
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
    CHECK(avg_time[k + 1] > avg_time[k]);
    CHECK(rate_greedy[k + 1] <= rate_greedy[k] + 3.0f);
    CHECK(rate_greedy2[k + 1] <= rate_greedy2[k] + 3.0f);
  }
  CHECK(rate_greedy[SP_MEDAKA] == 100.0f);
  CHECK(rate_greedy[SP_GOLD] < 30.0f);
  CHECK(rate_greedy2[SP_NAMAZU] < 30.0f && rate_greedy2[SP_GOLD] < 10.0f);
  CHECK(avg_time[SP_GOLD] < 15.0f);   // 60秒のうち長くても15秒以内
}

int main(void) {
  test_init();
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
