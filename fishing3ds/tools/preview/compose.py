# preview が出力した PPM + テキスト一覧を、上下画面を並べた PNG に合成する
# 使い方: python compose.py <outディレクトリ>
import sys, os, glob
from PIL import Image, ImageDraw, ImageFont

S = 2  # 拡大率
FONT = "C:/Windows/Fonts/BIZ-UDGothicB.ttc"

def load(name):
    img = Image.open(name + ".ppm").convert("RGBA").resize(None or (0, 0), Image.NEAREST) if False else Image.open(name + ".ppm").convert("RGBA")
    img = img.resize((img.width * S, img.height * S), Image.NEAREST)
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    with open(name + ".txt", encoding="utf-8") as f:
        for line in f:
            x, y, sc, w, col, text = line.rstrip("\n").split("\t", 5)
            x, y, sc, w = float(x), float(y), float(sc), float(w)
            c = int(col, 16)
            rgba = (c & 0xFF, (c >> 8) & 0xFF, (c >> 16) & 0xFF, (c >> 24) & 0xFF)
            size = max(6, int(round(25 * sc * S)))
            font = ImageFont.truetype(FONT, size)
            # 近似した字幅に合わせて横方向を伸縮
            tw = d.textlength(text, font=font)
            tmp = Image.new("RGBA", (int(tw) + 4, size + 8), (0, 0, 0, 0))
            ImageDraw.Draw(tmp).text((0, 0), text, font=font, fill=rgba)
            target_w = max(1, int(w * S))
            tmp = tmp.resize((max(1, int(tmp.width * target_w / max(tw, 1))), tmp.height), Image.LANCZOS)
            layer.alpha_composite(tmp, (int(x * S), int((y + 3 * sc) * S)))
    img.alpha_composite(layer)
    return img

def main():
    out = sys.argv[1]
    for top in sorted(glob.glob(os.path.join(out, "*_top.ppm"))):
        base = top[:-8]
        t = load(base + "_top")
        b = load(base + "_bot")
        canvas = Image.new("RGBA", (t.width, t.height + b.height + 8), (40, 40, 40, 255))
        canvas.paste(t, (0, 0))
        canvas.paste(b, ((t.width - b.width) // 2, t.height + 8))
        canvas.convert("RGB").save(base + ".png")
    print("done")

main()
