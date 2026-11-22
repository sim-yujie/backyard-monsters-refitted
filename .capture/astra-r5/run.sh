#!/bin/bash
# usage: run.sh <round>   (pictures: pics.txt, "name|caption" per line, from shots/hcc-r5/work)
cd "$(dirname "$0")"; r=$1; W=/home/yujiesim/Coding/backyard-monsters-refitted/worktrees/hcc-r3; args=(); caps="Pictures:"; i=0
while IFS='|' read -r p c; do [ -z "$p" ] && continue; i=$((i+1)); args+=(-i "$W/shots/hcc-r5/work/$p.png"); caps="$caps
 $i: $c"; done < pics.txt
{ cat common.txt; [ -f extra-r$r.txt ] && cat extra-r$r.txt; echo; echo "$caps"; } > prompt-r$r.txt
codex exec -m gpt-6-astra -s workspace-write --skip-git-repo-check -C $W "${args[@]}" - < prompt-r$r.txt > answer-r$r.md 2> log-r$r.txt
echo "astra r$r exit $?"
