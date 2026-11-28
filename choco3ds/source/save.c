#include "save.h"
#include <stdio.h>
#include <string.h>
#include <sys/stat.h>

#define SAVE_DIR   "sdmc:/3ds/chococatch"
#define SAVE_PATH  SAVE_DIR "/save.bin"
#define SAVE_MAGIC 0x33434843u  // 'CHC3'

SaveData save;

static void make_empty(void) {
  memset(&save, 0, sizeof(save));
  save.magic = SAVE_MAGIC;
  save.version = 3;
}

void save_load(void) {
  make_empty();
  FILE *fp = fopen(SAVE_PATH, "rb");
  if (!fp) return;
  SaveData tmp;
  size_t n = fread(&tmp, 1, sizeof(tmp), fp);
  fclose(fp);
  if (n == sizeof(tmp) && tmp.magic == SAVE_MAGIC && tmp.version == 3) save = tmp;
}

void save_write(void) {
  mkdir("sdmc:/3ds", 0777);
  mkdir(SAVE_DIR, 0777);
  FILE *fp = fopen(SAVE_PATH, "wb");
  if (!fp) return;
  fwrite(&save, 1, sizeof(save), fp);
  fclose(fp);
}

void save_reset_collection(void) {
  s32 best = save.best_score, high = save.high_score;
  make_empty();
  save.best_score = best;
  save.high_score = high;
  save_write();
}
