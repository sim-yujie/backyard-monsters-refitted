"""One video per ability: today's version, astra's and neon's, one after the other, each at real speed and then its
key moment 4x slower (filmed at 120 fps), Modern, then the same in Classic. Title cards name the model.

python3 assemble.py <ability>      (aura | shards | stomp; frames from film.mjs in $FRAMES)
Writes fxbake/video/krampus-<ability>.mp4.
"""
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
FRAMES = os.environ.get(
    "FRAMES", "/tmp/claude-1000/-home-yujiesim-Coding-backyard-monsters-refitted/8693e50e-0911-4064-befe-7adf899be621/scratchpad/kfx/frames")
OUT = os.path.join(HERE, "video")
os.makedirs(OUT, exist_ok=True)

WHO = {
    "current": ("Today's version", "what the game has now"),
    "astra": ("astra", "designed and painted by Codex (gpt-6-astra)"),
    "neon": ("neon", "designed by Antigravity (Gemini 4 Neon), painted by its image generator"),
}
# ability: title, line, real-speed take prefix and frame range (30 fps), slow take prefix
ABILITY = {
    "aura": ("Krampus: Frost aura", "Always on: towers inside see 10-20% less far", "a", (20, 200), "sa"),
    "stomp": ("Krampus: Blizzard Stomp", "Rears up, slams: towers inside work 30% slower for 3 s", "a", (352, 430), "ss"),
    "shards": ("Krampus: Ice Shards", "Flings ice at a flyer every 0.7 s: chills it 30% for 2 s", "sh", None, "ssh"),
}


def run(cmd):
    subprocess.run(cmd, check=True)


def main():
    ability = sys.argv[1]
    title, line, real, span, slow = ABILITY[ability]
    if span is None:
        span = tuple(int(v) for v in os.environ["SPAN"].split(","))
    tmp = tempfile.mkdtemp(prefix=f"kfx-{ability}-", dir=os.path.dirname(FRAMES))
    parts = []

    def part(name):
        path = os.path.join(tmp, f"{len(parts):02d}-{name}.mp4")
        parts.append(path)
        return path

    run(["bash", f"{HERE}/card.sh", part("title"), title, line, "2.5"])
    for look in ("modern", "classic"):
        if look == "classic":
            run(["bash", f"{HERE}/card.sh", part("classic"), "Classic look", "the same three, in the Classic (Flash) look", "2"])
        for fx in ("current", "astra", "neon"):
            name, who = WHO[fx]
            look_word = "Modern" if look == "modern" else "Classic"
            run(["bash", f"{HERE}/card.sh", part(f"{fx}-card"), name, who, "1.6"])
            run(["bash", f"{HERE}/caption.sh", f"{FRAMES}/{real}-{look}-{fx}", str(span[0]), str(span[1]),
                 part(f"{fx}-real"), f"{name} ({look_word}): real speed"])
            sdir = f"{FRAMES}/{slow}-{look}-{fx}"
            count = len([f for f in os.listdir(sdir) if f.endswith(".jpg")])
            run(["bash", f"{HERE}/caption.sh", sdir, "0", str(count - 1), part(f"{fx}-slow"),
                 f"{name} ({look_word}): 4x slower"])
    listing = os.path.join(tmp, "list.txt")
    with open(listing, "w") as f:
        for p in parts:
            f.write(f"file '{p}'\n")
    out = os.path.join(OUT, f"krampus-{ability}.mp4")
    run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", listing, "-c:v", "libx264",
         "-crf", "24", "-preset", "slow", "-pix_fmt", "yuv420p", "-r", "30", out])
    print(out, os.path.getsize(out))


if __name__ == "__main__":
    main()
