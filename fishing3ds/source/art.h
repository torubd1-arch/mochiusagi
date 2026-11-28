// 魚種ごとのカラーイラスト（図形描画で生成。外部素材なし）
#pragma once
#include "game.h"

// (cx,cy) を中心に右向きで描く。scale=1 でおよそ幅64×高さ32
void art_draw_fish(Species sp, float cx, float cy, float scale, float t);
// scale=1 で描いたときのおおよその横幅
float art_width(Species sp);
// あそぶ人の顔アイコン。(cx,cy) が顔の中心、r は顔のおおよその半径（r=10 が基準）
void art_draw_face(Player p, float cx, float cy, float r);
