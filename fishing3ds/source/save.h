// ================================================================
//  セーブデータ（ハイスコア TOP5・人ごとのずかん・最後にえらんだ人）
//  3DS のライブラリには依存しない（PC 上の自動テストでもビルドできる）
// ================================================================
#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include "game.h"

#define SAVE_DIR      "sdmc:/3ds/fishing"
#define SAVE_PATH     SAVE_DIR "/fishing.sav"
#define SAVE_VERSION  2

// 第1版：4(目印) + 1(版) + 1(人) + 1(件数) + 1(予備) + TOP5×5 + ずかん 2×25 + 4(検査値)
#define SAVE_SIZE_V1  (8 + TOP_COUNT * 5 + PLAYER_COUNT * SP_COUNT + 4)
// 第2版：第1版のずかんの後ろに「釣った数」2×25×2バイトを追加
#define SAVE_SIZE     (8 + TOP_COUNT * 5 + PLAYER_COUNT * SP_COUNT + PLAYER_COUNT * SP_COUNT * 2 + 4)

// Game の記録部分をバイト列にする / バイト列から戻す（壊れていれば false で g は変えない）
// 第1版のデータも読める（釣った数は、発見済みなら1・未発見なら0として読む）
void save_encode(const Game *g, uint8_t out[SAVE_SIZE]);
bool save_decode(Game *g, const uint8_t *buf, size_t len);

// ファイルに書く。いったん path.tmp に書いてから path に置き換える（書き込み中の電源断対策）
bool save_write(const char *path, const Game *g);
// ファイルから読む。path が無い・壊れているときは path.tmp を試す。どちらもだめなら false
bool save_read(const char *path, Game *g);
