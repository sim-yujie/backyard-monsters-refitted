#!/bin/bash
# usage: run.sh <name> <pictures...>
cd "$(dirname "$0")"; n=$1; shift; args=(); for p in "$@"; do args+=(-i "$p"); done
cat common.txt $n.txt | codex exec -m gpt-6-astra -s read-only --skip-git-repo-check "${args[@]}" - > $n-answer.md 2> $n-log.txt
echo "$n exit $?"
