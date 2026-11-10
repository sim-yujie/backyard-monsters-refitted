#!/bin/bash
# Owner comparison sheets for the full set: per batch, Classic | Modern pairs as the yard draws them (shadow,
# cloth/flame/water) plus two Modern buildings, at in-game size and 3x; then one wide sheet of all of them.
# Needs composed/ from: python ../pilot/yard_compose.py --repo <worktree> --out composed <types...>
set -e
cd "$(dirname "$0")"
R=$(cd ../../../.. && pwd); S=C:/Coding/BYMR/backyard-monsters-refitted/.claude/skills/game-art/scripts
O=$R/shots/autumn-modern; mkdir -p "$O"; C=composed
declare -A LABEL=([1]="Twig Snapper" [2]="Pebble Shiner" [3]="Putty Squisher" [4]="Goo Factory" [20]="Cannon Tower" [26]="Academy" [28]="American Flag" [29]="British Flag" [30]="Australian Flag" [31]="Brazilian Flag" [32]="European Flag" [33]="French Flag" [34]="Indonesian Flag" [35]="Italian Flag" [36]="Malaysian Flag" [37]="Dutch Flag" [38]="New Zealand Flag" [39]="Norwegian Flag" [40]="Polish Flag" [41]="Swedish Flag" [42]="Turkish Flag" [43]="Canadian Flag" [44]="Danish Flag" [45]="German Flag" [46]="Filipino Flag" [47]="Singaporean Flag" [48]="Austrian Flag" [49]="Pirate Flag" [50]="Peace Flag" [55]="Acorn" [56]="Beehive" [57]="Bird House" [58]="Camping Tent" [59]="Childrens Jax" [60]="Red Gnome" [61]="Blue Gnome" [62]="Green Gnome" [63]="Hammock" [64]="Lawn Chair" [65]="Outhouse" [66]="Pinecone" [67]="Rock" [68]="Toy Raceway" [69]="Scarecrow" [70]="Sun Dial" [71]="Tiki Torch" [72]="Walnut" [73]="Tombstone" [74]="Dead Pokey" [75]="Dead Octo-Ooze" [76]="Dead Bolt" [77]="Dead Bandito" [78]="Dead Brain" [79]="Dead Crabatron" [80]="Dead D.A.V.E." [81]="Dead Eye-ra" [82]="Dead Fang" [83]="Dead Fink" [84]="Dead Ichi" [85]="Dead Project-X" [86]="Blackberry Bush" [87]="Bonsai Tree" [88]="Cactus" [89]="Monster Fly Trap" [90]="Thorns" [91]="Pink Flowers" [92]="Purple Flowers" [93]="Red Flowers" [94]="White Flowers" [95]="Yellow Flowers" [96]="Baseball Trophy" [97]="Football Trophy" [98]="Soccer Trophy" [99]="Statue of Liberty" [100]="Eiffel Tower" [101]="Big Ben" [102]="Swimming Pool" [103]="Pond" [104]="Zen Garden" [105]="Fountain" [106]="Tea Garden" [107]="Monster Skull" [108]="Puzzle Cube (unsolved)" [109]="Puzzle Cube (solved)" [110]="D.A.V.E. Pumpkin" [111]="Mini-Pumpkin" [120]="Golden Big Gulp" [121]="Victory Totem Pole" [131]="Victory Totem Pole" [135]="D.A.V.E. Trophy" [201]="Leaf Pile and Rake" [202]="Apple Barrel" [203]="Pie on a Tree Stump" [204]="Harvest Wheelbarrow" [205]="Turkey Topiary" [206]="Autumn Maple Tree")
declare -A NAME=([1]="Twig Snapper" [2]="Pebble Shiner" [3]="Putty Squisher" [4]="Goo Factory" [20]="Cannon Tower" [26]="Academy")
sheet() {  # slug title b1 b2 types...
  local slug=$1 title=$2 b1=$3 b2=$4; shift 4; local args=()
  for t in "$@"; do args+=("${LABEL[$t]} C=$C/$t-classic@2x.png" "${LABEL[$t]} M=$C/$t-modern@2x.png"); done
  args+=("${NAME[$b1]} (Modern)=$C/$b1-modern@2x.png" "${NAME[$b2]} (Modern)=$C/$b2-modern@2x.png")
  python "$S/compare.py" --repo "$R" --out "$O/full-$slug.png" --cols "${COLS:-8}" \
    --title "$title: Classic | Modern (NEW) pairs, then Modern buildings" "${args[@]}" | tail -1
}
sheet heads-1 "Heads on sticks 1" 1 20 107 74 75 76 77 78
sheet heads-2 "Heads on sticks 2" 1 20 79 81 82 83 84 85
sheet small "Small things" 2 1 80 111 59 67 72 55
sheet plants "Plants" 3 4 66 69 90 86 88 56
sheet flowers "Flowers, Bird House, Sun Dial" 2 1 91 92 94 95 57 70
sheet good "Tent, Hammock, Chair, Cubes, Red Gnome" 3 2 58 63 64 108 109 60
sheet trophies "Gnomes, trophies, Big Gulp" 26 20 61 62 96 97 135 120
COLS=4 sheet tall "Eiffel Tower, Big Ben, Fly Trap" 26 4 100 101 89
COLS=4 sheet big "Pool, Pond, Raceway, Zen Garden, Tea Garden, Fountain (Flash water kept)" 26 4 102 103 68 104 106 105
# Totem levels: Classic and Modern tops, level by level (shadows differ per level; the yard picks by level).
D=assets/buildings/decorations; args=()
for f in wmitotem wmitotem2; do i=1; for c in top1.png top2.png top3.png top4.png top5.v2.png top6.png; do
  args+=("L$i Classic=$D/$f/$c" "L$i Modern=$D/$f/totem-l$i.modern@2x.webp"); i=$((i+1)); done; done
python "$S/compare.py" --repo "$R" --out "$O/full-totems.png" --cols 12 --zooms 1,2 \
  --title "Victory Totem Poles (121 top row, 131 bottom row): Classic | Modern (NEW), levels 1-6" "${args[@]}" | tail -1
# Wide sheet: every Modern decoration made in the full set, with Modern buildings among them.
args=(); n=0
for t in 1 107 74 75 76 77 78 79 81 82 83 84 85 80 2 111 59 67 72 55 66 69 90 86 3 88 56 91 92 94 95 57 70 4 58 63 64 108 109 60 61 62 20 96 97 135 120 121 131 26 100 101 89 105 102 103 68 104 106; do
  args+=("${LABEL[$t]}=$C/$t-modern@2x.png"); done
python "$S/compare.py" --repo "$R" --out "$O/full-all-modern.png" --cols 15 --zooms 1,2 \
  --title "Full set: every new Modern decoration among Modern buildings " "${args[@]}" | tail -1
