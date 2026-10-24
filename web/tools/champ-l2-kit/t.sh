#!/bin/bash
# usage: t.sh <champ>/<level> <name> <batch>... : tile.py of the named batch folders into art-trials/champions/<champ>/<level>/full/t-<name>.png
K=$(cd "$(dirname "$0")" && pwd)
D=D:/Coding/BYMR/art-trials/champions/$1/full; n=$2; shift 2
args=(); for b in "$@"; do args+=("$D/$b"); done
cd "$K" && python tile.py "$D/t-$n.png" "${args[@]}"
