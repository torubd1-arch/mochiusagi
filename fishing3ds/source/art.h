// 魚種ごとのカラーイラスト（図形描画で生成。外部素材なし）
#pragma once
#include "game.h"

// (cx,cy) を中心に右向きで描く。scale=1 でおよそ幅64×高さ32
void art_draw_fish(Species sp, float cx, float cy, float scale, float t);
