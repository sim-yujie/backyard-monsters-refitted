#!/bin/bash
# codex.sh <look> <layout> <job>: one Codex edit call (prompts.py) with the guide, the current picture, the photo sheet
cd "$(dirname "$0")"
S=/home/yujiesim/Coding/backyard-monsters-refitted/.claude/skills/game-art/scripts
look=$1; lay=$2; job=$3
python3 prompts.py $job $look $lay
mkdir -p in; cp guide/$look-$lay.png in/guide-$look-$lay.png; cp guide/$look-current.png in/current-$look.png
bash $S/run_codex.sh $job in/guide-$look-$lay.png in/current-$look.png refs/photos-rizal-monument.png | tail -1
ls $job
