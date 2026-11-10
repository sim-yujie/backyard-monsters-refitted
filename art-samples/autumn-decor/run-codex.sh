#!/bin/bash
# Runs one Codex image job: run-codex.sh <folder> <ref images...>. Prompt is <folder>/prompt.txt.
dir="$1"; shift
args=()
for img in "$@"; do args+=(-i "$img"); done
cd "$dir" && codex exec --skip-git-repo-check -s workspace-write "${args[@]}" - < prompt.txt > codex.log 2>&1
echo "exit $?" >> codex.log
