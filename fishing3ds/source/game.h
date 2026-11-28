// ================================================================
//  わくわくフィッシング3DS - ゲームロジック
//  3DS のライブラリには依存しない（PC 上の自動テストでもビルドできる）
// ================================================================
#pragma once
#include <stdbool.h>
#include <stdint.h>

// ----------------------------------------------------------------
//  調整用の定数（プレイテストで変える値はここにまとめる）
// ----------------------------------------------------------------
#define GAME_TIME_SEC     60.0f   // 1ゲームの制限時間（秒）
#define TIME_WARN_SEC     10.0f   // 残りこの秒数以下でタイマーを赤くする
#define FISH_COUNT        5       // 同時に泳ぐ魚影の数

// 上画面（400x240）での湖の範囲
#define LAKE_TOP          64.0f
#define LAKE_X_MIN        14.0f
#define LAKE_X_MAX        386.0f
#define LANE_Y0           96.0f   // 魚影レーン0のY座標
#define LANE_STEP         24.0f   // レーン間隔（96,120,144,168,192）
#define LANE_JITTER       3.0f    // レーン内での上下のずれ（最大）

// 着水予定位置カーソル
#define CAST_Y            146.0f  // ウキが着水するY座標（左右のみ操作）
#define CURSOR_X_MIN      20.0f
#define CURSOR_X_MAX      380.0f
#define CURSOR_SPEED      170.0f  // px/秒（スライドパッドを倒し切ったとき）
#define CURSOR_START_X    200.0f

// キャスティング
#define CAST_TIME         0.4f    // ウキが飛んでいる時間（秒）
#define CAST_ORIGIN_X     76.0f   // 竿先（投げ始め）の位置
#define CAST_ORIGIN_Y     166.0f
#define CAST_ARC_H        56.0f   // 放物線の高さ

// キャスト成功判定（魚影中心とのX座標差）
#define NEAR_MIN          5.0f    // これ未満は近すぎて逃げる
#define NEAR_MAX          30.0f   // これ以下（NEAR_MIN以上）で興味を持つ

// 食いつき
#define BITE_WAIT_MIN     0.5f    // ウキに寄ってから食いつくまで（秒）
#define BITE_WAIT_MAX     2.0f
// フェイント（本物の食いつきの前に、ウキが一瞬だけ沈む。ここで A を押すと失敗）
#define FEINT_MAX         4       // 1回の食いつき待ちでのフェイントの最大数
#define FEINT_TIME        0.30f   // ウキが沈んでいる時間
#define FEINT_GAP_MIN     0.30f   // フェイントの前の待ち時間
#define FEINT_GAP_MAX     0.80f
#define FEINT_AFTER_MIN   0.30f   // 最後のフェイントから本物の食いつきまで
#define FEINT_AFTER_MAX   1.00f
#define MISS_SHOW_TIME    0.7f    // 失敗演出の時間
#define CATCH_SHOW_TIME   1.0f    // 釣果表示の時間
#define GOLD_SHOW_TIME    1.6f    // 黄金の魚のときの釣果表示時間
#define TIMEUP_LOCK_TIME  1.2f    // 結果画面で入力を受け付けるまでの時間

// 魚影
#define RESPAWN_MIN       1.0f
#define RESPAWN_MAX       3.0f
#define TURN_MIN          1.5f    // 向きを変えるまでの時間
#define TURN_MAX          4.0f
#define FLEE_TIME         0.6f    // 逃げる魚がフェードアウトする時間
#define FLEE_SPEED_MUL    3.0f
#define SPAWN_FADE_TIME   0.5f
#define SPEED_VARIANCE    0.15f   // 速度のばらつき（±15%）

