#!/bin/bash
# usage: review.sh <round> <arrows|hcc> <pictures file: one "path | caption" per line>
cd "$(dirname "$0")"; r=$1; n=$2; list=$3; args=(); caps="Pictures:"; i=0
while IFS='|' read -r p c; do p=$(echo $p); [ -z "$p" ] && continue; i=$((i+1)); args+=(-i "$p"); caps="$caps
 $i:$c"; done < "$list"
{ cat review-common.txt review-$n.txt; echo "This is review round $r of at most 3."; [ -f "review-$n-r$((r-1))-answer.md" ] && { echo "Your previous round's answer (already acted on; check the fixes landed):"; tail -c 3500 "review-$n-r$((r-1))-answer.md"; }; echo "$caps"; } > review-$n-r$r-prompt.txt
codex exec -m gpt-6-astra -s workspace-write --skip-git-repo-check -C /home/yujiesim/Coding/backyard-monsters-refitted/worktrees/screens-r2 "${args[@]}" - < review-$n-r$r-prompt.txt > review-$n-r$r-answer.md 2> review-$n-r$r-log.txt
echo "$n r$r exit $?"
