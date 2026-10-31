#!/bin/sh
# run.sh <script.py> <level> <mode> [args] : one Blender run of a building script, once fewer than 2 Blenders run on
# the PC (the owner's limit; this helper runs one at a time).
BL="C:/Program Files/Blender Foundation/Blender 5.2/blender.exe"
cd "$(dirname "$1")"
S="$(basename "$1")"; shift
while [ "$(tasklist 2>/dev/null | grep -ci '^blender.exe')" -ge 2 ]; do sleep 15; done
"$BL" -b --factory-startup -P "$S" -- "$@" 2>&1 | grep -i "error\|Traceback\|DONE\|CHECK\|CLEAR\|GAP\|PROBE\|line [0-9]" | grep -v "^Fra:" | head -${PB_LINES:-60}
