# Yard Planner button icons (Codex, 4 Nov 2026)

Owner: "I don't like simple icons. This is a game after all." Painted in the style of the approved game icons.

- a (sheet a): undo, redo, select (v1, light-green hand, replaced), box (v1, thin dashed frame, replaced)
- b (sheet b): find, wallupgrade, rearm (bear trap), rearm2 (spiked mine, second option)
- c (sheet c, repaint): select (fat dark-green monster hand), box (thick hazard frame with blue glass fill),
  select2 (gold mouse pointer, second option), box2 (gold corner brackets round stone blocks, second option)

Style references (inputs.txt): refs/approved.png (levelup, lastarmy, yarddamage2, shield, retreat, time,
resourcebomb, yarddamage tight crops from branch art/game-icons art-samples/icons/large/) and refs/style.png
(art/game-icons art-samples/icons/refs/style.png). prompt.txt = common-head.txt + <batch>/body.txt + common-tail.txt.

To redo a batch: `bash run.sh <batch>` (one Codex image call, writes <batch>/sheet.png), then
`python -I cut.py <batch>` (keys out the magenta, writes large/<name>.png for the names in <batch>/names.txt),
then from the repo root
`python -I web/tools/game-icons/make.py art-samples/planner-icons undo,redo,select,box,find,wallupgrade,rearm,select2,box2,rearm2`
and `python -I art-samples/planner-icons/sheet.py` for the review sheet (art-review/planner-icons-sheet.png).
Only the scripts and this note are in git; the pictures stay in the worktree (art-samples/.gitignore).
