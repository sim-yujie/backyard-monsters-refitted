#!/bin/bash
# usage: pw.sh <args...> : playwright-cli -s=champ-sheets-l2b <args>, always started from the worktree's shots/ folder (git-excluded).
cd "$(dirname "$0")/../../../shots" || exit 1
exec playwright-cli -s=champ-sheets-l2b "$@"