// やりとり（合わせ成功後のテンション操作）
//  A を押している間は糸を巻き（テンション上昇・巻き上げ進行）、
//  離すとテンションが下がる。1.0 に達すると糸が切れ、0 のまま
//  SLACK_LIMIT 秒たつと針が外れる。魚ごとの強さは FIGHT_PARAMS。
#define FIGHT_START_TENSION   0.35f
#define REEL_TENSION_UP       0.55f   // 巻いているときのテンション上昇（/秒）
#define RELEASE_TENSION_DOWN  0.75f   // 離しているときのテンション低下（/秒）
#define RUSH_PULL_RELEASED    0.6f    // 離していても暴れの引きがこの割合で効く
#define RUSH_LINE_DRAIN       0.06f   // 暴れている間に引き出される糸（巻き上げ進行/秒）
#define SLACK_LIMIT           0.6f    // テンション0がこの秒数続くと針が外れる
#define TENSION_SLACK_ZONE    0.15f   // 表示用：これ未満は「ゆるい」
#define TENSION_DANGER_ZONE   0.85f   // 表示用：これ以上は「切れそう」
#define LAND_X                96.0f   // 巻き上げ完了時の魚の位置（桟橋の手前）
#define LAND_Y                204.0f

// ずかん
#define ZUKAN_COLS            5       // ずかんの表の列数（5×5）
#define CAUGHT_TOTAL_MAX      9999    // 釣った数の上限（表示・保存用）

// ----------------------------------------------------------------
//  列挙
// ----------------------------------------------------------------
typedef enum {
  ST_TITLE, ST_AIMING, ST_CASTING, ST_FISH_APPROACH, ST_WAIT_BITE,
  ST_HIT_WINDOW, ST_FIGHT, ST_CAUGHT, ST_MISSED, ST_PAUSE, ST_RESULT,
  ST_ZUKAN       // ずかんを眺める（タイトルから入る）
} GameState;

typedef enum { SZ_SMALL, SZ_MEDIUM, SZ_LARGE, SZ_COUNT } FishSize;

typedef enum {
  // 並びは得点（＝珍しさ・やりとりの手ごわさ）の低い順。下画面の釣果表もこの順
  SP_MEDAKA, SP_MOTSUGO, SP_WAKASAGI, SP_FUNA, SP_OIKAWA,
  SP_BLUEGILL, SP_DOJOU, SP_UGUI, SP_TANAGO, SP_BASS,
  SP_KAJIKA, SP_AYU, SP_YAMAME, SP_NIJIMASU, SP_KOI,
  SP_NAMAZU_S, SP_IWANA, SP_RAIGYO, SP_SOUGYO, SP_NISHIKI,
  SP_NAMAZU, SP_CHOUZAME, SP_ITOU, SP_GOLD, SP_BOOT,
  SP_COUNT
} Species;

typedef enum {
  FS_NONE,      // 空きスロット（再出現待ち）
  FS_SWIM,      // 通常の遊泳
  FS_APPROACH,  // ウキへ接近中
  FS_WAIT,      // ウキのそばで食いつき待ち
  FS_BITE,      // 食いついている（合わせ待ち）
  FS_FIGHT,     // やりとり中
  FS_FLEE       // 逃げている（フェードアウト）
} FishState;

typedef enum {
  MISS_NONE, MISS_NO_REACTION, MISS_TOO_CLOSE, MISS_EARLY, MISS_ESCAPED,
  MISS_LINE_BREAK,   // やりとりで張りすぎて糸が切れた
  MISS_SLACK,        // やりとりで緩めすぎて針が外れた
  MISS_FEINT         // フェイントで A を押した
} MissReason;

// やりとりでの暴れ方
enum { RUSH_NONE, RUSH_WARN, RUSH_ON };

// あそぶ人（タイトル画面で顔を選ぶ）。ずかんは人ごとに分けて記録する
typedef enum { PL_BOY, PL_GIRL, PLAYER_COUNT } Player;

// ハイスコアの記録（上位 TOP_COUNT 件。だれが出したかも残す）
#define TOP_COUNT 5
typedef struct {
  int    score;
  Player player;
} ScoreEntry;

