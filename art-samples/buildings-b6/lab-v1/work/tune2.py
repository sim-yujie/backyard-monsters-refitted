"""tune2.py <lab-v1 path>: Flash's grey steam that spills out of the side doors and down onto the plate."""
import sys
from pathlib import Path
D = Path(sys.argv[1])
s = (D / "lab.py").read_text(encoding="utf8")
rep = [
('''    n = t.noise(v, 3.0, 3.0, 0.5)
    col = t.ramp(n, [(0.35, srgb(96, 98, 102)), (0.65, srgb(150, 152, 154))])
    geo = t.n("ShaderNodeNewGeometry")
    sep = t.n("ShaderNodeSeparateXYZ")
    t.link(geo.outputs["Normal"], sep.inputs[0])
    col = t.mix(col, srgb(240, 242, 244), t.ramp(sep.outputs["Z"], [(0.45, (0, 0, 0, 1)), (0.9, (0.85, 0.85, 0.85, 1))]))
    t.set(**{"Base Color": col, "rough": 0.9, "spec": 0.1})''',
 '''    # Flash's steam is a mid grey mass, darker in the folds, with pale grey (not white) tops
    n = t.noise(v, 2.2, 2.0, 0.5)
    col = t.ramp(n, [(0.38, srgb(104, 106, 110)), (0.62, srgb(146, 148, 150))])
    geo = t.n("ShaderNodeNewGeometry")
    sep = t.n("ShaderNodeSeparateXYZ")
    t.link(geo.outputs["Normal"], sep.inputs[0])
    col = t.mix(col, srgb(200, 202, 204), t.ramp(sep.outputs["Z"], [(0.55, (0, 0, 0, 1)), (0.95, (0.7, 0.7, 0.7, 1))]))
    t.set(**{"Base Color": col, "rough": 0.95, "spec": 0.05})'''),
('''                p, r = path(s)
                ob.location = p
                ob.scale = (r, r, r * 0.85)''',
 '''                p, sc = path(s)
                ob.location = p
                ob.scale = sc'''),
('''    """Puffs pouring out of the door's top half and rolling down and out onto the plate; set_phase moves them."""
    def path(s, k=k):
        out = 0.25 + 2.0 * s ** 0.8
        z = 2.5 - 2.1 * s ** 1.3
        side = 0.25 * math.sin(2.5 * s + 2 * k) * (1 if k == 0 else -1)
        r = 0.48 + 0.32 * s
        p = c + n * out + t * side
        return Vector((p.x, p.y, max(z, r * 0.55 + 0.14))), r
    puffs = []
    for i in range(6):
        bm = bmesh.new()
        bmesh.ops.create_icosphere(bm, subdivisions=3, radius=1.0)
        for v in bm.verts:
            v.co *= 1.0 + 0.18 * math.sin(3 * v.co.x + i) * math.cos(4 * v.co.y + 2 * i)
        ob = mesh_ob(f"steam{k}-{i}", bm, [M["steam"]], smooth=True)
        puffs.append((ob, path))
    STEAM[k] = puffs''',
 '''    """Grey chunks tumbling out of the door's top half, falling outward and spilling across the plate (Flash);
    set_phase moves them. A chunk starts inside the wall, falls to the plate, spreads flat and sinks into it."""
    sgn = 1 if k == 0 else -1

    def path(s, i, k=k):
        jit = ((i * 7) % 5 - 2) / 2.0                     # each chunk drifts a little to its own side
        if s < 0.5:                                       # out of the door and falling
            f = s / 0.5
            out = -0.3 + 1.5 * f
            z = 2.45 - 2.0 * f ** 1.6
            side = 0.12 * jit * f
            r = 0.42 + 0.22 * f
            sc = (r, r, r * 0.9)
        else:                                             # spilling out across the plate, spreading and flattening
            f = (s - 0.5) / 0.5
            out = 1.2 + 0.85 * f
            side = (0.12 + 0.55 * f) * jit + 0.25 * f * sgn
            r = 0.64 + 0.14 * f - 0.5 * max(0.0, f - 0.8) / 0.2
            z = 0.45 - 0.1 * f - 0.3 * max(0.0, f - 0.8) / 0.2
            sc = (r * 1.15, r * 1.15, r * (0.7 - 0.2 * f))
        p = c + n * out + t * side
        return Vector((p.x, p.y, z)), sc
    puffs = []
    for i in range(9):
        bm = bmesh.new()
        bmesh.ops.create_icosphere(bm, subdivisions=2, radius=1.0)
        for v in bm.verts:                                # lumpy, chunky clumps rather than round balls
            v.co *= 1.0 + 0.22 * math.sin(3.1 * v.co.x + i) * math.cos(3.7 * v.co.y + 2 * i) \\
                + 0.1 * math.sin(5 * v.co.z + 3 * i)
        ob = mesh_ob(f"steam{k}-{i}", bm, [M["steam"]], smooth=True)
        puffs.append((ob, lambda s, i=i: path(s, i)))
    STEAM[k] = puffs'''),
]
for a, b in rep:
    assert a in s, a[:70]
    s = s.replace(a, b)
(D / "lab.py").write_text(s, encoding="utf8")
print("ok")
