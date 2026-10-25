#!/bin/bash
# usage: tall.sh <tower> : the two Codex calls for one taller tower (tier 2 gold, then tier 3 black and gold), then its sheet
# art-samples/redesign/<tower>/overview-taller.png. Tier 3 of sniper/laser/aerial/railgun/bunker is painted from their tier 2,
# so the calls run one after the other. Check the day's Codex count first (owner's limit: about 60 an evening).
K=$(cd "$(dirname "$0")" && pwd)
bash "$K/run.sh" "$1" TALL2 && bash "$K/run.sh" "$1" TALL3 && python "$K/compare.py" taller "$1"
