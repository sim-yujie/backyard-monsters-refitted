"""The FULL set of the Flash decorations' Modern look (owner approved the pilot's style, 10 Nov 2026).

    python batches.py ref <batch>     numbered Classic reference sheet + prompt.txt in <batch>/
    python batches.py cut <batch> [extra cut_sheet args...]   cut the Codex sheet, write the game files,
                                      print the decorationModernArt.ts rows into <batch>/rows.txt
Batches and descriptions: below. Heights and anchors: anchors.txt (the skill's flash_anchor.py), plus the
Fountain's stone (fountain.py writes its line). Run from this folder.
Codex: bash $S/run_codex.sh <batch> <the refs `ref` prints>.
"""
import os
import re
import subprocess
import sys

S = "C:/Coding/BYMR/backyard-monsters-refitted/.claude/skills/game-art/scripts"
sys.path.insert(0, S)
import artlib  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "../../../.."))
DECOR = os.path.join(REPO, "server/public/assets/buildings/decorations")

SQ = (3, 2, "1536x1024 split into 3 columns x 2 rows of equal cells (512x512 each)")
TALL = (3, 1, "1536x1024 split into 3 columns of equal tall cells (512x1024 each)")

HEAD = ("a monster's cartoon head stuck on top of a pointed wooden stake (a spooky 'head on a stick' yard "
        "trophy); keep the monster's own shape, colours and features exactly")
BATCHES = {
    "f1": (SQ, [
        (107, "skull", "MONSTER SKULL: a big monster skull on a wooden stake"),
        (74, "pokey", "DEAD POKEY: " + HEAD),
        (75, "octo", "DEAD OCTO-OOZE: " + HEAD),
        (76, "bolt", "DEAD BOLT: " + HEAD),
        (77, "bandito", "DEAD BANDITO: " + HEAD),
        (78, "brain", "DEAD BRAIN: " + HEAD)]),
    "f2": (SQ, [
        (79, "crabatron", "DEAD CRABATRON: " + HEAD),
        (81, "eyera", "DEAD EYE-RA: " + HEAD),
        (82, "fang", "DEAD FANG: " + HEAD),
        (83, "fink", "DEAD FINK: " + HEAD),
        (84, "ichi", "DEAD ICHI: " + HEAD),
        (85, "projectx", "DEAD PROJECT-X: " + HEAD)]),
    "f3": (SQ, [
        (80, "dave-head", "DEAD D.A.V.E.: the robot D.A.V.E.'s head on a wooden stake"),
        (111, "mini-pumpkin", "MINI-PUMPKIN: a small orange pumpkin"),
        (59, "jax", "CHILDREN'S JAX: a giant toy jack with its ball"),
        (67, "rock", "ROCK: a low flat grey boulder"),
        (72, "walnut", "WALNUT: a big walnut"),
        (55, "acorn", "ACORN: a big acorn with its cap")]),
    "f4": (SQ, [
        (66, "pinecone", "PINECONE: a big pinecone"),
        (69, "scarecrow", "SCARECROW: the scarecrow on its pole"),
        (90, "thorns", "THORNS: the thorny bramble bush"),
        (86, "blackberry-bush", "BLACKBERRY BUSH: the bush with blackberries"),
        (88, "cactus", "CACTUS: the cactus"),
        (56, "beehive", "BEEHIVE: the beehive")]),
    "f5": (SQ, [
        (91, "pink-flowers", "PINK FLOWERS: the flower pot with pink flowers"),
        (92, "purple-flowers", "PURPLE FLOWERS: the same kind of pot with purple flowers"),
        (94, "white-flowers", "WHITE FLOWERS: the same kind of pot with white flowers"),
        (95, "yellow-flowers", "YELLOW FLOWERS: the same kind of pot with yellow flowers"),
        (57, "bird-house", "BIRD HOUSE: the wooden bird house on its post"),
        (70, "sundial", "SUN DIAL: the sun dial")]),
    "f6": (SQ, [
        (58, "camping-tent", "CAMPING TENT: the camping tent"),
        (63, "hammock", "HAMMOCK: the hammock and its frame"),
        (64, "lawn-chair", "LAWN CHAIR: the lawn chair"),
        (108, "cube-unsolved", "PUZZLE CUBE (unsolved): the giant puzzle cube, colours mixed as in the Classic one"),
        (109, "cube-solved", "PUZZLE CUBE (solved): the same cube, each face one colour"),
        (60, "gnome-red", "RED GNOME: the garden gnome in red")]),
    "f7": (SQ, [
        (61, "gnome-blue", "BLUE GNOME: the same garden gnome in blue"),
        (62, "gnome-green", "GREEN GNOME: the same garden gnome in green"),
        (96, "baseball-trophy", "BASEBALL TROPHY: the gold baseball trophy"),
        (97, "football-trophy", "FOOTBALL TROPHY: the gold American football trophy"),
        (135, "dave-trophy", "D.A.V.E. TROPHY: the D.A.V.E. trophy"),
        (120, "big-gulp", "GOLDEN BIG GULP: the giant golden drink cup with its straw")]),
    "f8": (TALL, [
        (100, "eiffel-tower", "EIFFEL TOWER: the gold Eiffel Tower statue on its plinth"),
        (101, "big-ben", "BIG BEN: the gold Big Ben clock tower statue on its plinth"),
        (89, "flytrap", "MONSTER FLY TRAP: the giant fly trap plant")]),
    "f9": (SQ, [
        (102, "pool", "SWIMMING POOL: the swimming pool"),
        (103, "pond", "POND: the pond with its stones and plants"),
        (68, "raceway", "TOY RACEWAY: the toy car race track set"),
        (104, "zen-garden", "ZEN GARDEN: the zen garden"),
        (106, "tea-garden", "TEA GARDEN: the Japanese tea garden"),
        (105, "fountain-stone", "FOUNTAIN, STONE ONLY: the same three-tier stone fountain (wide round basin with a "
         "thick stone rim, a cone pillar, a middle bowl and a small top bowl) with calm still blue water in the "
         "basin and bowls but NO spray, NO falling water, NO splashes (the game adds the moving water on top). "
         "Exactly the same outline, size of each tier and position of each bowl as object 6, so the old spray "
         "lines up with the new bowls")]),
}

