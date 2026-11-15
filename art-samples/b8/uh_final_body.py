"""uh_final_body.py <level> [view.jpg] : the Codex edit of level <level> (jobs/L<level>/sheet.png, no flame) laid on
the level below and written as work/body<level>@2x.png (the 340x660 frame, see uh_final_lib).

1. lined up on the level below (scale about the foot + shift, searched; an edit normally needs none);
2. brightness matched: one gain per colour channel from the parts that did not change;
3. wherever the edit shows the same thing as the level below, the level below's own pixels are kept (so level 4's
   stone, slabs, horns, roof and funnel ARE level 3's, and so on up the chain); only what was added is new paint.
Prints the numbers the report needs. Run with ~/.cache/bymr-art-venv/bin/python from art-samples/b8.
"""
import sys

from uh_final_lib import FINAL, WORK, Image, arr, big_to_frame, blur, img, level3, np, register, sheet_to_big


def below_of(level):
    return level3() if level == 4 else Image.open(WORK / f"body{level - 1}@2x.png").convert("RGBA")


def main(level, view=None):
    WORK.mkdir(exist_ok=True)
    sheet = Image.open(FINAL / "jobs" / f"L{level}" / "sheet.png").convert("RGB")
    ref_im = below_of(level)
    err, k, dx, dy = register(sheet, ref_im, (520, 640))       # by the stone base, which never changes
    new = arr(big_to_frame(sheet_to_big(sheet, k, dx, dy)))
    ref = arr(ref_im)
    both = (new[..., 3] > 0.95) & (ref[..., 3] > 0.95)
    d = np.abs(new[..., :3] - ref[..., :3]).max(-1)
    same = both & (blur(d, 3) < 0.08)
    gains = [float(ref[..., c][same].mean() / new[..., c][same].mean()) for c in range(3)]
    for c in range(3):
        new[..., c] = np.clip(new[..., c] * gains[c], 0, 1)
    # premultiplied difference after the gain; thin edge differences (the key's soft rim) blur away, additions stay
    pn = new[..., :3] * new[..., 3:4]
    pr = ref[..., :3] * ref[..., 3:4]
    d = np.maximum(np.abs(pn - pr).max(-1), np.abs(new[..., 3] - ref[..., 3]) * 0.6)
    soft = blur(d, 2.0)
    w = np.clip((0.13 - soft) / (0.13 - 0.07), 0, 1)           # 1 = keep the level below
    w = blur(w, 1.0)
    out = np.empty_like(new)
    a = ref[..., 3:4] * w[..., None] + new[..., 3:4] * (1 - w[..., None])
    out[..., :3] = (pr * w[..., None] + pn * (1 - w[..., None])) / np.maximum(a, 1e-4)
    out[..., 3:] = a
    res = img(out)
    res.save(WORK / f"body{level}@2x.png")
    solid = lambda im: im.getchannel("A").point(lambda v: 255 if v >= 128 else 0).getbbox()
    print(f"level {level}: fit err {err:.4f} scale {k} shift ({dx},{dy}) canvas px; gains {[round(g, 3) for g in gains]}; "
          f"kept from below {100 * float((w > 0.5)[ref[..., 3] > 0.5].mean()):.1f}% of its pixels; "
          f"box below {solid(ref_im)} new {solid(res)}")
    if view:
        crop = (20, 180, 330, 650)
        def v(im):
            bg = Image.new("RGBA", im.size, (70, 40, 36, 255)); bg.alpha_composite(im)
            return bg.crop(crop).resize(((crop[2] - crop[0]) * 3, (crop[3] - crop[1]) * 3), Image.LANCZOS).convert("RGB")
        wm = Image.fromarray((w * 255).astype(np.uint8)).convert("RGB").crop(crop).resize(((crop[2] - crop[0]) * 3, (crop[3] - crop[1]) * 3))
        s = Image.new("RGB", (930 * 3, 1410))
        for i, x in enumerate((v(ref_im), v(res), wm)):
            s.paste(x, (i * 930, 0))
        s.save(view, quality=90)


if __name__ == "__main__":
    main(int(sys.argv[1]), sys.argv[2] if len(sys.argv) > 2 else None)
