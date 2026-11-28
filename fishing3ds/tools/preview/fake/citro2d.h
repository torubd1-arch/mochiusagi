// PC プレビュー用の citro2d 代替ヘッダ
#pragma once
#include "3ds.h"
typedef struct { int screen; } C3D_RenderTarget;
typedef struct PvTextBuf *C2D_TextBuf;
typedef struct { const char *str; } C2D_Text;
#define C3D_DEFAULT_CMDBUF_SIZE 0
#define C3D_FRAME_SYNCDRAW 0
#define C2D_WithColor 1
static inline u32 C2D_Color32(u8 r, u8 g, u8 b, u8 a) { return r | (g << 8) | (b << 16) | ((u32)a << 24); }
void C2D_DrawTriangle(float x0, float y0, u32 c0, float x1, float y1, u32 c1, float x2, float y2, u32 c2, float depth);
C2D_TextBuf C2D_TextBufNew(size_t n);
void C2D_TextBufDelete(C2D_TextBuf b);
void C2D_TextBufClear(C2D_TextBuf b);
const char *C2D_TextParse(C2D_Text *t, C2D_TextBuf b, const char *s);
void C2D_TextOptimize(const C2D_Text *t);
void C2D_TextGetDimensions(const C2D_Text *t, float sx, float sy, float *w, float *h);
void C2D_DrawText(const C2D_Text *t, u32 flags, float x, float y, float z, float sx, float sy, ...);
bool C3D_Init(size_t n);
bool C2D_Init(size_t n);
void C2D_Prepare(void);
C3D_RenderTarget *C2D_CreateScreenTarget(gfxScreen_t s, gfx3dSide_t side);
void C2D_TargetClear(C3D_RenderTarget *t, u32 c);
void C2D_SceneBegin(C3D_RenderTarget *t);
bool C3D_FrameBegin(u8 f);
void C3D_FrameEnd(u8 f);
void C2D_Fini(void);
void C3D_Fini(void);
