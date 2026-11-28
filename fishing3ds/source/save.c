// ================================================================
//  セーブデータの読み書き
//  書き込むのはこのゲーム専用のファイル（fishing.sav と、書き込み途中の fishing.sav.tmp）だけ
// ================================================================
#include "save.h"
#include <stdio.h>
#include <string.h>

static const uint8_t MAGIC[4] = { 'W', 'K', 'F', 'S' };

// FNV-1a（壊れたデータを見分けるための検査値）
static uint32_t checksum(const uint8_t *p, size_t n) {
  uint32_t h = 2166136261u;
  for (size_t i = 0; i < n; i++) { h ^= p[i]; h *= 16777619u; }
  return h;
}
static void put32(uint8_t *p, uint32_t v) {
  p[0] = (uint8_t)v; p[1] = (uint8_t)(v >> 8); p[2] = (uint8_t)(v >> 16); p[3] = (uint8_t)(v >> 24);
}
static uint32_t get32(const uint8_t *p) {
  return (uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24);
}

void save_encode(const Game *g, uint8_t out[SAVE_SIZE]) {
  memset(out, 0, SAVE_SIZE);
  memcpy(out, MAGIC, 4);
  out[4] = SAVE_VERSION;
  out[5] = (uint8_t)g->player;
  out[6] = (uint8_t)g->top_count;
  uint8_t *p = out + 8;
  for (int i = 0; i < TOP_COUNT; i++, p += 5) {
    if (i < g->top_count) { put32(p, (uint32_t)g->top[i].score); p[4] = (uint8_t)g->top[i].player; }
  }
  for (int pl = 0; pl < PLAYER_COUNT; pl++)
    for (int k = 0; k < SP_COUNT; k++) *p++ = g->discovered[pl][k] ? 1 : 0;
  put32(p, checksum(out, SAVE_SIZE - 4));
}

bool save_decode(Game *g, const uint8_t *buf, size_t len) {
  if (len != SAVE_SIZE) return false;
  if (memcmp(buf, MAGIC, 4) != 0 || buf[4] != SAVE_VERSION) return false;
  if (get32(buf + SAVE_SIZE - 4) != checksum(buf, SAVE_SIZE - 4)) return false;
  int player = buf[5], count = buf[6];
  if (player >= PLAYER_COUNT || count > TOP_COUNT) return false;
  ScoreEntry top[TOP_COUNT];
  memset(top, 0, sizeof(top));
  const uint8_t *p = buf + 8;
  for (int i = 0; i < TOP_COUNT; i++, p += 5) {
    if (i >= count) continue;
    uint32_t s = get32(p);
    if (s == 0 || s > 1000000u || p[4] >= PLAYER_COUNT) return false;
    if (i > 0 && (int)s > top[i - 1].score) return false;   // 高い順になっていない
    top[i].score = (int)s;
    top[i].player = (Player)p[4];
  }
  bool disc[PLAYER_COUNT][SP_COUNT];
  for (int pl = 0; pl < PLAYER_COUNT; pl++)
    for (int k = 0; k < SP_COUNT; k++) {
      if (*p > 1) return false;
      disc[pl][k] = *p++ != 0;
    }
  // ここまで来たら正しいデータなので反映する
  g->player = (Player)player;
  memcpy(g->top, top, sizeof(top));
  g->top_count = count;
  g->high_score = count > 0 ? top[0].score : 0;
  memcpy(g->discovered, disc, sizeof(disc));
  return true;
}

static bool read_one(const char *path, Game *g) {
  FILE *f = fopen(path, "rb");
  if (!f) return false;
  uint8_t buf[SAVE_SIZE + 1];
  size_t n = fread(buf, 1, sizeof(buf), f);
  fclose(f);
  return save_decode(g, buf, n);
}

bool save_read(const char *path, Game *g) {
  char tmp[256];
  if (read_one(path, g)) return true;
  snprintf(tmp, sizeof(tmp), "%s.tmp", path);
  return read_one(tmp, g);
}

bool save_write(const char *path, const Game *g) {
  char tmp[256];
  uint8_t buf[SAVE_SIZE];
  save_encode(g, buf);
  snprintf(tmp, sizeof(tmp), "%s.tmp", path);
  FILE *f = fopen(tmp, "wb");
  if (!f) return false;
  bool ok = fwrite(buf, 1, SAVE_SIZE, f) == SAVE_SIZE;
  ok = (fclose(f) == 0) && ok;
  if (!ok) { remove(tmp); return false; }
  // SD カード（FAT）では上書きの rename ができないので、古い方を消してから置き換える
  remove(path);
  return rename(tmp, path) == 0;
}
