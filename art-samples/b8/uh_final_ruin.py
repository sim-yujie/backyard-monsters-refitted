"""uh_final_ruin.py [view.jpg] : cut the damaged (d) and destroyed (x) Codex paintings of levels 4-6
(final/jobs/L<N>d, L<N>x: sheet.png) and stand them where the whole building stands: lined up on the whole level by
the stone base where enough of it is left (else left where Codex put it, which is where base.png had it), one
brightness gain per channel from the parts that still match. Writes final/top.c<N>.damaged@2x.png|webp,
top.c<N>.destroyed@2x.png|webp and ruins.json ([file, x, y] in game px; shadows: Flash's level 3 ones).
Run: ~/.cache/bymr-art-venv/bin/python uh_final_ruin.py   (from art-samples/b8)
"""
import json
import sys

from uh_final_lib import FINAL, OX2, OY2, WORK, Image, arr, big_to_frame, blur, img, np, register, sheet_to_big

STATE = {"d": "damaged", "x": "destroyed"}
SHADOW = {"d": ["shadow.3.damaged.v2.jpg", -73, 33], "x": ["shadow.3.destroyed.v2.jpg", -75, 29]}


def main(view=None):
    out, views = {}, []
    for level in (4, 5, 6):
        body_im = Image.open(WORK / f"body{level}@2x.png").convert("RGBA")
        body = arr(body_im)
        for kind in "dx":
            p = FINAL / "jobs" / f"L{level}{kind}" / "sheet.png"
            if not p.exists():
                print("missing", p)
                continue
            sheet = Image.open(p).convert("RGB")
            err, k, dx, dy = register(sheet, body_im, (540, 640))
            if err > 0.12 or kind == "x" and err > 0.10:        # too little left to line up on: keep Codex's place
                k, dx, dy, how = 1.0, 0, 0, f"kept in place (fit err {err:.3f})"
            else:
                how = f"lined up (fit err {err:.3f}, scale {k}, shift {dx},{dy})"
            new = arr(big_to_frame(sheet_to_big(sheet, k, dx, dy)))
            both = (new[..., 3] > 0.95) & (body[..., 3] > 0.95)
            same = both & (blur(np.abs(new[..., :3] - body[..., :3]).max(-1), 3) < 0.08)
            gains = [1.0, 1.0, 1.0]
            if same.sum() > 3000:
                gains = [float(np.clip(body[..., c][same].mean() / new[..., c][same].mean(), 0.9, 1.1)) for c in range(3)]
                for c in range(3):
                    new[..., c] = np.clip(new[..., c] * gains[c], 0, 1)
            res = img(new)
            x0, y0, x1, y1 = res.getchannel("A").point(lambda v: 255 if v > 8 else 0).getbbox()
            box = (x0 // 2 * 2, y0 // 2 * 2, -(-x1 // 2) * 2, -(-y1 // 2) * 2)
            name = f"top.c{level}.{STATE[kind]}@2x"
            res.crop(box).save(FINAL / f"{name}.png")
            res.crop(box).save(FINAL / f"{name}.webp", "WEBP", quality=92, method=6, exact=False)
            out[f"{level}.{STATE[kind]}"] = [f"{name}.webp", (box[0] - OX2) / 2, (box[1] - OY2) / 2, SHADOW[kind]]
            print(level, STATE[kind], how, "gains", [round(g, 3) for g in gains], "same px", int(same.sum()), "box", box)
            bg = Image.new("RGBA", res.size, (70, 40, 36, 255)); bg.alpha_composite(res)
            views.append(bg.convert("RGB"))
    (FINAL / "ruins.json").write_text(json.dumps(out, indent=1))
    if view and views:
        s = Image.new("RGB", (views[0].width * len(views), views[0].height))
        for i, v in enumerate(views):
            s.paste(v, (i * v.width, 0))
        s.save(view, quality=88)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else None)
