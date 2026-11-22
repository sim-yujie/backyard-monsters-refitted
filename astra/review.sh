#!/bin/bash
# astra/review.sh <round>   (hcc-r3's own script; pictures from shots/hcc-r3/work)
W=/home/yujiesim/Coding/backyard-monsters-refitted/worktrees/hcc-r3
R=$1; S=$W/shots/hcc-r3/work
PICS=(today-modern-390x844 l2-monsters-modern-390x844 l2-presets-empty-modern-390x844 l2-building-modern-390x844 l3-presets-modern-390x844 l3-presets-classic-390x844 l3-edit-classic-390x844 l3-sent-modern-390x844 l3-remote-presets-classic-390x844 l2-housing-modern-390x844 l3-presets-modern-844x390 l3-edit-classic-844x390 today-modern-844x390 l3-presets-classic-768x1024 l3-edit-modern-768x1024 l3-remote-presets-modern-1024x768 l3-edit-classic-1024x768 l3-presets-modern-1280x720 l3-edit-modern-1280x720 l3-sent-classic-1280x720 l2-presets-empty-classic-1366x768 l3-remote-presets-modern-1366x768 l3-presets-classic-1920x1080 l3-edit-modern-1920x1080 l2-housing-classic-1280x720)
P=$W/astra/review-r$R-prompt.txt
cat $W/astra/review-prompt-head.txt > $P
echo "This is review round $R of at most 3." >> $P
[ -f $W/astra/review-r$R-note.txt ] && cat $W/astra/review-r$R-note.txt >> $P
if [ "$R" -gt 1 ]; then echo "Your previous round's answer (already acted on; check the fixes landed in the new pictures):" >> $P; cat $W/astra/review-r$((R-1))-answer.md >> $P; fi
echo "Pictures (attach order). States: 'monsters' = Monsters tab, queue full, housing full; 'presets-empty' = Presets tab, nothing made, queue has 2 free stacks; 'building' = first preset being built (2 monsters set); 'presets' = every slot filled, queue full; 'edit' = preset 1 open for change; 'sent' = preset 1 just sent with 2 free stacks (part fitted); 'remote-presets' = L3 running outpost 2/11 from home, the outposts' list; 'housing' = the housing box opened; 'today' = the LIVE tab (baseline). l2/l3 = HCC level." >> $P
ARGS=(); n=1
for p in "${PICS[@]}"; do [ -f $S/$p.png ] || { echo MISSING $p; exit 1; }; ARGS+=(-i $S/$p.png); echo " $n: $p" >> $P; n=$((n+1)); done
cd $W && codex exec -m gpt-6-astra -s workspace-write --skip-git-repo-check -o $W/astra/review-r$R-answer.md "${ARGS[@]}" -- "$(cat $P)" < /dev/null > $W/astra/review-r$R-log.txt 2>&1
echo "astra exit $?"
