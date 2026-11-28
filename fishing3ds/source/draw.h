// Canvas 2D 風の簡易描画レイヤー（citro2d の三角形描画の上に実装）
// 変換行列（translate/scale/rotate）と globalAlpha を持ち、save/restore できる
#pragma once
#include <3ds.h>
#include <stdbool.h>

void  dr_init(void);
void  dr_exit(void);
void  dr_frame_begin(void);   // 毎フレーム先頭で呼ぶ（テキストバッファのクリア）

void  dr_reset(void);         // 単位行列・alpha=1 に戻す
void  dr_save(void);
void  dr_restore(void);
void  dr_translate(float x, float y);
void  dr_scale(float sx, float sy);
void  dr_rotate(float a);
void  dr_set_alpha(float a);  // ctx.globalAlpha と同じ（絶対値）
float dr_get_alpha(void);

u32   shade(u32 rgba, int amt); // shadeColor 相当（アルファは保持）

// 単色塗り（シルエット表示用）。有効な間はすべての図形をこの色で塗る
void  dr_set_tint(u32 rgb);
void  dr_clear_tint(void);

// 塗り
void dr_tri(float x0, float y0, float x1, float y1, float x2, float y2, u32 c);
void dr_rect(float x, float y, float w, float h, u32 c);
void dr_rect_vgrad(float x, float y, float w, float h, u32 top, u32 bottom);
void dr_round_rect(float x, float y, float w, float h, float r, u32 c);
// canvas の ellipse(cx,cy,rx,ry,rot,a0,a1) + fill と同じ角度の扱い
void dr_ellipse(float cx, float cy, float rx, float ry, float rot, float a0, float a1, u32 c);
void dr_circle(float cx, float cy, float r, u32 c);
void dr_poly(const float *pts, int n, u32 c);           // 凸多角形（扇形分割）
void dr_star(float cx, float cy, float ro, float ri, int points, u32 c);

// 線
void dr_line(float x0, float y0, float x1, float y1, float lw, u32 c);
void dr_polyline(const float *pts, int n, float lw, u32 c);
void dr_rect_stroke(float x, float y, float w, float h, float lw, u32 c);
void dr_arc_stroke(float cx, float cy, float rx, float ry, float rot, float a0, float a1, float lw, u32 c);
void dr_arc_dash(float cx, float cy, float r, float lw, float on, float off, u32 c);
void dr_quad_stroke(float x0, float y0, float qx, float qy, float x1, float y1, float lw, u32 c);

// テキスト（px はローカル座標系でのフォントサイズ）
enum { AL_LEFT, AL_CENTER, AL_RIGHT };
enum { BL_TOP, BL_MIDDLE, BL_BOTTOM };
void  dr_text(const char *s, float x, float y, float px, u32 c, int align, int base);
float dr_text_width(const char *s, float px);           // ローカル座標系での幅