// 入力（a, b などは「押した瞬間」だけ true。a_held は押している間 true）
enum { CMD_NONE, CMD_START, CMD_RETRY, CMD_TITLE, CMD_PAUSE, CMD_RESUME, CMD_QUIT,
       CMD_SEL_BOY, CMD_SEL_GIRL,
       CMD_ZUKAN,       // タイトル → ずかん
       CMD_ZUKAN_CELL   // ずかんのマスをタッチ（GameInput.cell）
};
typedef struct {
  float move;            // -1..1（左右）
  bool  a, b, start, up, down;
  bool  left, right;     // タイトル画面での人の選択・ずかんのカーソル用（押した瞬間）
  bool  x;               // タイトル画面でずかんを開く
  int   cell;            // CMD_ZUKAN_CELL のときのマス番号（0..SP_COUNT-1）
  bool  a_held;          // やりとり中の巻き取りにだけ使う
  int   cmd;             // タッチ操作によるコマンド
} GameInput;

// 魚種ごとのやりとりの強さ（レアな魚ほど手ごわい）
typedef struct {
  float reel;            // 巻いているときの巻き上げ速度（1.0で完了。/秒）
  float pull;            // 常にかかる引き（テンション/秒）
  float rush;            // 暴れているときの追加の引き（0=暴れない）
  float rush_min, rush_max; // 次に暴れるまでの間隔（秒）
  float rush_len;        // 暴れている時間
  float warn;            // 暴れる前の予兆（魚が身をよじる）の時間
} FightParam;

// 1回の update で起きたこと（効果音・エフェクト用）
enum {
  EV_CAST = 1 << 0, EV_SPLASH = 1 << 1, EV_BITE = 1 << 2, EV_CATCH = 1 << 3,
  EV_GOLD = 1 << 4, EV_MISS = 1 << 5, EV_TIMEUP = 1 << 6, EV_FLEE = 1 << 7,
  EV_START = 1 << 8, EV_MENU = 1 << 9, EV_REEL = 1 << 10,
  EV_HOOK = 1 << 11,   // 合わせ成功 → やりとり開始
  EV_RUSH = 1 << 12,   // 暴れる予兆
  EV_THRASH = 1 << 13, // 暴れ始め
  EV_BREAK = 1 << 14,  // 糸が切れた
  EV_FEINT = 1 << 15   // フェイントでウキが沈んだ
};

typedef struct {
  int       id;
  Species   species;
  FishSize  size;
  float     x, y;        // 魚影の中心
  float     speed;       // px/秒
  int       dir;         // +1=右向き, -1=左向き
  int       points;
  FishState state;
  float     len;         // 魚影の長さ
  float     turn_t;      // 向きを変えるまでの残り時間
  float     tail;        // 尾びれアニメーション位相
  float     state_t;     // 現在の状態になってからの時間
  float     alpha;       // 表示の濃さ（出現・逃走時のフェード）
  float     respawn_t;   // FS_NONE のときの再出現までの時間
} Fish;

