"""static3d.py : the render modes of a 3D defence building that does not turn (Tesla Tower, Monster Bunker;
towers-3d-export, 29 Oct 2026), on top of look3d.py and square3d.py: the same camera, scale (75 px per unit at @2x)
and ground middle as the turning towers, but the whole building is one picture.

    import static3d as S
    S.run("tesla", build, tier, HERE, args, canvas=(720, 1100, 360, 900))

build() -> the body root; it may also leave an empty named `BOTTOM` (the Bunker's shutters) with custom properties `top`
(a height) and `squash`: `rise F` rolls what hangs from it up toward `top`, squashing it to 1 - F (1 - squash) of its
height, before rendering.

Modes (`blender -b --factory-startup -P <tower>3d.py -- T MODE`):
  body               render/tT/body-4x.png       the whole building, the ground middle on the canvas's ground pixel
  rise F [F ...]     render/tT/rise-FFF.png      the same with the BOTTOM part raised F of the way (F in 0-1)
  save               <name>-tT.blend
render/tT/camera.json records the ground middle on the canvas.
"""
import json

import bmesh
import bpy

import look3d as L
import square3d as Q


def fill(bm, area=0.03, cuts=5):
    """Grid-fill the big flat faces of a bevelled box or section before worn3d's finish(): a flat face whose only vertices
    sit on its bevels would read as all ridge (pale wear over the whole face); its inner vertices read flat."""
    edges = {e for f in bm.faces if f.calc_area() > area for e in f.edges}
    if edges:
        bmesh.ops.subdivide_edges(bm, edges=list(edges), cuts=cuts, use_grid_fill=True)
    return bm


def run(name, build, tier, here, args, canvas):
    out = here / "render" / f"t{tier}"
    out.mkdir(parents=True, exist_ok=True)
    L.OUT = out
    body = build()
    cam = L.setup_render()
    obs = L.objs_under(body)
    w, h, gx, gy = canvas
    info = dict(tier=tier, elevation=L.EL, px_per_unit_4x=Q.PPU, canvas_4x=[w, h])
    info["ground_4x"] = Q.frame(cam, w, h, gx, gy, (0, 0, 0))
    what = args[0] if args else "body"
    warm = L.LINE_COLS["warm"]
    bottom = bpy.data.objects.get("BOTTOM")
    if what == "save":
        bpy.ops.wm.save_as_mainfile(filepath=str(here / f"{name}-t{tier}.blend"))
        return
    if what == "body":
        L.shot(out / "body-4x.png", obs, outer_col=warm)
    elif what == "rise":
        for f in [float(a) for a in args[1:]] or [1.0]:
            s = 1.0 - f * (1.0 - bottom["squash"])
            bottom.scale.z = s
            bottom.location.z = bottom["top"] * (1.0 - s)
            bpy.context.view_layer.update()
            L.shot(out / f"rise-{round(f * 100):03d}.png", obs, outer_col=warm)
        bottom.scale.z, bottom.location.z = 1.0, 0.0
    old = json.loads((out / "camera.json").read_text()) if (out / "camera.json").exists() else {}
    old.update(info)
    (out / "camera.json").write_text(json.dumps(old, indent=1))
    print("DONE", name, what, info)
