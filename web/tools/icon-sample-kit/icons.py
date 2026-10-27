"""The game-icon samples: what each icon shows, and which Codex batch paints it.

Each batch is one Codex image call: four icons on a 2 x 2 grid on flat magenta, in the order
top-left, top-right, bottom-left, bottom-right. cut.py keys out the magenta and cuts them apart.
"""
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
OUT = REPO / "art-samples" / "icons"
STYLE = OUT / "refs" / "style.png"

ICONS = {
    "health": "HEALTH: a plump glossy red heart, darker red shading at the bottom, a big white shine highlight at the top left",
    "damage": "DAMAGE / ATTACK: a chunky purple-red monster paw seen from the front, with three big curved ivory claws "
              "slashing down, and three bright yellow-white slash streaks beside it",
    "speed": "SPEED: a red-and-white cartoon sneaker with small white feathered wings at its heel, dashing to the right, "
             "with three short white-yellow speed streaks behind it",
    "housing": "HOUSING SPACE: a small cosy wooden monster hut with a red roof and a round dark doorway, two glowing "
               "yellow monster eyes peeking out of the doorway",
    "time": "TIME: an hourglass with a carved wooden frame and gold caps, clear glass, golden sand running from the top "
            "bulb into a small pile in the bottom bulb",
    "yarddamage": "YARD DAMAGE: a chunk of grey stone wall made of big blocks, split by a big jagged dark crack, with a "
                  "few small stone chips flying off and a small puff of dust",
    "lost": "MONSTERS LOST: a small rounded grey tombstone on a little brown dirt mound, with a cute monster face carved "
            "into the stone that has X X eyes; a tiny green sprout beside it",
    "storagefull": "STORAGE FULL: a wooden crate overflowing with a heap of grey pebbles and brown twigs spilling over "
                   "its rim, and a round red warning badge with a white exclamation mark at its top right corner",
    "retreat": "RETREAT: a white cloth flag waving on a short brown wooden stick, with soft grey folds in the cloth",
    "lastarmy": "LAST ARMY: a group of three small round cartoon monster heads (one red, one green, one blue) with a big "
                "curved bright-blue U-turn arrow sweeping over them and pointing back to the left",
    "resourcebomb": "RESOURCE BOMB: a round black cartoon bomb with a lit sparkling fuse, with grey pebbles and brown "
                    "twigs bursting out of a crack in its side",
    "levelup": "LEVEL UP: a fat chunky bright green upward arrow with a lighter green shine, and two small yellow "
               "sparkle stars beside it",
    "shield": "PROTECTION: a rounded kite-shaped shield with a bright blue face, a thick shiny gold rim, a white shine "
              "highlight, and a small gold star in its middle",
    "production": "PRODUCTION PER HOUR: a small heap of brown twigs and grey pebbles with a green upward arrow rising "
                  "from it, and a small round white clock badge with dark hands at its bottom right",
    "swords": "ATTACK (alternative): two crossed short swords with steel blades, gold crossguards and brown leather "
              "grips, painted with glints on the blades",
    "fist": "DAMAGE (alternative): a chunky green monster fist punching forward, knuckles toward us, with a yellow "
            "starburst impact flash behind it",
    # simpler second tries of the four busiest icons (batch e)
    "lastarmy2": "LAST ARMY (simpler): ONE big round red cartoon monster head with two small horns and a grin, and a "
                 "thick bright-blue U-turn arrow curving over the top of its head and pointing back down to the left",
    "production2": "PRODUCTION PER HOUR (simpler): a round alarm-clock face with a thick gold rim, white face and two "
                   "dark hands, and a fat bright green upward arrow badge overlapping its bottom right",
    "yarddamage2": "YARD DAMAGE (simpler): a short section of red brick wall, three rows high, broken in the middle by a "
                   "big V-shaped gap with a few loose bricks tumbling out",
    "lost2": "MONSTERS LOST (simpler): one round green cartoon monster head with X X eyes, its tongue sticking out, and "
             "a small golden halo floating above it",
}

BATCHES = {
    "a": ["health", "damage", "speed", "housing"],
    "b": ["time", "yarddamage", "lost", "storagefull"],
    "c": ["retreat", "lastarmy", "resourcebomb", "levelup"],
    "d": ["shield", "production", "swords", "fist"],
    "e": ["lastarmy2", "production2", "yarddamage2", "lost2"],
}

# the 14 icons the owner asked for, in the order they are shown
SHEET = ["health", "damage", "speed", "housing", "time", "yarddamage", "lost", "storagefull", "retreat", "lastarmy",
         "resourcebomb", "levelup", "shield", "production"]
ALTERNATES = ["swords", "fist", "lastarmy2", "production2", "yarddamage2", "lost2"]

NAMES = {"health": "health", "damage": "damage", "speed": "speed", "housing": "housing", "time": "time",
         "yarddamage": "yard damage %", "lost": "monsters lost", "storagefull": "storage full", "retreat": "retreat",
         "lastarmy": "last army", "resourcebomb": "resource bomb", "levelup": "level up", "shield": "protection",
         "production": "per hour", "swords": "attack (alt)", "fist": "damage (alt)",
         "lastarmy2": "last army (2)", "production2": "per hour (2)", "yarddamage2": "damage % (2)",
         "lost2": "lost (2)"}
