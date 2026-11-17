"""proj.py : Flash's own picture laid on the 3D model from the game camera, and the model's outline without a render.

idmap(s)        ray-casts the model from the game camera, s rays per Flash px each way -> (object names, material
                names, object index grid, material index grid); -1 = nothing hit.
sil(path, s)    saves the outline (alpha) and a part-coloured id picture: <path>.png and <path>-ids.png.
apply(...)      for every material, a copy of Flash's picture that keeps only the Flash pixels lying wholly inside
                that material's parts (as the model stands at frame 0) and fills the rest outward from them, so a part
                never picks up its neighbour's colours where the model is a pixel off, and parts hidden behind moving
                ones get their own material's colours. The picture is mixed into the material's base colour (weight
                w), with fine grit multiplied in (the source is 1 px per Flash px), and part of the surface is shown
                unlit (emit) so Flash's painted shading is not lit a second time. Moving groups named in `moving`
                carry the picture of their frame-0 pose with them; other moving groups keep their own materials.
"""
import math
import os
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.expanduser("~/.cache/bym-artpy"))
from PIL import Image  # noqa: E402

import kit  # noqa: E402


def root_of(o):
    p = o
    while p is not None:
        if p in kit.MOVING:
            return p
        p = p.parent
    return None


def idmap(s=3):
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    fwd = kit.cam_fwd()
    x0, y0, x1, y1 = kit.FRAME
    w, h = (x1 - x0) * s, (y1 - y0) * s
    obs, mats = [], []
    oi = np.full((h, w), -1, np.int32)
    mi = np.full((h, w), -1, np.int32)
    cache = {}
    for iy in range(h):
        sy = y0 + (iy + 0.5) / s
        for ix in range(w):
            sx = x0 + (ix + 0.5) / s
            o = kit.px(sx, sy, Z=4.0) - fwd * 60
            ok, loc, nrm, idx, ob, mat = kit.SC.ray_cast(dg, o, fwd)
            if not ok or ob.name == "ground":
                continue
            if ob.name not in cache:
                obs.append(ob.name)
                ev = ob.evaluated_get(dg)
                pm = None
                if ob.type == "MESH" and len(ob.material_slots) > 1:
                    pm = [p.material_index for p in ev.data.polygons]
                cache[ob.name] = (len(obs) - 1, pm)
            k, pm = cache[ob.name]
            oi[iy, ix] = k
            slot = pm[idx] if pm and idx < len(pm) else 0
            m = ob.material_slots[slot].material if ob.material_slots else None
            name = m.name.split("@")[0] if m else "?"
            if name not in mats:
                mats.append(name)
            mi[iy, ix] = mats.index(name)
    return obs, mats, oi, mi


def sil(path, s=3, family=None):
    obs, mats, oi, mi = idmap(s)
    a = np.zeros(oi.shape + (4,), np.uint8)
    a[oi >= 0] = 255
    a[..., :3] = 90
    Image.fromarray(a).save(str(path) + ".png")
    fams = [family(bpy.data.objects[n]) if family else n for n in obs]
    uniq = sorted(set(fams))
    rnd = np.random.RandomState(3)
    cols = rnd.randint(40, 255, (len(uniq) + 1, 3)).astype(np.uint8)
    lut = np.array([uniq.index(f) for f in fams] + [len(uniq)])
    c = np.zeros(oi.shape + (3,), np.uint8)
    c[:] = cols[lut[oi]]
    c[oi < 0] = 0
    Image.fromarray(c).save(str(path) + "-ids.png")
    print("SIL", path, "parts", len(uniq))


def fill(rgb, ok, rounds=400):
    """Spread the colours of the `ok` pixels outward until the whole picture is filled."""
    rgb = rgb.astype(np.float32) * ok[..., None]
    ok = ok.copy()
    for _ in range(rounds):
        if ok.all():
            break
        p = np.pad(rgb, ((1, 1), (1, 1), (0, 0)))
        q = np.pad(ok.astype(np.float32), 1)
        sm = np.zeros_like(rgb)
        n = np.zeros(ok.shape, np.float32)
        for dy in (0, 1, 2):
            for dx in (0, 1, 2):
                wgt = 1.0 if (dy == 1 or dx == 1) else 0.7
                sm += wgt * p[dy:dy + ok.shape[0], dx:dx + ok.shape[1]]
                n += wgt * q[dy:dy + ok.shape[0], dx:dx + ok.shape[1]]
        new = (n > 0) & ~ok
        rgb[new] = sm[new] / n[new][:, None]
        ok |= new
    return rgb


