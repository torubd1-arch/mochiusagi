// セーブデータ（SDカード: sdmc:/3ds/chococatch/save.bin）
// Web版の localStorage（chocoGame_highScore / collection_v3）に相当
#pragma once
#include <3ds.h>
#include <stdbool.h>
#include "data.h"

typedef struct {
  u32 normal, rare;
} CollEntry;

typedef struct {
  u32 magic;            // 'CHC3'
  u32 version;          // 3
  s32 high_score;       // chocoGame_highScore
  s32 best_score;       // collection.meta.bestScore
  s32 plays;            // collection.meta.plays
  u32 full_complete_once;
  CollEntry hats[NUM_IDS];
  CollEntry held[NUM_IDS];
} SaveData;

extern SaveData save;

void save_load(void);
void save_write(void);
void save_reset_collection(void); // ずかんリセット（bestScore と highScore は保持）
