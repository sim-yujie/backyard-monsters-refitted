#!/bin/bash
cd "$(dirname "$0")"; n=$1; shift; args=(); for p in "$@"; do args+=(-i "$p"); done
cat review-common.txt review-$n.txt | codex exec -m gpt-6-astra -s read-only --skip-git-repo-check "${args[@]}" - > review-$n-answer.md 2> review-$n-log.txt
echo "$n exit $?"