def _variant(mat, root, img, w, emit, grit, empties, metal_keep):
    key = "%s@%s" % (mat.name, root.name if root else "static")
    if key in bpy.data.materials:
        return bpy.data.materials[key]
    m = mat.copy()
    m.name = key
    t = m.node_tree
    bsdf = next(n for n in t.nodes if n.type == "BSDF_PRINCIPLED")
    out = next(n for n in t.nodes if n.type == "OUTPUT_MATERIAL")
    rk = root.name if root else None
    if rk not in empties:
        e = bpy.data.objects.new("proj-" + str(rk), None)
        kit.link(e)
        right = Vector((1, 1, 0)).normalized()
        g = Vector((kit.SY, -kit.SY, -kit.SZ)) / 10.0
        up = -g
        e.matrix_world = Matrix((right, up, right.cross(up))).transposed().to_4x4()
        if root:
            bpy.context.view_layer.update()
            mw = e.matrix_world.copy()
            e.parent = root
            e.matrix_parent_inverse = root.matrix_world.inverted()
            e.matrix_world = mw
        empties[rk] = e
    x0, y0, x1, y1 = kit.FRAME
    W, H = x1 - x0, y1 - y0
    tc = t.nodes.new("ShaderNodeTexCoord")
    tc.object = empties[rk]
    mp = t.nodes.new("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (10.0 / W, 10.0 / H, 1.0)
    mp.inputs["Location"].default_value = ((kit.ORIGIN[0] - x0) / W, 1.0 - (kit.ORIGIN[1] - y0) / H, 0.0)
    t.links.new(tc.outputs["Object"], mp.inputs["Vector"])
    tex = t.nodes.new("ShaderNodeTexImage")
    tex.image = img
    tex.interpolation = "Cubic"
    tex.extension = "EXTEND"
    t.links.new(mp.outputs[0], tex.inputs["Vector"])
    col = tex.outputs["Color"]
    if grit:
        tc2 = t.nodes.new("ShaderNodeTexCoord")
        nz = t.nodes.new("ShaderNodeTexNoise")
        nz.inputs["Scale"].default_value = 26.0
        nz.inputs["Detail"].default_value = 4.0
        nz.inputs["Roughness"].default_value = 0.7
        t.links.new(tc2.outputs["Object"], nz.inputs["Vector"])
        mr = t.nodes.new("ShaderNodeMapRange")
        mr.inputs["From Min"].default_value = 0.3
        mr.inputs["From Max"].default_value = 0.7
        mr.inputs["To Min"].default_value = 1.0 - grit
        mr.inputs["To Max"].default_value = 1.0 + grit * 0.6
        t.links.new(nz.outputs["Fac"], mr.inputs["Value"])
        vm = t.nodes.new("ShaderNodeVectorMath")
        vm.operation = "SCALE"
        t.links.new(col, vm.inputs[0])
        t.links.new(mr.outputs[0], vm.inputs["Scale"])
        col = vm.outputs[0]
    bc = bsdf.inputs["Base Color"]
    mx = t.nodes.new("ShaderNodeMix")
    mx.data_type = "RGBA"
    mx.inputs[0].default_value = w
    if bc.is_linked:
        t.links.new(bc.links[0].from_socket, mx.inputs[6])
    else:
        mx.inputs[6].default_value = bc.default_value
    t.links.new(col, mx.inputs[7])
    t.links.new(mx.outputs[2], bc)
    bsdf.inputs["Metallic"].default_value *= metal_keep
    ro = bsdf.inputs["Roughness"]            # no mirror-like plates: Flash's shading is already in the picture
    for l in list(ro.links):
        t.links.remove(l)
    ro.default_value = 0.72
    ec, es = bsdf.inputs["Emission Color"], bsdf.inputs["Emission Strength"]
    if ec.is_linked:                         # a glowing material glows in Flash's colours, evenly, with no pattern
        t.links.remove(ec.links[0])
        t.links.new(mx.outputs[2], ec)
        for l in list(es.links):
            t.links.remove(l)
        es.default_value = 0.0
        for l in list(bsdf.inputs["Normal"].links):
            t.links.remove(l)
    if emit:
        em = t.nodes.new("ShaderNodeEmission")
        t.links.new(mx.outputs[2], em.inputs["Color"])
        ms = t.nodes.new("ShaderNodeMixShader")
        ms.inputs[0].default_value = emit
        src = out.inputs["Surface"].links[0].from_socket
        t.links.new(src, ms.inputs[1])
        t.links.new(em.outputs[0], ms.inputs[2])
        t.links.new(ms.outputs[0], out.inputs["Surface"])
    return m


def apply(flash_png, workdir, w=0.7, emit=0.5, grit=0.1, per=None, moving=(), skip=(), s=3, up=4, metal_keep=0.4, trim=0):
    per = per or {}
    workdir = Path(workdir)
    workdir.mkdir(exist_ok=True)
    fl = np.array(Image.open(flash_png).convert("RGBA"))
    H, W = fl.shape[:2]
    obs, mats, oi, mi = idmap(s)
    solid = fl[..., 3] > 200
    imgs = {}
    for k, name in enumerate(mats):
        if name in skip:
            continue
        mk = (mi == k).reshape(H, s, W, s)
        whole = mk.all(axis=(1, 3)) & solid
        if whole.sum() < 6:
            whole = (mk.mean(axis=(1, 3)) > 0.5) & (fl[..., 3] > 128)
        if whole.sum() < 3:
            print("PROJ no Flash pixels for", name)
            continue
        tr = per.get(name, {}).get("trim", trim)
        if tr and whole.sum() > 40:          # drop the pixels least like the rest (a neighbour's colours)
            px_ = fl[..., :3][whole].astype(np.float32)
            d = np.abs(px_ - np.median(px_, axis=0)).sum(1)
            keep = d <= np.percentile(d, 100 - tr)
            ys, xs = np.where(whole)
            whole[ys[~keep], xs[~keep]] = False
        f = fill(fl[..., :3], whole)
        im = Image.fromarray(np.clip(f, 0, 255).astype(np.uint8)).resize((W * up, H * up), Image.BICUBIC)
        p = workdir / ("proj-%s.png" % name)
        im.save(p)
        imgs[name] = bpy.data.images.load(str(p))
        print("PROJ %-10s %5d Flash px" % (name, whole.sum()))
    empties = {}
    names = {r.name for r in kit.MOVING}
    for o in list(kit.SC.objects):
        if not o.material_slots:
            continue
        root = root_of(o)
        if root is not None and root.name not in moving:
            continue
        for sl in o.material_slots:
            m = sl.material
            if m is None or "@" in m.name or m.name not in imgs:
                continue
            c = per.get(m.name, {})
            sl.material = _variant(m, root, imgs[m.name], c.get("w", w), c.get("emit", emit), c.get("grit", grit),
                                   empties, metal_keep)
    bpy.context.view_layer.update()