BATCHES["f2b"] = BATCHES["f2"]
# Pink or purple parts the plain magenta key eats: these are keyed with --connected-key (only the magenta joined
# to the background); everything else keeps the plain key, which also cleans magenta reflections off greys.
CONNECTED = {"f1": ["pokey", "brain"], "f2b": ["crabatron"], "f4": ["blackberry-bush"],
             "f5": ["pink-flowers", "purple-flowers"]}
# Tone fixes per batch (cut_sheet args): 15% less colour everywhere; the orange-gold trophies like the Liberty.
GOLD = "eiffel-tower=1.4,big-ben=1.4,baseball-trophy=1.4,football-trophy=1.4"
EXTRA = ["--sat", "0.85", "--gamma", GOLD, "--hue", GOLD.replace("1.4", "-1")]
# The Eiffel Tower's leg reached into the next cell of f8's sheet: cut by column ranges instead.
# Greys Codex tinted lilac/pink: recoloured after the cut (tidy.degrey), name -> hue (None = plain grey).
DEGREY = {"f3": {"rock": 250}}
SPLITS = {"f8": [(20, 637), (637, 1015), (1015, 1536)]}  # f2 redone: its first sheet left out the heads' blood puddles


def anchors():
    out = {}
    for ln in open(os.path.join(HERE, "anchors.txt"), encoding="utf-8"):
        m = re.search(r"^\s*(\d+) .*height ([\d.]+)\s+bottom ([-\d.]+)\s+centre ([-\d.]+)\s+-> --item \d+:<name>:(\d+):"
                      r".*\((\S+)\)", ln)
        if m:
            t, h, b, c, size, url = m.groups()
            out[int(t)] = dict(h=round(float(h)), bottom=round(float(b)), centre=c, size=size,
                               folder=url.split("/decorations/")[1].split("/")[0] if "/decorations/" in url else "fountain", url=url)
    return out


def ref_path(x):
    return "assets" + x["url"].split("/assets", 1)[1] if x["url"].startswith("/assets") else x["url"]


