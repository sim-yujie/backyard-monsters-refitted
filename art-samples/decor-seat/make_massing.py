"""Block-out guide (grey massing on the 2:1 slab) for the two facade wonders that Codex kept turning to face the
camera: Paoay Church and Fort Santiago Gate. python make_massing.py <out.png>"""
import sys
from PIL import Image, ImageDraw

TOP, LEFT, RIGHT, DARK = (205, 205, 205), (160, 160, 160), (85, 85, 85), (35, 35, 35)


class Cell:
    def __init__(self, d, cx, b, a, t):
        self.d, self.cx, self.a, self.t = d, cx, a, t
        self.by = b - a - t  # screen y of the slab top's back corner at ground (z = t)
        self.b = b

    def p(self, gx, gy, z):
        """slab grid (0..1, back corner 0,0; left corner 0,1; front 1,1; right 1,0) at height z px above the slab top"""
        return (self.cx + (gx - gy) * self.a, self.by + (gx + gy) * self.a / 2 - z)

    def box(self, x0, y0, x1, y1, h, z=0):
        P = self.p
        self.d.polygon([P(x0, y1, z), P(x1, y1, z), P(x1, y1, z + h), P(x0, y1, z + h)], fill=LEFT)
        self.d.polygon([P(x1, y0, z), P(x1, y1, z), P(x1, y1, z + h), P(x1, y0, z + h)], fill=RIGHT)
        self.d.polygon([P(x0, y0, z + h), P(x1, y0, z + h), P(x1, y1, z + h), P(x0, y1, z + h)], fill=TOP)

    def left_face(self, pts, gy, fill=LEFT):
        """polygon on the vertical plane gy (facing lower left), pts as (gx, z)"""
        self.d.polygon([self.p(gx, gy, z) for gx, z in pts], fill=fill)

    def right_face(self, pts, gx, fill=RIGHT):
        self.d.polygon([self.p(gx, gy, z) for gy, z in pts], fill=fill)

    def slab(self):
        cx, b, a, t = self.cx, self.b, self.a, self.t
        h = a / 2
        self.d.polygon([(cx, b), (cx - a, b - h), (cx - a, b - h - t), (cx, b - t)], fill=LEFT)
        self.d.polygon([(cx, b), (cx + a, b - h), (cx + a, b - h - t), (cx, b - t)], fill=RIGHT)
        self.d.polygon([(cx, b - t), (cx - a, b - h - t), (cx, b - 2 * h - t), (cx + a, b - h - t)], fill=TOP)


def main():
    im = Image.new("RGB", (1536, 1024), (255, 0, 255))
    d = ImageDraw.Draw(im)
    # --- Paoay: church body runs back from its front gable; the gable faces the lower left (plane gy = 0.86)
    c = Cell(d, 384, 990, 260, 16); c.slab()
    c.box(0.62, 0.18, 0.92, 0.42, 250)                     # bell tower at the right corner, behind
    c.box(0.65, 0.2, 0.89, 0.40, 40, 250)                  # its top storey
    c.box(0.12, 0.40, 0.70, 0.86, 120)                     # nave
    # roof ridge running back from the gable
    d.polygon([c.p(0.12, 0.86, 120), c.p(0.12, 0.63, 185), c.p(0.70, 0.63, 185), c.p(0.70, 0.86, 120)], fill=(150, 90, 80))
    d.polygon([c.p(0.70, 0.40, 120), c.p(0.70, 0.63, 185), c.p(0.70, 0.86, 120)], fill=RIGHT)
    # stepped gable on the front (left-facing) wall
    c.left_face([(0.12, 120), (0.12, 165), (0.22, 165), (0.22, 205), (0.32, 205), (0.32, 245), (0.50, 245),
                 (0.50, 205), (0.60, 205), (0.60, 165), (0.70, 165), (0.70, 120)], 0.86)
    c.left_face([(0.38, 0), (0.38, 60), (0.41, 72), (0.44, 60), (0.44, 0)], 0.86, DARK)  # door
    # buttresses along the right side wall, like giant stairs
    for i, gy in enumerate((0.44, 0.58, 0.72)):
        for s, (h, depth) in enumerate(((110, 0.10), (75, 0.17), (40, 0.24))):
            c.box(0.70, gy, 0.70 + depth, gy + 0.06, h)
    # --- Fort Santiago: the gateway is the front-left wall, a lower fort wall runs along the front-right edge
    c = Cell(d, 1152, 990, 260, 16); c.slab()
    c.box(0.86, 0.10, 0.98, 0.86, 150)                    # wall along the front-right edge
    c.box(0.10, 0.70, 0.98, 0.94, 150)                    # wall along the front-left edge
    c.box(0.40, 0.66, 0.72, 0.97, 230)                    # the gate block, taller, standing a little proud
    c.left_face([(0.44, 230), (0.47, 290), (0.56, 310), (0.65, 290), (0.68, 230)], 0.97)       # pediment
    c.left_face([(0.48, 0), (0.48, 110), (0.53, 135), (0.59, 135), (0.64, 110), (0.64, 0)], 0.97, DARK)  # arch
    for gx in (0.12, 0.96):                                # corner ornaments
        c.box(gx - 0.02, 0.86, gx + 0.02, 0.90, 30, 150)
    im.save(sys.argv[1])


if __name__ == "__main__":
    main()
