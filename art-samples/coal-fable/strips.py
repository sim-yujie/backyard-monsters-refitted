from PIL import Image
N = {1: 47, 2: 45, 3: 45}
box = (150, 440, 480, 760)          # on out/tier<t>.png
for t in (1, 2, 3):
    im = Image.open('out/tier%d.png' % t)
    a = im.crop(box); b = im.crop((box[0] + 576, box[1], box[2] + 576, box[3]))
    w, h = a.size
    o = Image.new('RGB', (w * 4 + 12, h * 2), (30, 30, 30)); o.paste(a.resize((w * 2, h * 2), Image.NEAREST), (0, 0)); o.paste(b.resize((w * 2, h * 2), Image.LANCZOS), (w * 2 + 12, 0)); o.save('out/chute-cmp-tier%d.png' % t)
    # six frames of the 3D side, 2x, the chute only
    fr = [0, 2, 4, 6, 8, 10]
    cb = (300, 190, 480, 400)       # on the mp4 frame's 3D half
    cw, chh = (cb[2] - cb[0]) * 2, (cb[3] - cb[1]) * 2
    s = Image.new('RGB', (cw * 6 + 50, chh), (30, 30, 30))
    for i, f in enumerate(fr):
        m = Image.open('work/mp4-L%d/%03d.png' % (t, f)); half = (m.width - 12) // 2
        s.paste(m.crop((half + 12 + cb[0], cb[1], half + 12 + cb[2], cb[3])).resize((cw, chh), Image.LANCZOS), (i * (cw + 10), 0))
    s.save('out/chute-frames-tier%d.png' % t); print(s.size)