def ref(batch):
    (cols, _, grid), items = BATCHES[batch]
    a = anchors()
    os.makedirs(os.path.join(HERE, batch), exist_ok=True)
    pics = [(str(i + 1), artlib.load(ref_path(a[t]), REPO)) for i, (t, _, _) in enumerate(items) if t]
    z = min(4.0, 300 / max(im.height for _, im in pics), 420 / max(im.width for _, im in pics))
    pics = [(n, artlib.scale(im, z)) for n, im in pics]
    artlib.grid(pics, cols, fsize=28).convert("RGB").save(os.path.join(HERE, batch, "ref-classic.png"))
    lines = [f"- Cell {i + 1} (row {i // cols + 1}, column {i % cols + 1}) = object {i + 1}: {d}."
             for i, (t, _, d) in enumerate(items)]
    tmpl = open(os.path.join(HERE, "prompt-template.txt"), encoding="utf-8").read()
    txt = (tmpl.replace("{N}", str(len(items))).replace("{ITEMS}", "\n".join(lines)).replace("{GRID}", grid)
           .replace("{SAVE}", f"{batch}.png"))
    open(os.path.join(HERE, batch, "prompt.txt"), "w", encoding="utf-8").write(txt)
    print(f"bash $S/run_codex.sh {batch} ../refs/ref-modern-close.png ../refs/ref-modern-all.png "
          f"ref-modern-decor.png {batch}/ref-classic.png")


def cut(batch, extra):
    (cols, rows, _), items = BATCHES[batch]
    a = anchors()
    names = ",".join(s for _, s, _ in items)
    heights = ",".join(str(a[t]["h"]) for t, _, _ in items)
    out = os.path.join(HERE, batch, "out")
    sheet = os.path.join(HERE, batch, f"{batch}.png")
    if batch in SPLITS:  # an object spilled over its cell's edge: cut each from its own column range
        from PIL import Image
        im = Image.open(sheet)
        for (t, s, _), (x0, x1) in zip(items, SPLITS[batch]):
            part = os.path.join(HERE, batch, f"part-{s}.png")
            im.crop((x0, 0, x1, im.height)).save(part)
            subprocess.run([sys.executable, f"{S}/cut_sheet.py", part, "--cols", "1", "--rows", "1", "--out", out,
                            f"--names={s}", "--height", str(a[t]["h"]), *EXTRA, *extra], check=True, capture_output=True)
    else:
        for connected in (False, True):
            only = CONNECTED.get(batch, [])
            if connected and not only:
                break
            these = ",".join(s if (s in only) == connected else "-" for _, s, _ in items)
            subprocess.run([sys.executable, f"{S}/cut_sheet.py", sheet, "--cols", str(cols), "--rows", str(rows),
                            "--out", out, f"--names={these}", "--height", heights, *EXTRA, *extra,
                            *(["--connected-key"] if connected else [])], check=True, capture_output=True)
    from tidy import degrey
    for name, hue in DEGREY.get(batch, {}).items():
        degrey(out, name, hue)
    rows_txt = []
    for t, s, _ in items:
        x = a[t]
        res = subprocess.run([sys.executable, f"{S}/make_game_files.py", "--src", out, "--suffix", ".modern", "--format",
                              "webp", "--out", os.path.join(DECOR, x["folder"]),
                              "--item", f'{t}:{s}:{x["size"]}:{x["bottom"]}:{x["centre"]}'],
                             check=True, capture_output=True, text=True).stdout
        m = re.search(r'(\[".*?\])\s+(\[".*?\])', res)
        rows_txt.append(f"  {t}: modernLook({m.group(1)}, {m.group(2)}),")
    open(os.path.join(HERE, batch, "rows.txt"), "w", encoding="utf-8").write("\n".join(rows_txt) + "\n")
    print("\n".join(rows_txt))


if __name__ == "__main__":
    cmd, batch, *rest = sys.argv[1:]
    {"ref": lambda: ref(batch), "cut": lambda: cut(batch, rest), "vet": lambda: None}[cmd]()


def vet(batch):
    """Classic | Modern pairs of a batch at in-game size and 3x, for vetting (vet/<batch>.png)."""
    _, items = BATCHES[batch]
    a = anchors()
    pics = []
    for t, s, _ in items:
        pics += [f"{t} C={ref_path(a[t])}", f"{t} M=assets/buildings/decorations/{a[t]['folder']}/{s}.modern@2x.webp"]
    os.makedirs(os.path.join(HERE, "vet"), exist_ok=True)
    subprocess.run([sys.executable, f"{S}/compare.py", "--repo", REPO, "--out", os.path.join(HERE, "vet", f"{batch}.png"),
                    "--cols", "6", "--zooms", "3", "--smooth", *pics], check=True)


if __name__ == "__main__" and sys.argv[1] == "vet":
    vet(sys.argv[2])
