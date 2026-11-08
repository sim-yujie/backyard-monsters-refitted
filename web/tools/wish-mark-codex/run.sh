#!/bin/bash
# usage: run.sh : paint two gift wish marker options (#391) with one Codex call.
# Work folder art-samples/wish-marker (git-ignored) needs style-sheet.png (the badges' one,
# worktrees/badges-codex/art-samples/badges) and ref-goo.png (server/public/assets/popups/resourcegoo.png).
# Then: python -I make.py ../../../art-samples/wish-marker/gen/option-1.png ../../public/friends/wish-mark.webp
K=$(cd "$(dirname "$0")" && pwd)
cd "$K/../../../art-samples/wish-marker" || exit 1
mkdir -p prompts && cp "$K/prompt.txt" prompts/wish.txt
codex exec --skip-git-repo-check --sandbox workspace-write -i style-sheet.png -i ref-goo.png - < prompts/wish.txt > prompts/wish.log 2>&1
n=$(ls gen/option-*.png 2>/dev/null | wc -l)
if [ "$n" -eq 0 ]; then  # Codex left the pictures in its own session folder
  sid=$(grep -a -m1 "^session id:" prompts/wish.log | awk '{print $3}')
  mkdir -p gen; k=0
  for f in $(ls -tr /c/Users/simyu/.codex/generated_images/$sid/*.png 2>/dev/null); do k=$((k+1)); cp "$f" "gen/option-$k.png"; done
fi
ls gen/option-*.png
