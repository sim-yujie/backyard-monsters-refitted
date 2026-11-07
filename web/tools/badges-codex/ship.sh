#!/bin/bash
# Copy the picked badges (picks.tsv: id slug option) from art-samples/badges/out into web/public/achievements.
K=$(cd "$(dirname "$0")" && pwd)
cd "$K/../../.." || exit 1
while read -r id slug k; do
  cp "art-samples/badges/out/$slug-option-$k.webp" "web/public/achievements/badge-$id.webp" && echo "$id $slug option-$k"
done < "$K/picks.tsv"