typedef struct {
  GameState state;
  GameState paused_from;
  uint32_t  rng;
  float     time_left;
  float     state_t;      // 現在の状態になってからの時間
  float     anim_t;       // 描画用の経過時間（一時停止中は止まる）
  float     cursor_x;

  // ウキ
  bool      bobber_out;
  float     cast_x;       // 着水予定X（キャストした瞬間のカーソル位置）
  float     bob_x, bob_y; // 現在のウキ位置
  int       target;       // 反応した魚のインデックス（-1=なし）
  float     bite_wait;    // 食いつき待ちに入ってから本物の食いつきまでの時間（フェイント込み）
  int       feint_count;  // この食いつき待ちでのフェイントの数
  int       feint_next;   // 次に起きるフェイントの番号
  float     feint_at[FEINT_MAX];  // 各フェイントの開始時刻（食いつき待ちに入ってから）
  float     grace;        // 合わせの入力猶予
  MissReason miss_reason;

  // やりとり
  float     tension;      // 0..1
  float     progress;     // 巻き上げ進行 0..1
  float     slack_t;      // テンション0が続いている時間
  int       rush_phase;   // RUSH_NONE / RUSH_WARN / RUSH_ON
  float     rush_t;       // 現在の暴れ段階の残り時間
  float     fight_x0, fight_y0;  // やりとり開始時の魚の位置

  Fish      fish[FISH_COUNT];
  int       next_id;

  // 直近の釣果
  Species   last_species;
  bool      last_new;     // 直近の釣果が初めて釣った魚か

  // あそぶ人（タイトル画面で選ぶ。タイトルに戻っても前回の選択のまま）
  Player    player;

  // ずかん（人ごと。アプリ起動中は保持。リトライ・タイトルに戻っても消えない）
  bool      discovered[PLAYER_COUNT][SP_COUNT];
  int       caught_total[PLAYER_COUNT][SP_COUNT];  // これまでに釣った数（ずかん用。SD カードに保存）
  int       zukan_sel;    // ずかんで選んでいる魚
  int       last_points;

  // ハイスコア TOP5（アプリ起動中は保持。得点の高い順、同点は先に出した方が上）
  ScoreEntry top[TOP_COUNT];
  int       top_count;    // 記録されている件数（0..TOP_COUNT）
  int       top_pos;      // 今回のゲームが TOP5 の何位に入ったか（0始まり。-1=圏外）

  // 成績
  int       score, high_score;   // high_score = TOP5 の1位の得点
  bool      new_record;          // 今回の得点がこれまでの1位を超えた
  int       casts;        // キャスティング回数
  int       hooks;        // 釣り上げ成功回数（長靴を含む）
  int       fish_caught;  // 釣った魚の数（長靴を除く）
  int       counts[SP_COUNT];
  int       rarest;       // 最も珍しかった魚種（-1=なし）

  int       pause_sel;
  bool      quit;
  uint32_t  events;
} Game;

// ----------------------------------------------------------------
//  テーブル
// ----------------------------------------------------------------
extern const int   SPECIES_POINTS[SP_COUNT];
extern const int   SPECIES_RARITY[SP_COUNT];
extern const char *SPECIES_NAME_JP[SP_COUNT];
extern const char *SPECIES_NAME_EN[SP_COUNT];
extern const char *SPECIES_DESC[SP_COUNT][2];   // ずかんの説明文（2行）
extern const int   SIZE_SPAWN_PCT[SZ_COUNT];
extern const int   SPECIES_PERMILLE[SZ_COUNT][SP_COUNT];  // 魚影サイズ別の魚種抽選（‰。各行の合計1000）
extern const float SIZE_SPEED[SZ_COUNT];
extern const float SIZE_LEN[SZ_COUNT];
extern const float SIZE_GRACE[SZ_COUNT];
extern const float SIZE_APPROACH_SPEED[SZ_COUNT];
extern const int   RANK_MIN_SCORE[4];   // C, B, A, S になる最低点
extern const FightParam FIGHT_PARAMS[SP_COUNT];
extern const int   FEINT_MIN_COUNT[SP_COUNT];   // 魚種ごとのフェイント回数（最小〜最大）
extern const int   FEINT_MAX_COUNT[SP_COUNT];

// ----------------------------------------------------------------
//  API
// ----------------------------------------------------------------
void      game_init(Game *g, uint32_t seed);   // タイトル状態で初期化
void      game_start(Game *g);                 // 新しいゲームを開始（リトライ）
void      game_update(Game *g, float dt, const GameInput *in);

bool      game_is_playing(const Game *g);      // 制限時間が進む状態か
bool      game_feint_active(const Game *g);    // いまフェイントでウキが沈んでいるか
float     game_lane_y(int lane);
FishSize  game_roll_size(Game *g);
Species   game_roll_species(Game *g, FishSize size);
void      game_spawn_fish(Game *g, int slot);
char      game_rank(int score);
int       game_success_rate(const Game *g);    // 0..100（%）
int       game_discovered_count(const Game *g); // いまの人のずかんで発見済みの種類数
int       game_discovered_count_of(const Game *g, Player p);
bool      game_is_discovered(const Game *g, Species sp);  // いまの人が発見済みか
int       game_species_stars(Species sp);  // ずかんのレア度（★1〜5。長靴は0）
void      game_record_score(Game *g, int score, Player p); // TOP5 に記録し、入った順位を top_pos に入れる（0点は記録しない）
uint32_t  game_rand(Game *g);
float     game_randf(Game *g);                 // [0,1)
