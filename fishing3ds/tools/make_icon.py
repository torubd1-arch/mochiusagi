# Homebrew Launcher 用アイコン（48x48）を図形だけで生成する
# 使い方: python tools/make_icon.py icon.png   （Pillow が必要）
import sys
from PIL import Image, ImageDraw

S = 4  # 高解像度で描いて縮小する
img = Image.new("RGBA", (48 * S, 48 * S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)
def r(v): return [c * S for c in v]
# 背景（湖）
d.rounded_rectangle(r([1, 1, 47, 47]), radius=8 * S, fill=(40, 120, 190, 255))
d.rectangle(r([1, 1, 47, 13]), fill=(120, 200, 240, 255))
d.rounded_rectangle(r([1, 1, 47, 14]), radius=8 * S, fill=(120, 200, 240, 255))
d.rectangle(r([1, 12, 47, 15]), fill=(90, 165, 70, 255))
# 波
for y in (22, 34, 42):
    d.line(r([6, y, 16, y]), fill=(200, 235, 255, 255), width=S)
# 魚
d.polygon(r([9, 30, 3, 25, 3, 35]), fill=(255, 190, 40, 255))
d.ellipse(r([7, 23, 33, 37]), fill=(255, 210, 60, 255), outline=(150, 100, 10, 255), width=S)
d.ellipse(r([25, 26, 30, 31]), fill=(255, 255, 255, 255))
d.ellipse(r([27, 27, 30, 30]), fill=(20, 20, 20, 255))
# 釣り糸とウキ
d.line(r([46, 2, 38, 22]), fill=(255, 255, 255, 255), width=S)
d.ellipse(r([34, 20, 42, 28]), fill=(255, 255, 255, 255))
d.pieslice(r([34, 20, 42, 28]), 180, 360, fill=(230, 57, 53, 255))
img = img.resize((48, 48), Image.LANCZOS)
img.save(sys.argv[1] if len(sys.argv) > 1 else "icon.png")
print("saved")
